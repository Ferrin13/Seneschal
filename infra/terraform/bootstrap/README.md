# Terraform state bootstrap

One-time setup that provisions the S3 bucket used as the remote backend for
the main Terraform config in `../`. State locking uses S3 native conditional
writes (`use_lockfile = true` in `../backend.tf`), so no DynamoDB table is
required.

This sub-project uses **local state** (chicken-and-egg) and is run once per
AWS account.

```bash
cd infra/terraform/bootstrap
terraform init
terraform apply
```

Note the `state_bucket` output and plug it into `../backend.tf` (or use it
as-is if you keep the defaults).

The bucket has `prevent_destroy = true`; do not `terraform destroy` here
unless you really mean it.
