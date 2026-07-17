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
  pipeline does `docker build -> ECR -> migrate -> ECS blue/green -> worker
  redeploy`; the frontend pipeline does `npm run build -> S3 sync ->
  CloudFront invalidation`.
- **Temporal** (`modules/temporal`): a self-hosted, single-node Temporal
  cluster on ECS Fargate (`temporalio/auto-setup`) backed by a dedicated RDS
  Postgres instance, discoverable via AWS Cloud Map private DNS at
  `temporal.<namespace_domain>:7233`. It is prefixed **`parthadae`** (not
  `seneschal`) and lives in its own ECS cluster + database so it can be
  reused as shared workflow-orchestration infra across products.
- **Deal-hunter worker** (`modules/worker`): a second ECS service that runs
  the *same* backend image with the command overridden to
  `dist/temporal/worker.js`. It services the `deal-hunter` Temporal task
  queue (Craigslist harvest, LLM triage/comps/evaluation, DB writes) and
  registers one Temporal Schedule per active search target on boot.
- **Agent host** (`modules/browser-box`, optional): an always-on EC2 box that
  runs the scraper agent — a Temporal activity worker on the `browser-box`
  queue — for Facebook Marketplace. Facebook challenges datacenter IPs and
  instrumented/headless browsers, so the agent drives a **real Chrome on the
  operator's local machine**, reached over an SSH reverse tunnel
  (`box 127.0.0.1:9222 -> local Chrome CDP`). The box therefore runs no
  browser of its own; it's the SSH jump host and lives in the VPC so the agent
  can reach Temporal privately. The agent is **not** built on the box; it's
  shipped as a CI-built artifact (see below). See
  `infra/local/fb-agent-tunnel.ps1` for the operator-side keep-alive.
- **Agent release pipeline** (`modules/pipeline`, when the browser box is
  enabled): a third CodePipeline (`seneschal-agent`) that builds `agent/`,
  uploads `agent/latest/agent.tar.gz` to an S3 releases bucket, and triggers
  an SSM RunCommand so the box pulls the artifact and restarts the agent —
  the same "CI builds, target pulls" shape as the frontend deploy.

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
- An **OpenRouter API key** for the deal hunter's LLM calls. Pass it via the
  `openrouter_api_key` tfvar (Terraform stores it in Secrets Manager as
  `seneschal/prod/openrouter-api-key`). This variable is **required**.

## Deal hunter architecture (Temporal + worker + browser box)

The deal hunter runs as a Temporal workflow. Three things cooperate:

```
                 ┌──────────────────────────────────────────┐
                 │ parthadae Temporal cluster (ECS + RDS)    │
                 │ Cloud Map: temporal.parthadae.internal:7233│
                 └───────┬───────────────┬───────────────┬────┘
      starts workflows / │               │ deal-hunter   │ browser-box
      schedules          │               │ task queue    │ task queue
             ┌───────────┴───┐   ┌────────┴────────┐  ┌───┴──────────────────┐
             │ seneschal-api  │   │ seneschal-worker │  │ agent host (EC2)      │
             │ (ECS + ALB)    │   │ (ECS service)    │  │ SSH tunnel -> local   │
             └────────────────┘   └──────────────────┘  │ Chrome/CDP :9222      │
                                                         └───────────────────────┘
```

- The **API** and **worker** are the same Docker image; the worker just runs
  a different command. Both get `TEMPORAL_ADDRESS`, `OPENROUTER_API_KEY`
  (from Secrets Manager), and `CRAIGSLIST_SITE`.
- The **Temporal cluster** is created unconditionally by `module.temporal`.
  Its RDS master password is generated and stored in Secrets Manager
  (`parthadae/temporal/db-password`); `auto-setup` creates the `temporal` and
  `temporal_visibility` databases on first boot.
- The **agent host** is gated by `enable_browser_box`. Facebook scraping is
  in scope for V1, so set it to `true` and fill in the `browser_*` /
  `agent_token` vars (including `browser_ssh_public_key`). Its agent connects
  to Temporal directly (no `/agent/*` API routes are involved), and is
  delivered as a CI-built artifact from S3 (the `seneschal-agent` pipeline)
  rather than cloned/built on the box. The browser it drives runs on the
  operator's machine via the reverse tunnel (see the module note above).

Security-group wiring (worker→DB, and API/worker/browser-box→Temporal:7233)
is created in the root module to avoid a module dependency cycle.

> **First-apply ordering.** Like the API's bootstrap task definition, the
> worker task definition and the Temporal service reference container images
> that don't exist until the first pipeline build pushes them (worker) / are
> pulled from Docker Hub (Temporal). `terraform apply` does **not** block on
> steady state, so this is expected: the worker will crash-loop until the
> first backend pipeline run pushes `:latest`, then stabilize. Temporal comes
> up on the first apply once its RDS instance is available. Likewise the
> browser box's `scraper-agent` crash-loops until the first `seneschal-agent`
> pipeline run uploads the artifact and redeploys it.

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
  Docker image, pushes to ECR, runs DB migrations, does the API blue/green
  deploy, then force-new-deploys the worker service onto the new image.
- **Push to `main` under `agent/**`** -> agent pipeline builds the scraper
  agent, uploads the artifact to S3, and SSM-redeploys the agent host.
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
- `temporal_address` — `temporal.parthadae.internal:7233`
- `temporal_cluster_name`, `temporal_db_endpoint`
- `worker_service_name` — ECS service for the deal-hunter worker
- `browser_box_ssh_host` — SSH hostname of the agent host (used for the
  reverse CDP tunnel) when `enable_browser_box = true`
- `browser_box_instance_id` — for SSM Session Manager

## Connecting local Chrome for Facebook scraping (one-time)

After `terraform apply` with `enable_browser_box = true`:

1. On your machine, run `infra/local/fb-agent-tunnel.ps1`. It launches an
   isolated Chrome with remote debugging on `127.0.0.1:9222` and opens the
   reverse tunnel `ssh -N -R 9222:127.0.0.1:9222 ubuntu@<browser_box_ssh_host>`,
   auto-reconnecting if it drops. Register it at logon (snippet in the script
   header) so it survives reboots.
2. In that Chrome, log into Facebook and complete any 2FA. The session
   persists in the dedicated profile.
3. The `scraper-agent` systemd service (a Temporal worker on the
   `browser-box` queue) connects through the tunnel to your Chrome and picks
   up Facebook activities automatically. Verify with
   `ssh ubuntu@<browser_box_ssh_host> "curl -s http://127.0.0.1:9222/json/version"`.
