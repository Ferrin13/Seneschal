output "ecr_repository_name" {
  value = aws_ecr_repository.api.name
}

output "ecr_repository_url" {
  value = aws_ecr_repository.api.repository_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  value = aws_ecs_service.api.name
}

output "ecs_task_container_name" {
  value = var.container_name
}

output "alb_dns_name" {
  value = aws_lb.api.dns_name
}

output "alb_zone_id" {
  value = aws_lb.api.zone_id
}

output "task_execution_role_arn" {
  value = aws_iam_role.task_execution.arn
}

output "task_role_arn" {
  value = aws_iam_role.task.arn
}

output "migrate_task_family" {
  value = aws_ecs_task_definition.migrate.family
}

output "service_subnet_ids" {
  value = var.private_subnet_ids
}

output "service_security_group_id" {
  value = aws_security_group.service.id
}

output "images_bucket_name" {
  value = aws_s3_bucket.images.bucket
}

output "images_bucket_arn" {
  value = aws_s3_bucket.images.arn
}

# ----- Outputs consumed by the pipeline module ------------------------
#
# The pipeline's CodeBuild project sed's these values into the task
# definition template on every deploy, and the CodeDeployToECS pipeline
# action targets the app/deployment group below.

output "codedeploy_app_name" {
  value = aws_codedeploy_app.api.name
}

output "codedeploy_deployment_group_name" {
  value = aws_codedeploy_deployment_group.api.deployment_group_name
}

output "codedeploy_role_arn" {
  value = aws_iam_role.codedeploy.arn
}

output "task_family" {
  value = local.task_family
}

output "task_cpu" {
  value = tostring(var.cpu)
}

output "task_memory" {
  value = tostring(var.memory)
}

output "container_port" {
  value = var.container_port
}

output "api_log_group_name" {
  value = aws_cloudwatch_log_group.api.name
}

output "firebase_project_id" {
  value = var.firebase_project_id
}

output "cors_origins" {
  value = var.cors_origins
}

output "db_secret_arn" {
  value = local.db_secret_arn
}

output "firebase_ssm_arn" {
  value = local.firebase_ssm_arn
}
