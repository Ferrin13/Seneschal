data "aws_region" "current" {}

# ---------------------------------------------------------------------------
# Backend Temporal worker as a second ECS service.
#
# Runs the same image as the API (from the shared ECR repo) but with the
# command overridden to `dist/temporal/worker.js`. It services the
# `deal-hunter` task queue: Craigslist harvest, all LLM calls, comps,
# evaluation, DB writes, and (on boot) syncing one Temporal Schedule per
# active search target. Facebook load-and-parse runs on the browser box.
#
# Unlike the API this has no ALB and no blue/green: it's a plain rolling ECS
# service. Its task definition is Terraform-managed and pinned to :latest; the
# backend pipeline force-new-deployments the service after each image push.
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/ecs/${var.name_prefix}-worker"
  retention_in_days = var.log_retention_days
}

# ----- Security group -------------------------------------------------------
# Egress-only. Ingress to the app DB and to Temporal's frontend is granted by
# the ROOT module via aws_security_group_rule (to the existing DB SG and the
# temporal service SG respectively).
resource "aws_security_group" "worker" {
  name        = "${var.name_prefix}-worker-sg"
  description = "Deal-hunter worker: egress only (DB + Temporal ingress granted on the target SGs)"
  vpc_id      = var.vpc_id

  egress {
    description = "All egress (ECR, Secrets Manager, Temporal, RDS, OpenRouter, Craigslist)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.name_prefix}-worker-sg"
  }
}

# ----- IAM ------------------------------------------------------------------
data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "task_execution" {
  name               = "${var.name_prefix}-worker-exec-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "task_execution_managed" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "task_execution_secrets" {
  statement {
    sid       = "ReadSecrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [var.db_secret_arn, var.openrouter_secret_arn]
  }

  statement {
    sid       = "DecryptSecrets"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${data.aws_region.current.name}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "task_execution_secrets" {
  name   = "${var.name_prefix}-worker-exec-secrets"
  role   = aws_iam_role.task_execution.id
  policy = data.aws_iam_policy_document.task_execution_secrets.json
}

resource "aws_iam_role" "task" {
  name               = "${var.name_prefix}-worker-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

# ----- Task definition ------------------------------------------------------
locals {
  container_name = "worker"

  # COMPS_REGION and the LLM model slugs are left at their code defaults
  # unless explicitly overridden here.
  base_environment = [
    { name = "NODE_ENV", value = "production" },
    { name = "LOG_LEVEL", value = "info" },
    { name = "FIREBASE_PROJECT_ID", value = var.firebase_project_id },
    { name = "AWS_REGION", value = var.aws_region },
    { name = "TEMPORAL_ADDRESS", value = var.temporal_address },
    { name = "TEMPORAL_NAMESPACE", value = var.temporal_namespace },
    { name = "TEMPORAL_TASK_QUEUE", value = var.temporal_task_queue },
    { name = "TEMPORAL_BROWSER_TASK_QUEUE", value = var.temporal_browser_task_queue },
  ]

  optional_environment = concat(
    var.craigslist_site == "" ? [] : [{ name = "CRAIGSLIST_SITE", value = var.craigslist_site }],
    var.comps_region == "" ? [] : [{ name = "COMPS_REGION", value = var.comps_region }],
  )

  container_definitions = jsonencode([
    {
      name      = local.container_name
      image     = "${var.ecr_repository_url}:${var.image_tag}"
      essential = true
      command   = var.container_command

      environment = concat(local.base_environment, local.optional_environment)

      secrets = [
        { name = "DATABASE_URL", valueFrom = var.db_secret_arn },
        { name = "OPENROUTER_API_KEY", valueFrom = var.openrouter_secret_arn },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.worker.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "worker"
        }
      }
    }
  ])
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${var.name_prefix}-worker"
  cpu                      = tostring(var.cpu)
  memory                   = tostring(var.memory)
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]

  execution_role_arn = aws_iam_role.task_execution.arn
  task_role_arn      = aws_iam_role.task.arn

  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }

  container_definitions = local.container_definitions
}

# ----- Service --------------------------------------------------------------
resource "aws_ecs_service" "worker" {
  name            = "${var.name_prefix}-worker"
  cluster         = var.cluster_id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [aws_security_group.worker.id]
    assign_public_ip = true
  }

  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

  # The pipeline updates the running image via `update-service
  # --force-new-deployment` against this same (Terraform-owned) task def
  # revision, so we do NOT ignore task_definition here — Terraform still owns
  # env/secret changes, and the pipeline only refreshes the image bytes.
}
