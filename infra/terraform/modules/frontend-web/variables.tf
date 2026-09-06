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

variable "firebase_auth_proxy_domain" {
  description = <<-EOT
    Firebase Hosting domain (`<project-id>.firebaseapp.com`) that serves the
    Firebase Auth handler pages. CloudFront proxies `/__/auth/*` on the web
    FQDN to it so the app can use its own hostname as `authDomain`, keeping
    the OAuth popup/redirect flow same-origin. Without this, browsers that
    partition third-party storage (Safari/ITP, Firefox strict, Brave, Chrome
    with third-party cookies blocked) fail sign-in with
    `auth/missing-initial-state`.
  EOT
  type        = string
}

variable "price_class" {
  description = "CloudFront price class."
  type        = string
  default     = "PriceClass_100"
}
