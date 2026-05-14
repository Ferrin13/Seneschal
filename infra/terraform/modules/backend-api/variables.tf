variable "name_prefix" {
  type = string
}

variable "env" {
  type = string
}

variable "region" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "db_security_group_id" {
  type = string
}

variable "db_port" {
  type    = number
  default = 5432
}

variable "database_url" {
  type      = string
  default   = null
  sensitive = true
}

variable "database_url_secret_arn" {
  type    = string
  default = null
}

variable "database_url_secret_name" {
  description = "Name (path) of an existing Secrets Manager secret holding the DATABASE_URL string, e.g. /seneschal/prod/main-postgres-db. Terraform looks the ARN up via a data source."
  type        = string
  default     = null
}

variable "firebase_project_id" {
  type = string
}

variable "firebase_sa_ssm_param_name" {
  type = string
}

variable "cpu" {
  type    = number
  default = 256
}

variable "memory" {
  type    = number
  default = 512
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "image_tag" {
  type    = string
  default = "latest"
}

variable "api_fqdn" {
  type = string
}

variable "hosted_zone_id" {
  type = string
}

variable "cors_origins" {
  type = string
}

variable "container_name" {
  type    = string
  default = "api"
}

variable "container_port" {
  type    = number
  default = 8080
}

variable "log_retention_days" {
  type    = number
  default = 30
}
