variable "region" {
  description = "AWS region for all resources except the CloudFront ACM cert (which is always us-east-1)."
  type        = string
  default     = "us-west-2"
}

variable "aws_profile" {
  description = "Named AWS CLI/SDK profile Terraform should use for all API calls."
  type        = string
  default     = "seneschal"
}

variable "env" {
  description = "Environment name (used in tags and resource names)."
  type        = string
  default     = "prod"
}

variable "name_prefix" {
  description = "Prefix for all resource names."
  type        = string
  default     = "seneschal"
}

# --- DNS ----------------------------------------------------------------

variable "hosted_zone_name" {
  description = "Existing Route53 public hosted zone name (e.g. \"seneschal.app\"). Must already exist."
  type        = string
}

variable "api_subdomain" {
  description = "Subdomain (under hosted_zone_name) where the backend ALB is exposed."
  type        = string
  default     = "api"
}

variable "web_subdomain" {
  description = "Subdomain (under hosted_zone_name) where the CloudFront SPA is exposed."
  type        = string
  default     = "app"
}

# --- Existing networking / database -------------------------------------

variable "existing_vpc_id" {
  description = "ID of the existing VPC where the DB lives. ECS Fargate tasks will be deployed into this VPC."
  type        = string
}

variable "existing_private_subnet_ids" {
  description = "Private subnet IDs (>=2 AZs) where the ECS service runs. Must have NAT egress to reach ECR and Secrets Manager (or use VPC endpoints)."
  type        = list(string)
}

variable "existing_public_subnet_ids" {
  description = "Public subnet IDs (>=2 AZs) where the internet-facing ALB will be deployed."
  type        = list(string)
}

variable "existing_db_security_group_id" {
  description = "Security group ID attached to the existing RDS instance. Terraform will add an ingress rule on this SG allowing the ECS service SG to reach Postgres."
  type        = string
}

variable "db_port" {
  description = "Postgres port on the existing RDS instance."
  type        = number
  default     = 5432
}

variable "database_url" {
  description = "Full Postgres connection string. If set, Terraform creates a Secrets Manager secret and references it from the ECS task. Mutually exclusive with database_url_secret_arn."
  type        = string
  default     = null
  sensitive   = true
}

variable "database_url_secret_arn" {
  description = "ARN of an existing Secrets Manager secret holding the DATABASE_URL string. Mutually exclusive with database_url and database_url_secret_name."
  type        = string
  default     = null
}

variable "database_url_secret_name" {
  description = "Name/path of an existing Secrets Manager secret holding the DATABASE_URL string (e.g. /seneschal/prod/main-postgres-db). Terraform resolves the ARN automatically. Mutually exclusive with database_url and database_url_secret_arn."
  type        = string
  default     = null
}

# --- Firebase -----------------------------------------------------------

variable "firebase_project_id" {
  description = "Firebase project ID (used by the backend to verify ID tokens)."
  type        = string
}

variable "firebase_sa_ssm_param_name" {
  description = "SSM Parameter Store path (SecureString) containing the Firebase service-account JSON. Must be uploaded out-of-band before the ECS task starts."
  type        = string
  default     = "/seneschal/prod/firebase-service-account"
}

# --- Backend service sizing --------------------------------------------

variable "backend_cpu" {
  description = "Fargate task CPU units (256 = 0.25 vCPU)."
  type        = number
  default     = 256
}

variable "backend_memory" {
  description = "Fargate task memory in MiB."
  type        = number
  default     = 512
}

variable "backend_desired_count" {
  description = "Number of ECS tasks to run."
  type        = number
  default     = 1
}

variable "backend_image_tag" {
  description = "Container image tag to deploy. Pipeline overrides this via image-definitions; default lets the service start before the first build."
  type        = string
  default     = "latest"
}

variable "cors_origins" {
  description = "Comma-separated list of allowed CORS origins. Defaults to https://<web_subdomain>.<hosted_zone_name>."
  type        = string
  default     = null
}

# --- CI/CD --------------------------------------------------------------

variable "enable_pipeline" {
  description = "Whether to create CodePipeline + CodeBuild resources."
  type        = bool
  default     = true
}

variable "github_owner" {
  description = "GitHub org or user that owns the repo."
  type        = string
  default     = null
}

variable "github_repo" {
  description = "GitHub repo name (without owner)."
  type        = string
  default     = null
}

variable "github_branch" {
  description = "GitHub branch CodePipeline tracks."
  type        = string
  default     = "main"
}

variable "frontend_build_env" {
  description = "Map of env vars injected at frontend build time (VITE_* values like the Firebase web config). VITE_API_BASE_URL is filled in automatically."
  type        = map(string)
  default     = {}
  sensitive   = true
}
