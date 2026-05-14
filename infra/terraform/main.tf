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
    aws            = aws
    aws.us_east_1  = aws.us_east_1
  }

  name_prefix    = var.name_prefix
  env            = var.env
  web_fqdn       = local.web_fqdn
  hosted_zone_id = data.aws_route53_zone.primary.zone_id
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

  ecr_repository_name        = module.backend_api.ecr_repository_name
  ecr_repository_url         = module.backend_api.ecr_repository_url
  ecs_cluster_name           = module.backend_api.ecs_cluster_name
  ecs_service_name           = module.backend_api.ecs_service_name
  ecs_task_container_name    = module.backend_api.ecs_task_container_name
  migrate_task_family        = module.backend_api.migrate_task_family
  service_subnet_ids         = module.backend_api.service_subnet_ids
  service_security_group_id  = module.backend_api.service_security_group_id
  task_execution_role_arn    = module.backend_api.task_execution_role_arn
  task_role_arn              = module.backend_api.task_role_arn

  frontend_bucket_name      = module.frontend_web.bucket_name
  frontend_bucket_arn       = module.frontend_web.bucket_arn
  cloudfront_distribution_id = module.frontend_web.distribution_id
  cloudfront_distribution_arn = module.frontend_web.distribution_arn

  api_base_url       = "https://${local.api_fqdn}"
  frontend_build_env = var.frontend_build_env
}
