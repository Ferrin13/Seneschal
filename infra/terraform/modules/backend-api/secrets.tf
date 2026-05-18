data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

# Optional lookup of an existing Secrets Manager secret by name.
data "aws_secretsmanager_secret" "database_url" {
  count = var.database_url_secret_name != null && var.database_url_secret_arn == null && var.database_url == null ? 1 : 0
  name  = var.database_url_secret_name
}

locals {
  create_db_secret  = var.database_url != null
  use_existing_arn  = var.database_url_secret_arn != null
  use_existing_name = var.database_url_secret_name != null && !local.use_existing_arn && !local.create_db_secret

  db_secret_arn = (
    local.create_db_secret ? aws_secretsmanager_secret.database_url[0].arn :
    local.use_existing_arn ? var.database_url_secret_arn :
    local.use_existing_name ? data.aws_secretsmanager_secret.database_url[0].arn :
    null
  )

  firebase_ssm_arn = "arn:aws:ssm:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:parameter${var.firebase_sa_ssm_param_name}"
}

resource "terraform_data" "validate_db_inputs" {
  lifecycle {
    precondition {
      condition     = local.db_secret_arn != null
      error_message = "Provide exactly one of: database_url, database_url_secret_arn, or database_url_secret_name."
    }
  }
}

resource "aws_secretsmanager_secret" "database_url" {
  count       = local.create_db_secret ? 1 : 0
  name        = "${var.name_prefix}/${var.env}/database-url"
  description = "Postgres connection string for the ${var.name_prefix} API"
}

resource "aws_secretsmanager_secret_version" "database_url" {
  count         = local.create_db_secret ? 1 : 0
  secret_id     = aws_secretsmanager_secret.database_url[0].id
  secret_string = var.database_url
}
