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

# --- Deal hunter (Temporal + worker + LLM) ------------------------------

variable "openrouter_api_key" {
  description = "OpenRouter API key. Required by the deal hunter (all LLM traffic: triage, comps, evaluation). Terraform stores it in Secrets Manager and injects it into both the API and worker tasks."
  type        = string
  sensitive   = true
}

variable "craigslist_site" {
  description = "Craigslist site slug the deal hunter searches (e.g. \"boise\"). Must be non-empty: it is injected into the API task and the shared config validates it as a min-length-1 string, so an empty value would crash the API on boot."
  type        = string
  default     = "boise"

  validation {
    condition     = length(var.craigslist_site) > 0
    error_message = "craigslist_site must be a non-empty Craigslist site slug (e.g. \"boise\")."
  }
}

variable "temporal_name_prefix" {
  description = "Resource-name prefix for the self-hosted Temporal cluster + its RDS instance. Deliberately separate from name_prefix (seneschal) so the cluster can be reused as shared infra across products."
  type        = string
  default     = "parthadae"
}

variable "temporal_namespace_domain" {
  description = "Cloud Map private DNS namespace for the Temporal cluster. Clients reach it at temporal.<domain>:7233."
  type        = string
  default     = "parthadae.internal"
}

variable "temporal_cpu" {
  description = "Fargate CPU units for the Temporal server task."
  type        = number
  default     = 512
}

variable "temporal_memory" {
  description = "Fargate memory (MiB) for the Temporal server task."
  type        = number
  default     = 1024
}

variable "temporal_db_instance_class" {
  description = "RDS instance class for the Temporal database."
  type        = string
  default     = "db.t4g.micro"
}

variable "temporal_db_deletion_protection" {
  description = "Enable deletion protection on the Temporal RDS instance."
  type        = bool
  default     = false
}

variable "worker_cpu" {
  description = "Fargate CPU units for the deal-hunter worker."
  type        = number
  default     = 512
}

variable "worker_memory" {
  description = "Fargate memory (MiB) for the deal-hunter worker."
  type        = number
  default     = 1024
}

variable "worker_desired_count" {
  description = "Number of deal-hunter worker tasks."
  type        = number
  default     = 1
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
  description = "Map of env vars injected at frontend build time (VITE_* values like the Firebase web config). VITE_API_BASE_URL and VITE_FIREBASE_AUTH_DOMAIN are filled in automatically (the latter is always the web FQDN)."
  type        = map(string)
  default     = {}
  sensitive   = true
}

# --- Browser box (marketplace deal-finder) ------------------------------

variable "enable_browser_box" {
  description = "Whether to provision the always-on EC2 agent host (runs the scraper agent + SSH jump host for the operator's local Chrome)."
  type        = bool
  default     = false
}

variable "browser_subdomain" {
  description = "Subdomain (under hosted_zone_name) pointed at the agent host's EIP, used as a stable SSH hostname."
  type        = string
  default     = "browser"
}

variable "browser_subnet_id" {
  description = "Public subnet ID to launch the browser box into. Defaults to the first existing public subnet."
  type        = string
  default     = null
}

variable "browser_instance_type" {
  description = "EC2 instance type for the agent host. It only runs the Node agent + SSH tunnel, so t3.micro is plenty."
  type        = string
  default     = "t3.small"
}

variable "browser_allowed_cidrs" {
  description = "CIDRs allowed to reach the agent host's SSH (22), which also carries the reverse CDP tunnel. Lock to your IP(s)."
  type        = list(string)
  default     = []
}

variable "agent_token" {
  description = "Shared bearer token the scraper agent uses for the API's /agent/* endpoints. Terraform stores it in Secrets Manager. Also set AGENT_TOKEN on the backend to the same value."
  type        = string
  default     = null
  sensitive   = true
}

variable "browser_ssh_public_key" {
  description = "SSH public key for the operator (direct SSH + the reverse CDP tunnel to local Chrome). Injected via cloud-init, so rotating it never replaces the instance."
  type        = string
  default     = ""
}
