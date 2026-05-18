locals {
  # Convert frontend_build_env into a list of CodeBuild env-var blocks.
  frontend_env_vars = concat(
    [
      {
        name  = "VITE_API_BASE_URL"
        value = var.api_base_url
        type  = "PLAINTEXT"
      },
    ],
    [
      for k, v in var.frontend_build_env : {
        name  = k
        value = v
        type  = "PLAINTEXT"
      }
    ],
  )
}

# ----- Backend image build --------------------------------------------

resource "aws_cloudwatch_log_group" "backend_build" {
  name              = "/aws/codebuild/${var.name_prefix}-backend-build"
  retention_in_days = 30
}

resource "aws_codebuild_project" "backend" {
  name         = "${var.name_prefix}-backend-build"
  service_role = aws_iam_role.codebuild.arn

  artifacts {
    type = "CODEPIPELINE"
  }

  environment {
    type            = "LINUX_CONTAINER"
    compute_type    = "BUILD_GENERAL1_SMALL"
    image           = "aws/codebuild/standard:7.0"
    privileged_mode = true # required for docker build

    environment_variable {
      name  = "AWS_DEFAULT_REGION"
      value = var.region
    }
    # Mirror of AWS_DEFAULT_REGION under a non-reserved name so the
    # buildspec can sed it into taskdef.json's `AWS_REGION` env entry
    # without conflicting with the AWS SDK's own consumption of
    # `AWS_DEFAULT_REGION` inside the running container.
    environment_variable {
      name  = "AWS_REGION_NAME"
      value = var.region
    }
    environment_variable {
      name  = "AWS_ACCOUNT_ID"
      value = data.aws_caller_identity.current.account_id
    }
    environment_variable {
      name  = "ECR_REPO_URL"
      value = var.ecr_repository_url
    }
    environment_variable {
      name  = "CONTAINER_NAME"
      value = var.ecs_task_container_name
    }
    environment_variable {
      name  = "CONTAINER_PORT"
      value = tostring(var.container_port)
    }
    environment_variable {
      name  = "TASK_FAMILY"
      value = var.task_family
    }
    environment_variable {
      name  = "TASK_CPU"
      value = var.task_cpu
    }
    environment_variable {
      name  = "TASK_MEMORY"
      value = var.task_memory
    }
    environment_variable {
      name  = "EXECUTION_ROLE_ARN"
      value = var.task_execution_role_arn
    }
    environment_variable {
      name  = "TASK_ROLE_ARN"
      value = var.task_role_arn
    }
    environment_variable {
      name  = "LOG_GROUP"
      value = var.api_log_group_name
    }
    environment_variable {
      name  = "FIREBASE_PROJECT_ID"
      value = var.firebase_project_id
    }
    environment_variable {
      name  = "CORS_ORIGINS"
      value = var.cors_origins
    }
    environment_variable {
      name  = "S3_BUCKET"
      value = var.s3_images_bucket_name
    }
    environment_variable {
      name  = "DB_SECRET_ARN"
      value = var.db_secret_arn
    }
    environment_variable {
      name  = "FIREBASE_SSM_ARN"
      value = var.firebase_ssm_arn
    }
  }

  source {
    type      = "CODEPIPELINE"
    buildspec = "backend/buildspec.yml"
  }

  logs_config {
    cloudwatch_logs {
      group_name = aws_cloudwatch_log_group.backend_build.name
    }
  }
}

# ----- Backend DB migration -------------------------------------------

resource "aws_cloudwatch_log_group" "backend_migrate" {
  name              = "/aws/codebuild/${var.name_prefix}-backend-migrate"
  retention_in_days = 30
}

resource "aws_codebuild_project" "backend_migrate" {
  name         = "${var.name_prefix}-backend-migrate"
  service_role = aws_iam_role.codebuild.arn

  artifacts {
    type = "CODEPIPELINE"
  }

  environment {
    type         = "LINUX_CONTAINER"
    compute_type = "BUILD_GENERAL1_SMALL"
    image        = "aws/codebuild/standard:7.0"

    environment_variable {
      name  = "AWS_DEFAULT_REGION"
      value = var.region
    }
    environment_variable {
      name  = "ECS_CLUSTER"
      value = var.ecs_cluster_name
    }
    environment_variable {
      name  = "MIGRATE_TASK_FAMILY"
      value = var.migrate_task_family
    }
    environment_variable {
      name  = "SUBNET_IDS"
      value = join(",", var.service_subnet_ids)
    }
    environment_variable {
      name  = "SECURITY_GROUP_ID"
      value = var.service_security_group_id
    }
  }

  source {
    type      = "CODEPIPELINE"
    buildspec = "backend/buildspec-migrate.yml"
  }

  logs_config {
    cloudwatch_logs {
      group_name = aws_cloudwatch_log_group.backend_migrate.name
    }
  }
}

# ----- Frontend SPA build ---------------------------------------------

resource "aws_cloudwatch_log_group" "frontend_build" {
  name              = "/aws/codebuild/${var.name_prefix}-frontend-build"
  retention_in_days = 30
}

resource "aws_codebuild_project" "frontend_build" {
  name         = "${var.name_prefix}-frontend-build"
  service_role = aws_iam_role.codebuild.arn

  artifacts {
    type = "CODEPIPELINE"
  }

  environment {
    type         = "LINUX_CONTAINER"
    compute_type = "BUILD_GENERAL1_SMALL"
    image        = "aws/codebuild/standard:7.0"

    dynamic "environment_variable" {
      for_each = local.frontend_env_vars
      content {
        name  = environment_variable.value.name
        value = environment_variable.value.value
        type  = environment_variable.value.type
      }
    }
  }

  source {
    type      = "CODEPIPELINE"
    buildspec = "frontend/buildspec.yml"
  }

  logs_config {
    cloudwatch_logs {
      group_name = aws_cloudwatch_log_group.frontend_build.name
    }
  }
}

# ----- Frontend deploy (S3 sync + CloudFront invalidate) --------------

resource "aws_cloudwatch_log_group" "frontend_deploy" {
  name              = "/aws/codebuild/${var.name_prefix}-frontend-deploy"
  retention_in_days = 30
}

resource "aws_codebuild_project" "frontend_deploy" {
  name         = "${var.name_prefix}-frontend-deploy"
  service_role = aws_iam_role.codebuild.arn

  artifacts {
    type = "CODEPIPELINE"
  }

  environment {
    type         = "LINUX_CONTAINER"
    compute_type = "BUILD_GENERAL1_SMALL"
    image        = "aws/codebuild/standard:7.0"

    environment_variable {
      name  = "S3_BUCKET"
      value = var.frontend_bucket_name
    }
    environment_variable {
      name  = "CLOUDFRONT_DISTRIBUTION_ID"
      value = var.cloudfront_distribution_id
    }
  }

  # The input artifact for this stage is `spa_dist`, which contains the
  # contents of frontend/dist/ at its root. We inline the buildspec here
  # instead of committing a frontend/buildspec-deploy.yml file, because
  # that path doesn't exist inside the dist artifact.
  source {
    type      = "CODEPIPELINE"
    buildspec = <<-EOT
      version: 0.2
      phases:
        build:
          commands:
            # Upload everything except index.html with long-lived immutable caching.
            # Vite produces hashed asset filenames, so they're safe to cache forever.
            - aws s3 sync . "s3://$S3_BUCKET/" --delete --exclude "index.html" --cache-control "public, max-age=31536000, immutable"
            # index.html must be revalidated on every request so users pick up new asset hashes.
            - aws s3 cp index.html "s3://$S3_BUCKET/index.html" --cache-control "public, max-age=0, must-revalidate" --content-type "text/html"
            - aws cloudfront create-invalidation --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" --paths "/*"
    EOT
  }

  logs_config {
    cloudwatch_logs {
      group_name = aws_cloudwatch_log_group.frontend_deploy.name
    }
  }
}
