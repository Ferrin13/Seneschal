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
      name = "RunDrizzleMigrate"
      category = "Build"
      owner    = "AWS"
      provider = "CodeBuild"
      version  = "1"
      # First artifact is the primary: CodeBuild runs from there and reads
      # the buildspec there. Second artifact is mounted at
      # $CODEBUILD_SRC_DIR_build_output, which is where imagedefinitions.json
      # lives (produced by the previous Build action).
      input_artifacts = ["source_output", "build_output"]

      configuration = {
        ProjectName   = aws_codebuild_project.backend_migrate.name
        PrimarySource = "source_output"
      }
    }
  }

  stage {
    name = "Deploy"

    action {
      name            = "DeployToEcs"
      category        = "Deploy"
      owner           = "AWS"
      provider        = "ECS"
      version         = "1"
      input_artifacts = ["build_output"]

      configuration = {
        ClusterName       = var.ecs_cluster_name
        ServiceName       = var.ecs_service_name
        FileName          = "imagedefinitions.json"
        DeploymentTimeout = "10"
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
