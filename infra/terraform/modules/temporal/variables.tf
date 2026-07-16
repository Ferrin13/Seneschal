variable "name_prefix" {
  description = "Prefix for all resource names. Deliberately NOT the app name (seneschal) — this Temporal cluster is shared infra meant to be reused across products, so it is prefixed \"parthadae\"."
  type        = string
  default     = "parthadae"
}

variable "env" {
  description = "Environment name (used in tags)."
  type        = string
}

variable "vpc_id" {
  description = "VPC to run the Temporal service + its RDS instance in. Must be the same VPC as the clients (backend API, worker, browser box) so Cloud Map private DNS resolves."
  type        = string
}

variable "subnet_ids" {
  description = "Subnet IDs (>=2 AZs) for the Fargate service and the RDS subnet group. The task gets a public IP for egress (ECR/DockerHub/Secrets Manager) since the target VPC has no NAT; RDS stays publicly_accessible=false."
  type        = list(string)
}

variable "namespace_domain" {
  description = "Cloud Map private DNS namespace. Clients reach the cluster at temporal.<namespace_domain>:7233."
  type        = string
  default     = "parthadae.internal"
}

variable "temporal_image" {
  description = "Temporal auto-setup image. auto-setup runs schema setup + registers the default namespace, then starts a single-node server (frontend/history/matching/worker)."
  type        = string
  default     = "temporalio/auto-setup:1.25.2"
}

variable "cpu" {
  description = "Fargate task CPU units for the Temporal server. auto-setup runs all four services in one process, so give it headroom."
  type        = number
  default     = 512
}

variable "memory" {
  description = "Fargate task memory (MiB) for the Temporal server."
  type        = number
  default     = 1024
}

variable "frontend_port" {
  description = "Temporal frontend gRPC port clients connect to."
  type        = number
  default     = 7233
}

variable "db_engine_version" {
  description = "Postgres engine version for the Temporal RDS instance."
  type        = string
  default     = "16.9"
}

variable "db_instance_class" {
  description = "RDS instance class for the Temporal database."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "Allocated storage (GiB) for the Temporal RDS instance."
  type        = number
  default     = 20
}

variable "db_deletion_protection" {
  description = "Whether to enable RDS deletion protection on the Temporal database. Off by default so the cluster is easy to tear down; turn on for long-lived shared prod."
  type        = bool
  default     = false
}

variable "log_retention_days" {
  description = "CloudWatch log retention for the Temporal server logs."
  type        = number
  default     = 30
}

variable "desired_count" {
  description = "Number of Temporal server tasks. Keep at 1 — auto-setup is a single-node cluster and this is not an HA deployment."
  type        = number
  default     = 1
}
