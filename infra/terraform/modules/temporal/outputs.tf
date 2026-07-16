output "temporal_address" {
  description = "host:port clients (backend worker, API, browser box) use as TEMPORAL_ADDRESS."
  value       = "temporal.${var.namespace_domain}:${var.frontend_port}"
}

output "namespace_domain" {
  description = "Cloud Map private DNS namespace the Temporal service is registered under."
  value       = var.namespace_domain
}

output "service_security_group_id" {
  description = "Security group on the Temporal server task. The root module adds frontend-port ingress rules from each client SG to this group."
  value       = aws_security_group.service.id
}

output "cluster_name" {
  description = "ECS cluster name hosting the Temporal server."
  value       = aws_ecs_cluster.temporal.name
}

output "service_name" {
  description = "ECS service name for the Temporal server."
  value       = aws_ecs_service.temporal.name
}

output "db_endpoint" {
  description = "Endpoint of the Temporal RDS instance."
  value       = aws_db_instance.temporal.address
}

output "frontend_port" {
  description = "Temporal frontend gRPC port."
  value       = var.frontend_port
}
