output "instance_id" {
  description = "EC2 instance ID (use with SSM Session Manager)."
  value       = aws_instance.box.id
}

output "public_ip" {
  description = "Elastic IP of the browser box."
  value       = aws_eip.box.public_ip
}

output "browser_url" {
  description = "noVNC URL for logging into Facebook."
  value       = "https://${var.browser_fqdn}/vnc.html"
}

output "security_group_id" {
  description = "Security group protecting the box."
  value       = aws_security_group.box.id
}
