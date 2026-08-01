resource "aws_lb" "api" {
  name               = "${var.name_prefix}-alb"
  load_balancer_type = "application"
  internal           = false
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.public_subnet_ids

  # Long enough for Lazax WebSocket heartbeats (~25s) with headroom; AWS max is 4000.
  # Idle timeout is not max session length — heartbeats keep sockets non-idle for multi-hour games.
  idle_timeout = 4000
}

# Two interchangeable target groups for the CodeDeploy ECS Blue/Green
# deploy. Whichever one currently has the production listener attached
# is "live"; CodeDeploy registers the new task set against the other,
# shifts traffic, and then drains the old set. The names are kept stable
# (no random suffix) so external scripts / dashboards can hard-code them.
resource "aws_lb_target_group" "blue" {
  name        = "${var.name_prefix}-tg-blue"
  port        = var.container_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/healthz"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  deregistration_delay = 30
}

resource "aws_lb_target_group" "green" {
  name        = "${var.name_prefix}-tg-green"
  port        = var.container_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/healthz"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  deregistration_delay = 30
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.api.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

# Production listener. CodeDeploy flips its `default_action.target_group_arn`
# between blue and green during a deploy, so Terraform must ignore drift on
# that attribute or every other `terraform apply` would forcibly snap traffic
# back to the original target group mid-deploy.
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.api.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.api.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.blue.arn
  }

  lifecycle {
    ignore_changes = [default_action]
  }
}

# Test listener. Required by CodeDeploy ECS Blue/Green: the replacement
# task set is registered against this listener so the deploy can run
# validation hooks against it before flipping production traffic. We
# expose it on the same TLS cert / SG so smoke tests can hit it via
# https://<api_fqdn>:8443 (SG already allows 443; we add 8443 below).
resource "aws_lb_listener" "test" {
  load_balancer_arn = aws_lb.api.arn
  port              = 8443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.api.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.green.arn
  }

  lifecycle {
    ignore_changes = [default_action]
  }
}

resource "aws_route53_record" "api" {
  zone_id = var.hosted_zone_id
  name    = var.api_fqdn
  type    = "A"

  alias {
    name                   = aws_lb.api.dns_name
    zone_id                = aws_lb.api.zone_id
    evaluate_target_health = true
  }
}
