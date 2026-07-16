resource "aws_codepipeline" "backend" {
  name     = "${var.name_prefix}-backend"
  role_arn = aws_iam_role.codepipeline.arn

  pipeline_type = "V2"

  artifact_store {
    location = aws_s3_bucket.artifacts.bucket
    type     = "S3"
  }

  stage {
    name = "Source"

    action {
      name             = "Source"
      category         = "Source"
      owner            = "AWS"
      provider         = "CodeStarSourceConnection"
      version          = "1"
      output_artifacts = ["source_output"]

      configuration = {
        ConnectionArn        = aws_codestarconnections_connection.github.arn
        FullRepositoryId     = "${var.github_owner}/${var.github_repo}"
        BranchName           = var.github_branch
        OutputArtifactFormat = "CODE_ZIP"
      }
    }
  }

  stage {
    name = "Build"

    action {
      name             = "BuildAndPush"
      category         = "Build"
      owner            = "AWS"
      provider         = "CodeBuild"
      version          = "1"
      input_artifacts  = ["source_output"]
      output_artifacts = ["build_output"]

      configuration = {
        ProjectName = aws_codebuild_project.backend.name
      }
    }
  }

  # Runs drizzle migrations against the new image before rolling traffic
  # over. If migrations fail, the pipeline stops here and the running
  # ECS service is untouched.
  stage {
    name = "Migrate"

    action {
      name     = "RunDrizzleMigrate"
      category = "Build"
      owner    = "AWS"
      provider = "CodeBuild"
      version  = "1"
      # First artifact is the primary: CodeBuild runs from there and reads
      # the buildspec there. Second artifact is mounted at
      # $CODEBUILD_SRC_DIR_build_output, which is where taskdef.json lives
      # (produced by the previous Build action). buildspec-migrate.yml
      # reads the image URI out of taskdef.json's containerDefinitions[0].
      input_artifacts = ["source_output", "build_output"]

      configuration = {
        ProjectName   = aws_codebuild_project.backend_migrate.name
        PrimarySource = "source_output"
      }
    }
  }

  # CodeDeploy ECS Blue/Green. The build stage emits a fully-rendered
  # taskdef.json (with the freshly-pushed image URI and every env-specific
  # value already sed'd in) and the matching appspec.yaml; CodeDeploy
  # registers a new task definition revision from taskdef.json, swaps the
  # `<TASK_DEFINITION>` token in appspec.yaml with that revision's ARN,
  # creates a replacement task set behind the green target group, runs
  # health checks, then flips the production listener.
  #
  # Image URI is baked into taskdef.json by the buildspec, so we do NOT
  # configure Image1ArtifactName / Image1ContainerName here. (The
  # CodeDeploy ECS action allows you to use either model.)
  stage {
    name = "Deploy"

    action {
      name            = "DeployToEcs"
      category        = "Deploy"
      owner           = "AWS"
      provider        = "CodeDeployToECS"
      version         = "1"
      input_artifacts = ["build_output"]

      configuration = {
        ApplicationName                = var.codedeploy_application_name
        DeploymentGroupName            = var.codedeploy_deployment_group_name
        TaskDefinitionTemplateArtifact = "build_output"
        TaskDefinitionTemplatePath     = "taskdef.json"
        AppSpecTemplateArtifact        = "build_output"
        AppSpecTemplatePath            = "appspec.yaml"
      }
    }
  }

  # Roll the deal-hunter worker onto the freshly-pushed image. Runs after the
  # API is healthy so schema migrations (Migrate stage) are already applied.
  stage {
    name = "DeployWorker"

    action {
      name            = "RedeployWorker"
      category        = "Build"
      owner           = "AWS"
      provider        = "CodeBuild"
      version         = "1"
      input_artifacts = ["source_output"]

      configuration = {
        ProjectName = aws_codebuild_project.backend_worker_deploy.name
      }
    }
  }

  # Only run when files under backend/ change.
  trigger {
    provider_type = "CodeStarSourceConnection"

    git_configuration {
      source_action_name = "Source"

      push {
        branches {
          includes = [var.github_branch]
        }
        file_paths {
          includes = ["backend/**"]
        }
      }
    }
  }
}

resource "aws_codepipeline" "frontend" {
  name     = "${var.name_prefix}-frontend"
  role_arn = aws_iam_role.codepipeline.arn

  pipeline_type = "V2"

  artifact_store {
    location = aws_s3_bucket.artifacts.bucket
    type     = "S3"
  }

  stage {
    name = "Source"

    action {
      name             = "Source"
      category         = "Source"
      owner            = "AWS"
      provider         = "CodeStarSourceConnection"
      version          = "1"
      output_artifacts = ["source_output"]

      configuration = {
        ConnectionArn        = aws_codestarconnections_connection.github.arn
        FullRepositoryId     = "${var.github_owner}/${var.github_repo}"
        BranchName           = var.github_branch
        OutputArtifactFormat = "CODE_ZIP"
      }
    }
  }

  stage {
    name = "Build"

    action {
      name             = "BuildSpa"
      category         = "Build"
      owner            = "AWS"
      provider         = "CodeBuild"
      version          = "1"
      input_artifacts  = ["source_output"]
      output_artifacts = ["spa_dist"]

      configuration = {
        ProjectName = aws_codebuild_project.frontend_build.name
      }
    }
  }

  stage {
    name = "Deploy"

    action {
      name            = "SyncToS3AndInvalidate"
      category        = "Build"
      owner           = "AWS"
      provider        = "CodeBuild"
      version         = "1"
      input_artifacts = ["spa_dist"]

      configuration = {
        ProjectName = aws_codebuild_project.frontend_deploy.name
      }
    }
  }

  trigger {
    provider_type = "CodeStarSourceConnection"

    git_configuration {
      source_action_name = "Source"

      push {
        branches {
          includes = [var.github_branch]
        }
        file_paths {
          includes = ["frontend/**"]
        }
      }
    }
  }
}

# Scraper-agent pipeline: build the artifact, ship it to S3, then tell the
# browser box (via SSM) to pull it and restart. Only created when the browser
# box is enabled. Triggered by pushes under agent/**.
resource "aws_codepipeline" "agent" {
  count    = var.enable_agent_pipeline ? 1 : 0
  name     = "${var.name_prefix}-agent"
  role_arn = aws_iam_role.codepipeline.arn

  pipeline_type = "V2"

  artifact_store {
    location = aws_s3_bucket.artifacts.bucket
    type     = "S3"
  }

  stage {
    name = "Source"

    action {
      name             = "Source"
      category         = "Source"
      owner            = "AWS"
      provider         = "CodeStarSourceConnection"
      version          = "1"
      output_artifacts = ["source_output"]

      configuration = {
        ConnectionArn        = aws_codestarconnections_connection.github.arn
        FullRepositoryId     = "${var.github_owner}/${var.github_repo}"
        BranchName           = var.github_branch
        OutputArtifactFormat = "CODE_ZIP"
      }
    }
  }

  stage {
    name = "Build"

    action {
      name             = "BuildAndUpload"
      category         = "Build"
      owner            = "AWS"
      provider         = "CodeBuild"
      version          = "1"
      input_artifacts  = ["source_output"]
      output_artifacts = ["agent_build_output"]

      configuration = {
        ProjectName = aws_codebuild_project.agent_build[0].name
      }
    }
  }

  stage {
    name = "Deploy"

    action {
      name            = "RedeployAgent"
      category        = "Build"
      owner           = "AWS"
      provider        = "CodeBuild"
      version         = "1"
      input_artifacts = ["source_output"]

      configuration = {
        ProjectName = aws_codebuild_project.agent_deploy[0].name
      }
    }
  }

  trigger {
    provider_type = "CodeStarSourceConnection"

    git_configuration {
      source_action_name = "Source"

      push {
        branches {
          includes = [var.github_branch]
        }
        file_paths {
          includes = ["agent/**"]
        }
      }
    }
  }
}
