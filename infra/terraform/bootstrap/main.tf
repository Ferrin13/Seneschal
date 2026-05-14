provider "aws" {
  region  = var.region
  profile = var.aws_profile
}

variable "region" {
  description = "AWS region for the Terraform state bucket and lock table."
  type        = string
  default     = "us-west-2"
}

variable "aws_profile" {
  description = "Named AWS CLI/SDK profile Terraform should use."
  type        = string
  default     = "seneschal"
}

variable "project" {
  description = "Project name used to name the state bucket."
  type        = string
  default     = "seneschal"
}

data "aws_caller_identity" "current" {}

locals {
  bucket_name = "${var.project}-tfstate-${data.aws_caller_identity.current.account_id}-${var.region}"
}

resource "aws_s3_bucket" "state" {
  bucket = local.bucket_name

  # Safety: do not allow `terraform destroy` to wipe out historical state.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket = aws_s3_bucket.state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

output "state_bucket" {
  value = aws_s3_bucket.state.bucket
}

output "region" {
  value = var.region
}
