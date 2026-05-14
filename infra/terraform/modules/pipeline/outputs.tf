output "codestar_connection_arn" {
  value = aws_codestarconnections_connection.github.arn
}

output "backend_pipeline_name" {
  value = aws_codepipeline.backend.name
}

output "frontend_pipeline_name" {
  value = aws_codepipeline.frontend.name
}

output "artifacts_bucket" {
  value = aws_s3_bucket.artifacts.bucket
}
