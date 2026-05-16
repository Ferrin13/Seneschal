# Seneschal — Terraform infrastructure

Provisions everything Seneschal needs on AWS except the database (which is
assumed to already exist as RDS in a VPC you own):

- **Backend** (`modules/backend-api`): ECR, ECS Fargate cluster + service,
  internet-facing ALB on 443 with ACM cert, Route53 alias, CloudWatch logs,
  Secrets Manager (DATABASE_URL), SSM reference for the Firebase service
  account, IAM roles, and a security-group rule that opens the existing
  RDS SG to the ECS service.
- **Frontend** (`modules/frontend-web`): private versioned S3 bucket,
  CloudFront distribution with Origin Access Control, ACM cert in
  `us-west-2`, SPA fallback (`403/404 -> /index.html`), Route53 A/AAAA
  alias.
- **CI/CD** (`modules/pipeline`): one CodeStar Connection to GitHub, two
  CodePipelines (`seneschal-backend`, `seneschal-frontend`), CodeBuild
  projects for each, IAM roles, and a shared artifact bucket. The backend
  pipeline does `docker build -> ECR -> ECS rolling deploy`; the frontend
  pipeline does `npm run build -> S3 sync -> CloudFront invalidation`.

```
infra/terraform/
  bootstrap/                  one-time: S3 state bucket (locking via S3 use_lockfile)
  modules/
    backend-api/
    frontend-web/
    pipeline/
  backend.tf                  S3 remote backend config (uses bootstrap outputs)
  providers.tf                aws (default region) + aws.us_east_1 alias
  variables.tf                all inputs
  main.tf                     wires the three modules together
  outputs.tf                  URLs, pipeline names, etc.
  prod.tfvars.example         copy to prod.tfvars and fill in
```

## Prereqs

- Terraform >= 1.6
- AWS CLI configured with a named profile (default name `seneschal`) for the
  target account. All Terraform AWS calls go through this profile via
  `var.aws_profile`. Configure it with:

  ```bash
  aws configure --profile seneschal
  ```

  Or, if you use SSO:

  ```bash
  aws configure sso --profile seneschal
  ```
- An existing public Route53 hosted zone for your domain
- An existing VPC containing the RDS instance, with at least two subnets
  in two different AZs. Either:
  - two public + two private (with NAT egress) — preferred, or
  - two+ public-only subnets — supply the same IDs for both
    `existing_public_subnet_ids` and `existing_private_subnet_ids`; ECS
    tasks will get public IPs (security groups still isolate them).
- The DB connection string available. Pass it via **one** of:
  - `database_url` — raw connection string (Terraform creates a new Secrets
    Manager secret to hold it)
  - `database_url_secret_arn` — full ARN of an existing secret
  - `database_url_secret_name` — name/path of an existing secret (Terraform
    looks up the ARN). Example: `/seneschal/prod/main-postgres-db`.
- The Firebase service-account JSON uploaded to SSM Parameter Store as a
  SecureString at the path you set in `firebase_sa_ssm_param_name`
  (default `/seneschal/prod/firebase-service-account`):

  ```bash
  aws ssm put-parameter \
    --name /seneschal/prod/firebase-service-account \
    --type SecureString \
    --value "$(cat firebase-service-account.json)"
  ```

## First-time setup

### 1. Bootstrap the state backend

```bash
cd infra/terraform/bootstrap
terraform init
terraform apply
```

Note the `state_bucket` output.

### 2. Configure the remote backend

The S3 bucket name in [backend.tf](backend.tf) is left blank so you can pass
it at `init` time:

```bash
cd ../   # back to infra/terraform/
terraform init \
  -backend-config="bucket=seneschal-tfstate-<account_id>-us-west-2"
```

(Or hard-code the bucket in [backend.tf](backend.tf).)

### 3. Apply the main config

```bash
cp prod.tfvars.example prod.tfvars
# edit prod.tfvars with your domain, VPC IDs, DB URL, Firebase config, etc.

terraform plan -var-file=prod.tfvars
terraform apply -var-file=prod.tfvars
```

### 4. Finish the GitHub connection (one-time, manual)

The `aws_codestarconnections_connection` resource is created in `PENDING`
state. Open the AWS console:

> Developer Tools -> Settings -> Connections -> `seneschal-github`
> -> "Update pending connection" -> install the AWS Connector GitHub App
> on the org/user that owns the repo, then save.

After that, both pipelines will run on every push to the configured branch
(default `main`).

## Day-to-day

- **Push to `main` under `backend/**`** -> backend pipeline builds the
  Docker image, pushes to ECR, and does a rolling ECS deploy.
- **Push to `main` under `frontend/**`** -> frontend pipeline builds the
  SPA with the configured `VITE_*` env vars, syncs `dist/` to S3, and
  invalidates CloudFront.
- The ECS service has `ignore_changes = [task_definition, desired_count]`
  so the pipeline can update the running image without Terraform reverting
  it.

## Opting out of the pipeline

Set `enable_pipeline = false` in your tfvars. Terraform will still create
ECR / ECS / ALB / S3 / CloudFront, and you can push images and sync the
bucket manually from your laptop.

## Outputs

After `terraform apply` you'll see:

- `api_url` — `https://api.<domain>`
- `web_url` — `https://app.<domain>`
- `ecr_repository_url` — for manual `docker push` if needed
- `ecs_cluster_name`, `ecs_service_name`
- `frontend_bucket_name`, `cloudfront_distribution_id`
- `codestar_connection_arn`, `backend_pipeline_name`, `frontend_pipeline_name`
