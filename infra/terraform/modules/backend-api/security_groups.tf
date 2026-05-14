resource "aws_security_group" "alb" {
  name        = "${var.name_prefix}-alb-sg"
  description = "ALB ingress 80/443 from internet"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTP from anywhere (redirects to HTTPS)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS from anywhere"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "All egress"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "service" {
  name        = "${var.name_prefix}-service-sg"
  description = "ECS service SG; ingress from ALB only"
  vpc_id      = var.vpc_id

  ingress {
    description     = "App port from ALB"
    from_port       = var.container_port
    to_port         = var.container_port
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    description = "All egress (ECR, Secrets Manager, RDS, etc.)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# Open the existing DB SG to the ECS service SG on the Postgres port.
# This is the Terraform equivalent of `db.connections.allowDefaultPortFrom`
# in the original CDK stack.
resource "aws_security_group_rule" "db_from_service" {
  type                     = "ingress"
  from_port                = var.db_port
  to_port                  = var.db_port
  protocol                 = "tcp"
  security_group_id        = var.db_security_group_id
  source_security_group_id = aws_security_group.service.id
  description              = "${var.name_prefix} ECS service to Postgres"
}
