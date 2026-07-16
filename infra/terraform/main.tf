data "aws_caller_identity" "current" {}
data "aws_route53_zone" "primary" {
  name         = "${var.hosted_zone_name}."
  private_zone = false
}

locals {
  api_fqdn = "${var.api_subdomain}.${var.hosted_zone_name}"
  web_fqdn = "${var.web_subdomain}.${var.hosted_zone_name}"

  cors_origins = coalesce(
    var.cors_origins,
    "https://${local.web_fqdn}",
  )
}

# ----- Deal-hunter shared secret --------------------------------------
# OpenRouter powers all LLM traffic (triage, comps, evaluation). Consumed by
# both the API and the worker.
resource "aws_secretsmanager_secret" "openrouter" {
  name        = "${var.name_prefix}/${var.env}/openrouter-api-key"
  description = "OpenRouter API key for the ${var.name_prefix} deal hunter."
}

resource "aws_secretsmanager_secret_version" "openrouter" {
  secret_id     = aws_secretsmanager_secret.openrouter.id
  secret_string = var.openrouter_api_key
}

# ----- Self-hosted Temporal cluster (shared parthadae infra) ----------
module "temporal" {
  source = "./modules/temporal"

  name_prefix      = var.temporal_name_prefix
  env              = var.env
  vpc_id           = var.existing_vpc_id
  subnet_ids       = var.existing_public_subnet_ids
  namespace_domain = var.temporal_namespace_domain

  cpu                    = var.temporal_cpu
  memory                 = var.temporal_memory
  db_instance_class      = var.temporal_db_instance_class
  db_deletion_protection = var.temporal_db_deletion_protection
}

module "backend_api" {
  source = "./modules/backend-api"

  name_prefix = var.name_prefix
  env         = var.env
  region      = var.region

  vpc_id                   = var.existing_vpc_id
  private_subnet_ids       = var.existing_private_subnet_ids
  public_subnet_ids        = var.existing_public_subnet_ids
  db_security_group_id     = var.existing_db_security_group_id
  db_port                  = var.db_port
  database_url             = var.database_url
  database_url_secret_arn  = var.database_url_secret_arn
  database_url_secret_name = var.database_url_secret_name

  firebase_project_id        = var.firebase_project_id
  firebase_sa_ssm_param_name = var.firebase_sa_ssm_param_name

  # The API also drives the deal hunter (LLM comps/evaluate + starting hunt
  # workflows), so its task role must be able to read the OpenRouter key.
  extra_secret_arns = [aws_secretsmanager_secret.openrouter.arn]

  cpu           = var.backend_cpu
  memory        = var.backend_memory
  desired_count = var.backend_desired_count
  image_tag     = var.backend_image_tag

  api_fqdn       = local.api_fqdn
  hosted_zone_id = data.aws_route53_zone.primary.zone_id
  cors_origins   = local.cors_origins
}

module "frontend_web" {
  source = "./modules/frontend-web"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  name_prefix    = var.name_prefix
  env            = var.env
  web_fqdn       = local.web_fqdn
  hosted_zone_id = data.aws_route53_zone.primary.zone_id
}

# ----- Deal-hunter worker (second ECS service) ------------------------
module "worker" {
  source = "./modules/worker"

  name_prefix = var.name_prefix
  env         = var.env

  vpc_id     = var.existing_vpc_id
  subnet_ids = var.existing_private_subnet_ids

  cluster_id         = module.backend_api.ecs_cluster_arn
  ecr_repository_url = module.backend_api.ecr_repository_url
  image_tag          = var.backend_image_tag

  cpu           = var.worker_cpu
  memory        = var.worker_memory
  desired_count = var.worker_desired_count

  firebase_project_id = var.firebase_project_id
  aws_region          = var.region
  temporal_address    = module.temporal.temporal_address
  craigslist_site     = var.craigslist_site

  db_secret_arn         = module.backend_api.db_secret_arn
  openrouter_secret_arn = aws_secretsmanager_secret.openrouter.arn
}

# ----- Security-group wiring for the Temporal cluster + worker --------
# Kept in the root (not the modules) to avoid a dependency cycle: the
# Temporal service SG needs each client's SG id, and the clients need the
# Temporal DNS — the rules below reference both module outputs.

# App DB: allow the worker task to reach Postgres (mirrors the API rule in
# modules/backend-api/security_groups.tf).
resource "aws_security_group_rule" "worker_to_db" {
  type                     = "ingress"
  from_port                = var.db_port
  to_port                  = var.db_port
  protocol                 = "tcp"
  security_group_id        = var.existing_db_security_group_id
  source_security_group_id = module.worker.security_group_id
  description              = "${var.name_prefix} worker to Postgres"
}

# Temporal frontend (7233) ingress from each client.
resource "aws_security_group_rule" "temporal_from_api" {
  type                     = "ingress"
  from_port                = module.temporal.frontend_port
  to_port                  = module.temporal.frontend_port
  protocol                 = "tcp"
  security_group_id        = module.temporal.service_security_group_id
  source_security_group_id = module.backend_api.service_security_group_id
  description              = "Backend API to Temporal frontend"
}

resource "aws_security_group_rule" "temporal_from_worker" {
  type                     = "ingress"
  from_port                = module.temporal.frontend_port
  to_port                  = module.temporal.frontend_port
  protocol                 = "tcp"
  security_group_id        = module.temporal.service_security_group_id
  source_security_group_id = module.worker.security_group_id
  description              = "Deal-hunter worker to Temporal frontend"
}

resource "aws_security_group_rule" "temporal_from_browser_box" {
  count                    = var.enable_browser_box ? 1 : 0
  type                     = "ingress"
  from_port                = module.temporal.frontend_port
  to_port                  = module.temporal.frontend_port
  protocol                 = "tcp"
  security_group_id        = module.temporal.service_security_group_id
  source_security_group_id = module.browser_box[0].security_group_id
  description              = "Browser box agent to Temporal frontend"
}

# --- Browser box (marketplace deal-finder) ------------------------------
# Shared token the scraper agent presents to the API's /agent/* endpoints.
resource "aws_secretsmanager_secret" "agent_token" {
  count       = var.enable_browser_box ? 1 : 0
  name        = "${var.name_prefix}/${var.env}/agent-token"
  description = "Shared bearer token for the scraper agent -> API /agent/* endpoints"
}

resource "aws_secretsmanager_secret_version" "agent_token" {
  count         = var.enable_browser_box ? 1 : 0
  secret_id     = aws_secretsmanager_secret.agent_token[0].id
  secret_string = var.agent_token
}

# Durable bucket holding the CI-built scraper-agent artifact. The agent
# pipeline uploads agent/latest/agent.tar.gz (+ a per-commit copy) here; the
# browser box pulls it at boot and on each deploy.
resource "aws_s3_bucket" "agent_releases" {
  count         = var.enable_browser_box ? 1 : 0
  bucket        = "${var.name_prefix}-agent-releases-${data.aws_caller_identity.current.account_id}-${var.region}"
  force_destroy = true
}

resource "aws_s3_bucket_versioning" "agent_releases" {
  count  = var.enable_browser_box ? 1 : 0
  bucket = aws_s3_bucket.agent_releases[0].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "agent_releases" {
  count  = var.enable_browser_box ? 1 : 0
  bucket = aws_s3_bucket.agent_releases[0].id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "agent_releases" {
  count                   = var.enable_browser_box ? 1 : 0
  bucket                  = aws_s3_bucket.agent_releases[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "agent_releases" {
  count  = var.enable_browser_box ? 1 : 0
  bucket = aws_s3_bucket.agent_releases[0].id
  rule {
    id     = "expire-old-agent-artifacts"
    status = "Enabled"
    filter {
      prefix = "agent/"
    }
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

module "browser_box" {
  count  = var.enable_browser_box ? 1 : 0
  source = "./modules/browser-box"

  name_prefix = var.name_prefix
  env         = var.env

  vpc_id    = var.existing_vpc_id
  subnet_id = coalesce(var.browser_subnet_id, var.existing_public_subnet_ids[0])

  instance_type = var.browser_instance_type
  allowed_cidrs = var.browser_allowed_cidrs

  hosted_zone_id = data.aws_route53_zone.primary.zone_id
  browser_fqdn   = "${var.browser_subdomain}.${var.hosted_zone_name}"

  api_base_url           = "https://${local.api_fqdn}"
  agent_token_secret_arn = aws_secretsmanager_secret.agent_token[0].arn
  novnc_password         = var.browser_novnc_password
  agent_releases_bucket  = aws_s3_bucket.agent_releases[0].bucket
  agent_name             = "browser-box"
  ssh_public_key         = var.browser_ssh_public_key

  # The agent is a Temporal activity worker; point it at the self-hosted
  # cluster's Cloud Map DNS.
  temporal_address   = module.temporal.temporal_address
  temporal_namespace = "default"
  browser_task_queue = "browser-box"
}

module "pipeline" {
  count  = var.enable_pipeline ? 1 : 0
  source = "./modules/pipeline"

  name_prefix = var.name_prefix
  env         = var.env
  region      = var.region

  github_owner  = var.github_owner
  github_repo   = var.github_repo
  github_branch = var.github_branch

  ecr_repository_name       = module.backend_api.ecr_repository_name
  ecr_repository_url        = module.backend_api.ecr_repository_url
  ecs_cluster_name          = module.backend_api.ecs_cluster_name
  ecs_service_name          = module.backend_api.ecs_service_name
  worker_service_name       = module.worker.service_name
  ecs_task_container_name   = module.backend_api.ecs_task_container_name
  migrate_task_family       = module.backend_api.migrate_task_family
  service_subnet_ids        = module.backend_api.service_subnet_ids
  service_security_group_id = module.backend_api.service_security_group_id
  task_execution_role_arn   = module.backend_api.task_execution_role_arn
  task_role_arn             = module.backend_api.task_role_arn

  # CodeDeploy ECS Blue/Green wiring.
  codedeploy_application_name      = module.backend_api.codedeploy_app_name
  codedeploy_deployment_group_name = module.backend_api.codedeploy_deployment_group_name
  codedeploy_role_arn              = module.backend_api.codedeploy_role_arn

  # Values sed'd into backend/taskdef.json by the backend CodeBuild
  # project on every build.
  task_family           = module.backend_api.task_family
  task_cpu              = module.backend_api.task_cpu
  task_memory           = module.backend_api.task_memory
  container_port        = module.backend_api.container_port
  api_log_group_name    = module.backend_api.api_log_group_name
  firebase_project_id   = module.backend_api.firebase_project_id
  cors_origins          = module.backend_api.cors_origins
  s3_images_bucket_name = module.backend_api.images_bucket_name
  db_secret_arn         = module.backend_api.db_secret_arn
  firebase_ssm_arn      = module.backend_api.firebase_ssm_arn

  # Deal-hunter values sed'd into the API taskdef.
  temporal_address      = module.temporal.temporal_address
  craigslist_site       = var.craigslist_site
  openrouter_secret_arn = aws_secretsmanager_secret.openrouter.arn

  frontend_bucket_name        = module.frontend_web.bucket_name
  frontend_bucket_arn         = module.frontend_web.bucket_arn
  cloudfront_distribution_id  = module.frontend_web.distribution_id
  cloudfront_distribution_arn = module.frontend_web.distribution_arn

  api_base_url       = "https://${local.api_fqdn}"
  frontend_build_env = var.frontend_build_env

  # Scraper-agent release pipeline (only when the browser box is enabled).
  enable_agent_pipeline      = var.enable_browser_box
  agent_releases_bucket_name = var.enable_browser_box ? aws_s3_bucket.agent_releases[0].bucket : null
  agent_releases_bucket_arn  = var.enable_browser_box ? aws_s3_bucket.agent_releases[0].arn : null
  browser_box_instance_id    = var.enable_browser_box ? module.browser_box[0].instance_id : null
}
