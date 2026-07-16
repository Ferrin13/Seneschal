variable "name_prefix" {
  description = "Prefix for all resource names (matches the app, e.g. seneschal)."
  type        = string
}

variable "env" {
  description = "Environment name (used in tags)."
  type        = string
}

variable "vpc_id" {
  description = "VPC the worker runs in (same as the API and Temporal)."
  type        = string
}

variable "subnet_ids" {
  description = "Subnets for the worker task. Reuses the API's subnets; the task gets a public IP for egress (no NAT in the target VPC)."
  type        = list(string)
}

variable "cluster_id" {
  description = "ECS cluster ID to run the worker service on (reuses the backend API cluster)."
  type        = string
}

variable "ecr_repository_url" {
  description = "ECR repo URL for the backend image. The worker runs the same image as the API, just a different command."
  type        = string
}

variable "image_tag" {
  description = "Image tag the worker task definition points at. The backend pipeline pushes :latest on every build and force-new-deployments this service."
  type        = string
  default     = "latest"
}

variable "cpu" {
  description = "Fargate task CPU units for the worker."
  type        = number
  default     = 512
}

variable "memory" {
  description = "Fargate task memory (MiB) for the worker."
  type        = number
  default     = 1024
}

variable "desired_count" {
  description = "Number of worker tasks. One is enough for the deal-hunter pipeline; Temporal serializes work per target."
  type        = number
  default     = 1
}

variable "log_retention_days" {
  description = "CloudWatch log retention for the worker."
  type        = number
  default     = 30
}

variable "container_command" {
  description = "Container command. The distroless base image's ENTRYPOINT is node, so this is just the script path."
  type        = list(string)
  default     = ["dist/temporal/worker.js"]
}

# --- Runtime configuration --------------------------------------------------
variable "firebase_project_id" {
  description = "Firebase project id. The worker does no auth, but the shared config.ts requires this to be set."
  type        = string
}

variable "aws_region" {
  description = "AWS region passed to the container (SDK + config)."
  type        = string
}

variable "temporal_address" {
  description = "host:port of the Temporal frontend (Cloud Map DNS from the temporal module)."
  type        = string
}

variable "temporal_namespace" {
  type    = string
  default = "default"
}

variable "temporal_task_queue" {
  type    = string
  default = "deal-hunter"
}

variable "temporal_browser_task_queue" {
  type    = string
  default = "browser-box"
}

variable "craigslist_site" {
  description = "Craigslist site slug (e.g. \"boise\"). Empty disables Craigslist harvesting."
  type        = string
  default     = ""
}

variable "comps_region" {
  description = "Optional override for COMPS_REGION. Empty keeps the code default (Treasure Valley, Idaho)."
  type        = string
  default     = ""
}

# --- Secrets ----------------------------------------------------------------
variable "db_secret_arn" {
  description = "Secrets Manager ARN holding the DATABASE_URL connection string (shared with the API)."
  type        = string
}

variable "openrouter_secret_arn" {
  description = "Secrets Manager ARN holding the OpenRouter API key."
  type        = string
}
