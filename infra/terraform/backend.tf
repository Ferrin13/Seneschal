terraform {
  backend "s3" {
    # These values come from `bootstrap/`. Bucket name follows the pattern
    # seneschal-tfstate-<account_id>-<region>; pass it via:
    #   terraform init -backend-config=bucket=seneschal-tfstate-123456789012-us-west-2
    # or hard-code by uncommenting and editing the lines below.

    # bucket       = "seneschal-tfstate-<account_id>-us-west-2"
    key          = "prod/terraform.tfstate"
    region       = "us-west-2"
    encrypt      = true
    profile      = "seneschal"
    use_lockfile = true
  }
}
