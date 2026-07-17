output "instance_id" {
  description = "EC2 instance ID (use with SSM Session Manager)."
  value       = aws_instance.box.id
}

output "public_ip" {
  description = "Elastic IP of the agent host (SSH / reverse-tunnel endpoint)."
  value       = aws_eip.box.public_ip
}

output "ssh_host" {
  description = "Stable SSH hostname (Route53 A record -> EIP) for the reverse CDP tunnel."
  value       = var.browser_fqdn
}

output "security_group_id" {
  description = "Security group protecting the box."
  value       = aws_security_group.box.id
}
