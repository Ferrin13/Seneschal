data "aws_region" "current" {}

# ---------------------------------------------------------------------------
# Self-hosted, single-node Temporal cluster on ECS Fargate.
#
# This is intentionally its own ECS cluster + RDS instance under the
# "parthadae" prefix rather than sharing seneschal's, because the intent is a
# shared workflow-orchestration backbone that other parthadae products can
# also point their workers at. Clients discover it via Cloud Map private DNS
# at temporal.<namespace_domain>:7233.
# ---------------------------------------------------------------------------

resource "aws_ecs_cluster" "temporal" {
  name = "${var.name_prefix}-temporal"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "temporal" {
  cluster_name       = aws_ecs_cluster.temporal.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
    base              = 1
  }
}

# ----- Service discovery (private DNS) --------------------------------------
resource "aws_service_discovery_private_dns_namespace" "internal" {
  name        = var.namespace_domain
  description = "Private DNS namespace for shared parthadae services"
  vpc         = var.vpc_id
}

resource "aws_service_discovery_service" "temporal" {
  name = "temporal"

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.internal.id

    dns_records {
      type = "A"
      ttl  = 15
    }

    routing_policy = "MULTIVALUE"
  }
}

# ----- RDS Postgres backing the cluster -------------------------------------
resource "random_password" "db" {
  length  = 24
  special = false
}

resource "aws_secretsmanager_secret" "db" {
  name        = "${var.name_prefix}/temporal/db-password"
  description = "Master password for the ${var.name_prefix} Temporal Postgres instance."
}

resource "aws_secretsmanager_secret_version" "db" {
  secret_id     = aws_secretsmanager_secret.db.id
  secret_string = random_password.db.result
}

resource "aws_db_subnet_group" "temporal" {
  name       = "${var.name_prefix}-temporal"
  subnet_ids = var.subnet_ids
}

resource "aws_security_group" "db" {
  name        = "${var.name_prefix}-temporal-db-sg"
  description = "Temporal RDS: Postgres ingress from the Temporal server only"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Postgres from the Temporal server task"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.service.id]
  }

  egress {
    description = "All egress"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.name_prefix}-temporal-db-sg"
  }
}

resource "aws_db_instance" "temporal" {
  identifier     = "${var.name_prefix}-temporal"
  engine         = "postgres"
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class

  allocated_storage = var.db_allocated_storage
  storage_type      = "gp3"
  storage_encrypted = true

  # auto-setup creates the `temporal` and `temporal_visibility` databases
  # itself using the master user, so we don't declare an initial db_name.
  # The master username MUST differ from DBNAME ("temporal"): auto-setup only
  # runs its CREATE DATABASE step when DBNAME != POSTGRES_USER (otherwise it
  # assumes the Postgres Docker image already made a same-named DB, which RDS
  # does not). See modules/temporal/main.tf POSTGRES_USER env below.
  username = local.db_username
  password = random_password.db.result

  db_subnet_group_name    = aws_db_subnet_group.temporal.name
  vpc_security_group_ids  = [aws_security_group.db.id]
  publicly_accessible     = false
  multi_az                = false
  backup_retention_period = 7
  deletion_protection     = var.db_deletion_protection
  skip_final_snapshot     = true
  apply_immediately       = true

  tags = {
    Name = "${var.name_prefix}-temporal"
  }
}

# ----- Security group for the Temporal service ------------------------------
# Ingress on the frontend port is granted by the ROOT module via dedicated
# aws_security_group_rule resources for each client SG (backend API, worker,
# browser box) — keeping those rules in the root avoids a module dependency
# cycle (the clients need this SG's id, and this SG would need theirs).
resource "aws_security_group" "service" {
  name        = "${var.name_prefix}-temporal-svc-sg"
  description = "Temporal server: frontend gRPC ingress from clients (rules added by root)"
  vpc_id      = var.vpc_id

  egress {
    description = "All egress (RDS, image pulls, Secrets Manager, logs)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.name_prefix}-temporal-svc-sg"
  }
}

# ----- Logs -----------------------------------------------------------------
resource "aws_cloudwatch_log_group" "temporal" {
  name              = "/ecs/${var.name_prefix}-temporal"
  retention_in_days = var.log_retention_days
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
  name               = "${var.name_prefix}-temporal-exec-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "task_execution_managed" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Let the execution role read the DB password secret at task startup.
data "aws_iam_policy_document" "task_execution_secrets" {
  statement {
    sid       = "ReadDbPassword"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.db.arn]
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
  name   = "${var.name_prefix}-temporal-exec-secrets"
  role   = aws_iam_role.task_execution.id
  policy = data.aws_iam_policy_document.task_execution_secrets.json
}

resource "aws_iam_role" "task" {
  name               = "${var.name_prefix}-temporal-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

# ----- Task definition ------------------------------------------------------
locals {
  container_name = "temporal"
  # Must differ from DBNAME so auto-setup creates the databases (see the
  # username comment on aws_db_instance.temporal above).
  db_username = "temporaladmin"

  container_definitions = jsonencode([
    {
      name      = local.container_name
      image     = var.temporal_image
      essential = true

      portMappings = [
        {
          containerPort = var.frontend_port
          protocol      = "tcp"
        }
      ]

      environment = [
        # Postgres backend (see infra/temporal/docker-compose.yml for the
        # local-dev equivalent).
        { name = "DB", value = "postgres12" },
        { name = "DB_PORT", value = "5432" },
        { name = "POSTGRES_USER", value = local.db_username },
        { name = "POSTGRES_SEEDS", value = aws_db_instance.temporal.address },
        { name = "DBNAME", value = "temporal" },
        { name = "VISIBILITY_DBNAME", value = "temporal_visibility" },
        # Single-node: bind on all interfaces so the Cloud Map A record
        # (task ENI IP) is reachable on the frontend port.
        { name = "BIND_ON_IP", value = "0.0.0.0" },
        # Custom search attributes require a running cluster; skip so the
        # setup step doesn't race the frontend coming up.
        { name = "SKIP_ADD_CUSTOM_SEARCH_ATTRIBUTES", value = "true" },
        # RDS enforces SSL (rds.force_ssl=1 on the default PG16 parameter
        # group). Connect over TLS; RDS's cert CN won't match the endpoint
        # host, so skip host verification (traffic stays inside the VPC).
        { name = "POSTGRES_TLS_ENABLED", value = "true" },
        { name = "POSTGRES_TLS_DISABLE_HOST_VERIFICATION", value = "true" },
        { name = "SQL_TLS_ENABLED", value = "true" },
        { name = "SQL_TLS_DISABLE_HOST_VERIFICATION", value = "true" },
      ]

      secrets = [
        { name = "POSTGRES_PWD", valueFrom = aws_secretsmanager_secret.db.arn },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.temporal.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "temporal"
        }
      }
    }
  ])
}

resource "aws_ecs_task_definition" "temporal" {
  family                   = "${var.name_prefix}-temporal"
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
resource "aws_ecs_service" "temporal" {
  name            = "${var.name_prefix}-temporal"
  cluster         = aws_ecs_cluster.temporal.id
  task_definition = aws_ecs_task_definition.temporal.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.subnet_ids
    security_groups = [aws_security_group.service.id]
    # No NAT in the target VPC, so the task needs a public IP to pull the
    # image and reach Secrets Manager / CloudWatch. RDS access stays private
    # via the DB security group.
    assign_public_ip = true
  }

  service_registries {
    registry_arn = aws_service_discovery_service.temporal.arn
  }

  # Give the schema-setup step time before the frontend health-registers.
  health_check_grace_period_seconds = 60

  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

  depends_on = [aws_db_instance.temporal]
}
