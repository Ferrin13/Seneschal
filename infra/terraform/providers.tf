provider "aws" {
  region  = var.region
  profile = var.aws_profile

  default_tags {
    tags = {
      Project   = "seneschal"
      Env       = var.env
      ManagedBy = "terraform"
    }
  }
}

# Aliased provider pinned to us-east-1 for CloudFront's ACM cert requirement.
# If var.region is already us-east-1 this provider is identical, but we keep
# the alias so the frontend module always works no matter where the rest of
# the infra lives.
provider "aws" {
  alias   = "us_east_1"
  region  = "us-east-1"
  profile = var.aws_profile

  default_tags {
    tags = {
      Project   = "seneschal"
      Env       = var.env
      ManagedBy = "terraform"
    }
  }
}
