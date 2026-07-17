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

output "agent_pipeline_name" {
  description = "Name of the CodePipeline that builds the scraper agent and redeploys the browser box."
  value       = var.enable_pipeline ? module.pipeline[0].agent_pipeline_name : null
}

output "agent_releases_bucket" {
  description = "S3 bucket holding the built scraper-agent artifact."
  value       = var.enable_browser_box ? aws_s3_bucket.agent_releases[0].bucket : null
}

output "browser_box_ssh_host" {
  description = "SSH hostname for the agent host (used for the reverse CDP tunnel to local Chrome)."
  value       = var.enable_browser_box ? module.browser_box[0].ssh_host : null
}

output "browser_box_public_ip" {
  description = "Elastic IP of the agent host (SSH / reverse-tunnel endpoint)."
  value       = var.enable_browser_box ? module.browser_box[0].public_ip : null
}

output "browser_box_instance_id" {
  description = "Browser box EC2 instance ID (for SSM Session Manager)."
  value       = var.enable_browser_box ? module.browser_box[0].instance_id : null
}

# --- Deal hunter -------------------------------------------------------

output "temporal_address" {
  description = "host:port clients use to reach the self-hosted Temporal frontend (Cloud Map private DNS)."
  value       = module.temporal.temporal_address
}

output "temporal_cluster_name" {
  description = "ECS cluster hosting the Temporal server."
  value       = module.temporal.cluster_name
}

output "temporal_db_endpoint" {
  description = "Endpoint of the Temporal RDS instance."
  value       = module.temporal.db_endpoint
}

output "worker_service_name" {
  description = "ECS service name of the deal-hunter worker."
  value       = module.worker.service_name
}
