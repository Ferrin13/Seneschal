resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${var.name_prefix}-api"
  retention_in_days = var.log_retention_days
}

resource "aws_ecs_cluster" "main" {
  name = "${var.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
    base              = 1
  }
}

locals {
  container_definitions = jsonencode([
    {
      name      = var.container_name
      image     = "${aws_ecr_repository.api.repository_url}:${var.image_tag}"
      essential = true

      portMappings = [
        {
          containerPort = var.container_port
          protocol      = "tcp"
        }
      ]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = tostring(var.container_port) },
        { name = "LOG_LEVEL", value = "info" },
        { name = "FIREBASE_PROJECT_ID", value = var.firebase_project_id },
        { name = "CORS_ORIGINS", value = var.cors_origins },
      ]

      secrets = [
        {
          name      = "DATABASE_URL"
          valueFrom = local.db_secret_arn
        },
        {
          name      = "GOOGLE_APPLICATION_CREDENTIALS_JSON"
          valueFrom = local.firebase_ssm_arn
        },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.name_prefix}-api"
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

# Standalone "migrate" task definition. Identical to the service task def
# but runs `node dist/db/migrate.js` instead of the API entrypoint, exits
# when migrations finish, and is invoked by the backend pipeline as a
# one-off ECS RunTask between Build and Deploy.
locals {
  migrate_container_definitions = jsonencode([
    {
      name      = "${var.container_name}-migrate"
      image     = "${aws_ecr_repository.api.repository_url}:${var.image_tag}"
      essential = true
      command   = ["node", "dist/db/migrate.js"]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "LOG_LEVEL", value = "info" },
      ]

      secrets = [
        {
          name      = "DATABASE_URL"
          valueFrom = local.db_secret_arn
        },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "migrate"
        }
      }
    }
  ])
}

resource "aws_ecs_task_definition" "migrate" {
  family                   = "${var.name_prefix}-api-migrate"
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

  container_definitions = local.migrate_container_definitions
}

resource "aws_ecs_service" "api" {
  name            = "${var.name_prefix}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.private_subnet_ids
    security_groups = [aws_security_group.service.id]
    # The target VPC has no NAT gateway, so Fargate tasks need a public IP
    # to reach ECR, Secrets Manager, and CloudWatch Logs through the IGW.
    # Inbound traffic is still gated by the service security group, which
    # only accepts traffic from the ALB SG on the container port.
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = var.container_name
    container_port   = var.container_port
  }

  health_check_grace_period_seconds = 30

  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200

  # The pipeline updates the task definition revision out-of-band via the
  # CodePipeline ECS deploy action. Ignore that here so Terraform doesn't
  # fight the pipeline. desired_count stays Terraform-managed; switch to
  # ignoring it too if/when you add Application Auto Scaling.
  lifecycle {
    ignore_changes = [task_definition]
  }

  depends_on = [aws_lb_listener.https]
}
