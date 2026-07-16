variable "name_prefix" {
  description = "Prefix for all resource names."
  type        = string
}

variable "env" {
  description = "Environment name (used in tags)."
  type        = string
}

variable "vpc_id" {
  description = "VPC to launch the browser box into."
  type        = string
}

variable "subnet_id" {
  description = "Public subnet ID (needs a public IP / route to IGW for the EIP and outbound)."
  type        = string
}

variable "instance_type" {
  description = "EC2 instance type. t3.small is enough for one headed Chrome; bump to t3.medium if scraping many tabs."
  type        = string
  default     = "t3.small"
}

variable "root_volume_gb" {
  description = "Root gp3 volume size in GB. Holds the persistent Chrome profile, so keep some headroom."
  type        = number
  default     = 30
}

variable "allowed_cidrs" {
  description = "CIDRs allowed to reach noVNC (443) and SSH (22). Lock this to your IP(s)."
  type        = list(string)
  default     = []
}

variable "hosted_zone_id" {
  description = "Route53 zone ID for the browser box DNS record."
  type        = string
}

variable "browser_fqdn" {
  description = "Fully-qualified domain for noVNC (e.g. browser.seneschal.app). Caddy provisions TLS for it."
  type        = string
}

variable "api_base_url" {
  description = "Base URL of the Seneschal API the agent posts results to."
  type        = string
}

variable "agent_token_secret_arn" {
  description = "Secrets Manager ARN holding the shared AGENT_TOKEN string. The instance reads it at boot."
  type        = string
}

variable "novnc_password" {
  description = "Plaintext password for noVNC basic auth (hashed by Caddy on the box)."
  type        = string
  sensitive   = true
}

variable "agent_releases_bucket" {
  description = "S3 bucket name holding the CI-built scraper-agent artifact. The box downloads s3://<bucket>/agent/latest/agent.tar.gz at boot (and on each deploy) instead of cloning + building from source."
  type        = string
}

variable "agent_name" {
  description = "Identifier this box reports to the API."
  type        = string
  default     = "browser-box"
}

variable "temporal_address" {
  description = "host:port of the self-hosted Temporal frontend (Cloud Map DNS). The agent is a Temporal activity worker and connects here directly."
  type        = string
}

variable "temporal_namespace" {
  description = "Temporal namespace the agent worker uses."
  type        = string
  default     = "default"
}

variable "browser_task_queue" {
  description = "Temporal task queue the agent services (Facebook load-and-parse activities)."
  type        = string
  default     = "browser-box"
}

variable "ssh_public_key" {
  description = "Optional SSH public key to install for direct SSH. Leave empty to rely on SSM Session Manager only."
  type        = string
  default     = ""
}
