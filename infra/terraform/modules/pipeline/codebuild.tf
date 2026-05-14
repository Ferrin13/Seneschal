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

  source {
    type      = "CODEPIPELINE"
    buildspec = "frontend/buildspec-deploy.yml"
  }

  logs_config {
    cloudwatch_logs {
      group_name = aws_cloudwatch_log_group.frontend_deploy.name
    }
  }
}
