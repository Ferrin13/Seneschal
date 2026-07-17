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
  description = "EC2 instance type. The box only runs the Node agent + SSH tunnel now, so t3.micro is plenty; t3.small gives headroom."
  type        = string
  default     = "t3.small"
}

variable "root_volume_gb" {
  description = "Root gp3 volume size in GB."
  type        = number
  default     = 30
}

variable "allowed_cidrs" {
  description = "CIDRs allowed to reach SSH (22), which also carries the reverse CDP tunnel. Lock this to your IP(s)."
  type        = list(string)
  default     = []
}

variable "hosted_zone_id" {
  description = "Route53 zone ID for the browser box DNS record."
  type        = string
}

variable "browser_fqdn" {
  description = "Fully-qualified domain pointed at the box's EIP, used as a stable SSH hostname (e.g. browser.seneschal.app)."
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
  description = "SSH public key installed for the operator (direct SSH + the reverse CDP tunnel). Injected via cloud-init, so changing it never replaces the instance."
  type        = string
  default     = ""
}
