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
  task_family = "${var.name_prefix}-api"
}

# NOTE: there is intentionally NO `aws_ecs_task_definition.api` resource
# here. The task definition is now rendered from `backend/taskdef.json`
# in the CodeBuild project (using env vars from this module) and
# registered by CodeDeploy on every deploy. Keeping it in Terraform was
# what caused the long-standing "env var added in TF but never reaches
# prod" footgun — see modules/pipeline/pipelines.tf for the deploy flow.

# Standalone "migrate" task definition. Still Terraform-managed: it isn't
# part of the rolling deploy path, and the migrate CodeBuild step
# registers fresh revisions of it on the fly from the live revision.
locals {
  migrate_container_definitions = jsonencode([
    {
      name      = "${var.container_name}-migrate"
      image     = "${aws_ecr_repository.api.repository_url}:${var.image_tag}"
      essential = true
      # The distroless nodejs base image has ENTRYPOINT=["/nodejs/bin/node"],
      # so the command is just the script path. Adding "node" here would
      # produce `node node dist/...` and break.
      command = ["dist/db/migrate.js"]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "LOG_LEVEL", value = "info" },
        # Not used by the migration, but the shared config.ts loads on import
        # via db/client.ts and demands this var. Cheaper than refactoring.
        { name = "FIREBASE_PROJECT_ID", value = var.firebase_project_id },
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

# Bootstrap task definition for the API service. The service must be
# created against *some* revision, and ECS spins up the initial task set
# from that revision before the first CodeDeploy deployment ever runs.
# We mirror what `backend/taskdef.json` produces so the very first task
# set is a working container — otherwise the freshly-created service
# would crash-loop on "DATABASE_URL not set" until the first pipeline
# deploy completed, and a `terraform apply` that recreates the service
# (e.g. flipping `deployment_controller` from ECS to CODE_DEPLOY) would
# briefly leave prod down.
#
# After the first CodeDeploy deployment lands, this resource diverges
# from the live revision and the `ignore_changes` below stops Terraform
# from trying to reconcile.
locals {
  bootstrap_container_definitions = jsonencode([
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
        { name = "AWS_REGION", value = data.aws_region.current.name },
        { name = "S3_BUCKET", value = aws_s3_bucket.images.bucket },
      ]

      secrets = [
        { name = "DATABASE_URL", valueFrom = local.db_secret_arn },
        { name = "GOOGLE_APPLICATION_CREDENTIALS_JSON", valueFrom = local.firebase_ssm_arn },
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

resource "aws_ecs_task_definition" "bootstrap" {
  family                   = local.task_family
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

  container_definitions = local.bootstrap_container_definitions

  # CodeDeploy registers new revisions of this family on every deploy,
  # so the family will diverge from this resource's content as soon as
  # the first deploy lands. Don't fight that.
  lifecycle {
    ignore_changes = [container_definitions]
  }
}

resource "aws_ecs_service" "api" {
  name            = "${var.name_prefix}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.bootstrap.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  deployment_controller {
    type = "CODE_DEPLOY"
  }

  network_configuration {
    subnets         = var.private_subnet_ids
    security_groups = [aws_security_group.service.id]
    # The target VPC has no NAT gateway, so Fargate tasks need a public IP
    # to reach ECR, Secrets Manager, and CloudWatch Logs through the IGW.
    # Inbound traffic is still gated by the service security group, which
    # only accepts traffic from the ALB SG on the container port.
    assign_public_ip = true
  }

  # Initial association is with the blue target group; CodeDeploy will
  # flip the service's task set to green on every deploy and back again
  # on the next one. Terraform must not touch this attribute after
  # creation, or it will rip the service away from whichever target
  # group is currently serving production.
  load_balancer {
    target_group_arn = aws_lb_target_group.blue.arn
    container_name   = var.container_name
    container_port   = var.container_port
  }

  health_check_grace_period_seconds = 30

  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200

  # CodeDeploy owns task_definition and load_balancer once the service
  # is created; everything else (desired_count, network_configuration,
  # ...) stays Terraform-managed.
  lifecycle {
    ignore_changes = [task_definition, load_balancer]
  }

  depends_on = [aws_lb_listener.https, aws_lb_listener.test]
}

# ----- CodeDeploy application and deployment group --------------------

resource "aws_codedeploy_app" "api" {
  name             = "${var.name_prefix}-api"
  compute_platform = "ECS"
}

resource "aws_codedeploy_deployment_group" "api" {
  app_name               = aws_codedeploy_app.api.name
  deployment_group_name  = "${var.name_prefix}-api-dg"
  service_role_arn       = aws_iam_role.codedeploy.arn
  deployment_config_name = "CodeDeployDefault.ECSAllAtOnce"

  deployment_style {
    deployment_option = "WITH_TRAFFIC_CONTROL"
    deployment_type   = "BLUE_GREEN"
  }

  blue_green_deployment_config {
    deployment_ready_option {
      action_on_timeout = "CONTINUE_DEPLOYMENT"
    }

    # Tear down the old (blue) task set five minutes after traffic has
    # fully shifted, so a fresh deploy can be rolled back via the
    # CodeDeploy console while the old set is still alive.
    terminate_blue_instances_on_deployment_success {
      action                           = "TERMINATE"
      termination_wait_time_in_minutes = 5
    }
  }

  ecs_service {
    cluster_name = aws_ecs_cluster.main.name
    service_name = aws_ecs_service.api.name
  }

  load_balancer_info {
    target_group_pair_info {
      prod_traffic_route {
        listener_arns = [aws_lb_listener.https.arn]
      }
      test_traffic_route {
        listener_arns = [aws_lb_listener.test.arn]
      }
      target_group {
        name = aws_lb_target_group.blue.name
      }
      target_group {
        name = aws_lb_target_group.green.name
      }
    }
  }

  auto_rollback_configuration {
    enabled = true
    events  = ["DEPLOYMENT_FAILURE", "DEPLOYMENT_STOP_ON_ALARM"]
  }
}
