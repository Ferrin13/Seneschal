data "aws_iam_policy_document" "codepipeline_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["codepipeline.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "codebuild_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["codebuild.amazonaws.com"]
    }
  }
}

# ----- CodePipeline role ----------------------------------------------

resource "aws_iam_role" "codepipeline" {
  name               = "${var.name_prefix}-codepipeline-role"
  assume_role_policy = data.aws_iam_policy_document.codepipeline_assume.json
}

data "aws_iam_policy_document" "codepipeline" {
  statement {
    sid = "ArtifactsBucket"
    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:PutObject",
      "s3:GetBucketVersioning",
      "s3:ListBucket",
    ]
    resources = [
      aws_s3_bucket.artifacts.arn,
      "${aws_s3_bucket.artifacts.arn}/*",
    ]
  }

  statement {
    sid       = "UseGitHubConnection"
    actions   = ["codestar-connections:UseConnection"]
    resources = [aws_codestarconnections_connection.github.arn]
  }

  statement {
    sid = "RunCodeBuild"
    actions = [
      "codebuild:StartBuild",
      "codebuild:BatchGetBuilds",
      "codebuild:StopBuild",
    ]
    resources = concat(
      [
        aws_codebuild_project.backend.arn,
        aws_codebuild_project.backend_migrate.arn,
        aws_codebuild_project.backend_worker_deploy.arn,
        aws_codebuild_project.frontend_build.arn,
        aws_codebuild_project.frontend_deploy.arn,
      ],
      aws_codebuild_project.agent_build[*].arn,
      aws_codebuild_project.agent_deploy[*].arn,
    )
  }

  # Required for the CodeDeployToECS pipeline action: CodePipeline reads
  # the deployment group + rev objects, creates a deployment, and polls
  # it until it succeeds or fails.
  statement {
    sid = "CodeDeploy"
    actions = [
      "codedeploy:CreateDeployment",
      "codedeploy:GetDeployment",
      "codedeploy:GetDeploymentConfig",
      "codedeploy:GetApplicationRevision",
      "codedeploy:RegisterApplicationRevision",
      "codedeploy:GetApplication",
    ]
    resources = ["*"]
  }

  # The CodeDeployToECS pipeline action registers a new task definition
  # revision from the taskdef.json in `build_output` *before* creating
  # the CodeDeploy deployment, and uses the pipeline role to do it.
  # Read perms are also needed so the action can surface deployment
  # failures into the pipeline UI.
  statement {
    sid = "EcsTaskDefAndRead"
    actions = [
      "ecs:RegisterTaskDefinition",
      "ecs:DescribeTaskDefinition",
      "ecs:DescribeServices",
      "ecs:DescribeTasks",
      "ecs:ListTasks",
    ]
    resources = ["*"]
  }

  # The CodeDeployToECS pipeline action passes the CodeDeploy service
  # role to CodeDeploy when creating each deployment. Without this the
  # action fails immediately with an iam:PassRole error.
  statement {
    sid       = "PassCodeDeployRole"
    actions   = ["iam:PassRole"]
    resources = [var.codedeploy_role_arn]
    condition {
      test     = "StringEqualsIfExists"
      variable = "iam:PassedToService"
      values   = ["codedeploy.amazonaws.com"]
    }
  }

  # PassRole to ecs-tasks.amazonaws.com is still needed because the
  # CodeBuild step (Migrate stage) registers fresh revisions of the
  # migrate task family and runs them, passing the task / execution
  # roles. The Deploy stage no longer relies on this.
  statement {
    sid       = "PassRolesToEcs"
    actions   = ["iam:PassRole"]
    resources = [var.task_execution_role_arn, var.task_role_arn]
    condition {
      test     = "StringEqualsIfExists"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "codepipeline" {
  role   = aws_iam_role.codepipeline.id
  policy = data.aws_iam_policy_document.codepipeline.json
}

# ----- CodeBuild role -------------------------------------------------

resource "aws_iam_role" "codebuild" {
  name               = "${var.name_prefix}-codebuild-role"
  assume_role_policy = data.aws_iam_policy_document.codebuild_assume.json
}

data "aws_iam_policy_document" "codebuild" {
  statement {
    sid = "Artifacts"
    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:PutObject",
      "s3:GetBucketVersioning",
      "s3:ListBucket",
    ]
    resources = [
      aws_s3_bucket.artifacts.arn,
      "${aws_s3_bucket.artifacts.arn}/*",
    ]
  }

  statement {
    sid = "Logs"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = [
      "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/codebuild/*",
    ]
  }

  statement {
    sid = "EcrAuth"
    actions = [
      "ecr:GetAuthorizationToken",
    ]
    resources = ["*"]
  }

  # Allow pulling base images from ECR Public (e.g. public.ecr.aws/docker/library/node)
  # to avoid Docker Hub anonymous pull rate limits in CodeBuild.
  statement {
    sid = "EcrPublicAuth"
    actions = [
      "ecr-public:GetAuthorizationToken",
      "sts:GetServiceBearerToken",
    ]
    resources = ["*"]
  }

  statement {
    sid = "EcrPush"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:CompleteLayerUpload",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = [
      "arn:aws:ecr:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:repository/${var.ecr_repository_name}",
    ]
  }

  statement {
    sid = "FrontendBucket"
    actions = [
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:GetObject",
      "s3:ListBucket",
    ]
    resources = [
      var.frontend_bucket_arn,
      "${var.frontend_bucket_arn}/*",
    ]
  }

  statement {
    sid = "CloudFrontInvalidate"
    actions = [
      "cloudfront:CreateInvalidation",
      "cloudfront:GetInvalidation",
    ]
    resources = [var.cloudfront_distribution_arn]
  }

  statement {
    sid = "CodeBuildReports"
    actions = [
      "codebuild:CreateReportGroup",
      "codebuild:CreateReport",
      "codebuild:UpdateReport",
      "codebuild:BatchPutTestCases",
      "codebuild:BatchPutCodeCoverages",
    ]
    resources = ["*"]
  }

  # Used by the migrate CodeBuild step to register a new revision of the
  # migrate task def, run it on Fargate, wait, and check the exit code; and
  # by the worker-deploy step to force a new deployment of the worker service
  # (UpdateService + DescribeServices for the `wait services-stable` poll).
  statement {
    sid = "EcsRunMigrateAndDeployWorker"
    actions = [
      "ecs:DescribeTaskDefinition",
      "ecs:RegisterTaskDefinition",
      "ecs:RunTask",
      "ecs:DescribeTasks",
      "ecs:StopTask",
      "ecs:ListTasks",
      "ecs:UpdateService",
      "ecs:DescribeServices",
    ]
    resources = ["*"]
  }

  statement {
    sid       = "PassEcsRoles"
    actions   = ["iam:PassRole"]
    resources = [var.task_execution_role_arn, var.task_role_arn]
    condition {
      test     = "StringEqualsIfExists"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }

  # Agent pipeline: upload the built artifact to the releases bucket.
  dynamic "statement" {
    for_each = var.enable_agent_pipeline ? [1] : []
    content {
      sid       = "AgentArtifactUpload"
      actions   = ["s3:PutObject"]
      resources = ["${var.agent_releases_bucket_arn}/agent/*"]
    }
  }

  # Agent pipeline: redeploy the browser box via SSM RunCommand.
  dynamic "statement" {
    for_each = var.enable_agent_pipeline ? [1] : []
    content {
      sid = "AgentSsmDeploy"
      actions = [
        "ssm:SendCommand",
      ]
      resources = [
        "arn:aws:ec2:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:instance/${var.browser_box_instance_id}",
        "arn:aws:ssm:${data.aws_region.current.name}::document/AWS-RunShellScript",
      ]
    }
  }

  dynamic "statement" {
    for_each = var.enable_agent_pipeline ? [1] : []
    content {
      sid = "AgentSsmPoll"
      actions = [
        "ssm:GetCommandInvocation",
        "ssm:ListCommandInvocations",
      ]
      resources = ["*"]
    }
  }
}

resource "aws_iam_role_policy" "codebuild" {
  role   = aws_iam_role.codebuild.id
  policy = data.aws_iam_policy_document.codebuild.json
}
