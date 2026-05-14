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

variable "ecs_task_container_name" {
  type = string
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
