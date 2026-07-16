data "aws_region" "current" {}

# Latest Ubuntu 24.04 LTS (x86_64) so google-chrome-stable installs cleanly.
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# ----- Security group ---------------------------------------------------
# Only noVNC (443) and SSH (22) are exposed, restricted to allowed_cidrs.
# CDP (9222) and VNC (5900) bind to localhost on the box and are never opened.
resource "aws_security_group" "box" {
  name        = "${var.name_prefix}-browser-box-sg"
  description = "Browser box: noVNC 443 + SSH 22 from allowed CIDRs only"
  vpc_id      = var.vpc_id

  ingress {
    description = "noVNC (Caddy TLS)"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidrs
  }

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidrs
  }

  egress {
    description = "All egress"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.name_prefix}-browser-box-sg"
    Environment = var.env
  }
}

# ----- IAM: SSM Session Manager + read the agent token ------------------
data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "box" {
  name               = "${var.name_prefix}-browser-box-role"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.box.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "read_token" {
  statement {
    sid       = "ReadAgentToken"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [var.agent_token_secret_arn]
  }
  statement {
    sid       = "DecryptToken"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${data.aws_region.current.name}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "read_token" {
  name   = "${var.name_prefix}-browser-box-read-token"
  role   = aws_iam_role.box.id
  policy = data.aws_iam_policy_document.read_token.json
}

resource "aws_iam_instance_profile" "box" {
  name = "${var.name_prefix}-browser-box-profile"
  role = aws_iam_role.box.name
}

# ----- Optional SSH key -------------------------------------------------
resource "aws_key_pair" "box" {
  count      = var.ssh_public_key == "" ? 0 : 1
  key_name   = "${var.name_prefix}-browser-box"
  public_key = var.ssh_public_key
}

# ----- The instance -----------------------------------------------------
resource "aws_instance" "box" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  subnet_id                   = var.subnet_id
  vpc_security_group_ids      = [aws_security_group.box.id]
  iam_instance_profile        = aws_iam_instance_profile.box.name
  associate_public_ip_address = true
  key_name                    = var.ssh_public_key == "" ? null : aws_key_pair.box[0].key_name

  user_data = base64encode(templatefile("${path.module}/cloud-init.yaml.tftpl", {
    region                 = data.aws_region.current.name
    api_base_url           = var.api_base_url
    agent_token_secret_arn = var.agent_token_secret_arn
    browser_fqdn           = var.browser_fqdn
    novnc_password         = var.novnc_password
    repo_url               = var.repo_url
    repo_branch            = var.repo_branch
    agent_name             = var.agent_name
  }))

  # Replacing user_data alone shouldn't recycle the box (and wipe the FB
  # profile); pull updates via SSM instead.
  lifecycle {
    ignore_changes = [user_data, ami]
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = var.root_volume_gb
    encrypted   = true
  }

  metadata_options {
    http_tokens   = "required"
    http_endpoint = "enabled"
  }

  tags = {
    Name        = "${var.name_prefix}-browser-box"
    Environment = var.env
  }
}

resource "aws_eip" "box" {
  domain   = "vpc"
  instance = aws_instance.box.id

  tags = {
    Name        = "${var.name_prefix}-browser-box-eip"
    Environment = var.env
  }
}

resource "aws_route53_record" "box" {
  zone_id = var.hosted_zone_id
  name    = var.browser_fqdn
  type    = "A"
  ttl     = 300
  records = [aws_eip.box.public_ip]
}
