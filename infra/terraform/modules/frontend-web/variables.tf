variable "name_prefix" {
  type = string
}

variable "env" {
  type = string
}

variable "web_fqdn" {
  description = "Fully-qualified domain name for the frontend (e.g. app.example.com)."
  type        = string
}

variable "hosted_zone_id" {
  type = string
}

variable "price_class" {
  description = "CloudFront price class."
  type        = string
  default     = "PriceClass_100"
}
