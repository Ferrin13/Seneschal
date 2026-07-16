variable "name_prefix" {
  type = string
}

variable "env" {
  type = string
}

variable "region" {
  type = string
}

variable "github_owner" {
  type = string
}

variable "github_repo" {
  type = string
}

variable "github_branch" {
  type    = string
  default = "main"
}

# Backend wiring -------------------------------------------------------

variable "ecr_repository_name" {
  type = string
}

variable "ecr_repository_url" {
  type = string
}

variable "ecs_cluster_name" {
  type = string
}

variable "ecs_service_name" {
  type = string
}

variable "worker_service_name" {
  description = "ECS service name of the deal-hunter worker. The backend pipeline force-new-deployments it after each image push."
  type        = string
}

# Agent (browser box) release pipeline ---------------------------------

variable "enable_agent_pipeline" {
  description = "Whether to create the scraper-agent build+deploy pipeline. Set to true only when the browser box is enabled (it's the only consumer of the artifact)."
  type        = bool
  default     = false
}

variable "agent_releases_bucket_name" {
  description = "S3 bucket the agent pipeline uploads the built artifact to (agent/latest/agent.tar.gz + a per-commit copy)."
  type        = string
  default     = null
}

variable "agent_releases_bucket_arn" {
  description = "ARN of the agent releases bucket (for the CodeBuild PutObject policy)."
  type        = string
  default     = null
}

variable "browser_box_instance_id" {
  description = "EC2 instance id of the browser box. The agent Deploy stage sends it an SSM RunCommand to pull the new artifact and restart the agent."
  type        = string
  default     = null
}

variable "ecs_task_container_name" {
  type = string
}

variable "migrate_task_family" {
  description = "Family name of the ECS task definition used to run drizzle migrations."
  type        = string
}

variable "service_subnet_ids" {
  description = "Subnets used by the ECS service. The migration RunTask reuses these so it lands in the same network."
  type        = list(string)
}

variable "service_security_group_id" {
  description = "Security group attached to the ECS service. Reused for the migration task."
  type        = string
}

variable "task_execution_role_arn" {
  description = "Execution role ARN that CodeBuild passes when registering the migration task definition revision."
  type        = string
}

variable "task_role_arn" {
  description = "Task role ARN passed when registering the migration task definition revision."
  type        = string
}

# CodeDeploy ECS Blue/Green wiring ------------------------------------

variable "codedeploy_application_name" {
  description = "Name of the CodeDeploy application targeted by the Deploy stage."
  type        = string
}

variable "codedeploy_deployment_group_name" {
  description = "Deployment group within `codedeploy_application_name`."
  type        = string
}

variable "codedeploy_role_arn" {
  description = "ARN of the CodeDeploy service role. Granted iam:PassRole from the CodePipeline role so the pipeline can hand it to the deploy action."
  type        = string
}

# Values sed'd into backend/taskdef.json by the backend CodeBuild
# project on every build. Keep the spelling identical to the @@NAME@@
# placeholders in the template.

variable "task_family" {
  type = string
}

variable "task_cpu" {
  type = string
}

variable "task_memory" {
  type = string
}

variable "container_port" {
  type = number
}

variable "api_log_group_name" {
  type = string
}

variable "firebase_project_id" {
  type = string
}

variable "cors_origins" {
  type = string
}

variable "s3_images_bucket_name" {
  type = string
}

variable "db_secret_arn" {
  type = string
}

variable "firebase_ssm_arn" {
  type = string
}

variable "temporal_address" {
  description = "host:port of the self-hosted Temporal frontend, sed'd into the API taskdef."
  type        = string
}

variable "craigslist_site" {
  description = "Craigslist site slug sed'd into the API taskdef (empty disables Craigslist)."
  type        = string
  default     = ""
}

variable "openrouter_secret_arn" {
  description = "Secrets Manager ARN for the OpenRouter API key, sed'd into the API taskdef secrets."
  type        = string
}

# Frontend wiring ------------------------------------------------------

variable "frontend_bucket_name" {
  type = string
}

variable "frontend_bucket_arn" {
  type = string
}

variable "cloudfront_distribution_id" {
  type = string
}

variable "cloudfront_distribution_arn" {
  type = string
}

variable "api_base_url" {
  description = "https URL passed to the frontend build as VITE_API_BASE_URL."
  type        = string
}

variable "frontend_build_env" {
  description = "Extra VITE_* env vars baked into the SPA at build time."
  type        = map(string)
  default     = {}
  sensitive   = true
}
