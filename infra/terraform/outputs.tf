output "api_url" {
  description = "Public HTTPS URL for the backend API."
  value       = "https://${local.api_fqdn}"
}

output "web_url" {
  description = "Public HTTPS URL for the frontend SPA."
  value       = "https://${local.web_fqdn}"
}

output "alb_dns_name" {
  description = "Raw ALB DNS name (useful before the Route53 record propagates)."
  value       = module.backend_api.alb_dns_name
}

output "cloudfront_domain" {
  description = "Raw CloudFront distribution domain name."
  value       = module.frontend_web.distribution_domain_name
}

output "ecr_repository_url" {
  description = "ECR repo URL for the backend image."
  value       = module.backend_api.ecr_repository_url
}

output "ecs_cluster_name" {
  description = "ECS cluster name."
  value       = module.backend_api.ecs_cluster_name
}

output "ecs_service_name" {
  description = "ECS service name."
  value       = module.backend_api.ecs_service_name
}

output "frontend_bucket_name" {
  description = "S3 bucket name backing CloudFront."
  value       = module.frontend_web.bucket_name
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID (used for invalidations)."
  value       = module.frontend_web.distribution_id
}

output "codestar_connection_arn" {
  description = "ARN of the CodeStar Connections connection to GitHub. After first apply, finish the GitHub OAuth in the AWS console."
  value       = var.enable_pipeline ? module.pipeline[0].codestar_connection_arn : null
}

output "backend_pipeline_name" {
  description = "Name of the CodePipeline that builds and deploys the backend."
  value       = var.enable_pipeline ? module.pipeline[0].backend_pipeline_name : null
}

output "frontend_pipeline_name" {
  description = "Name of the CodePipeline that builds and deploys the frontend."
  value       = var.enable_pipeline ? module.pipeline[0].frontend_pipeline_name : null
}
