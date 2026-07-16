output "service_name" {
  description = "ECS service name for the deal-hunter worker. The pipeline force-new-deployments this on each build."
  value       = aws_ecs_service.worker.name
}

output "security_group_id" {
  description = "Security group on the worker task. The root module grants it ingress to the app DB and the Temporal frontend."
  value       = aws_security_group.worker.id
}

output "task_definition_family" {
  description = "Worker task definition family."
  value       = aws_ecs_task_definition.worker.family
}
