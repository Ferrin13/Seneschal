data "aws_region" "current" {}

# Latest Ubuntu 24.04 LTS (x86_64).
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
# Only SSH (22) is exposed, restricted to allowed_cidrs. SSH also carries the
# reverse tunnel (box 127.0.0.1:9222 -> operator's local Chrome CDP), so no
# other inbound ports are needed. The agent's outbound traffic (Temporal, API,
# S3) uses egress.
#
# NOTE: `description` is kept verbatim from when this box also ran noVNC. An SG
# description is immutable, so editing it forces a full SG replacement, which
# deadlocks (the SG is attached to the instance ENI and referenced by the
# Temporal ingress rule). Removing the 443/80 ingress below is an in-place
# change, so we leave the description alone to avoid the churn.
resource "aws_security_group" "box" {
  name        = "${var.name_prefix}-browser-box-sg"
  description = "Browser box: noVNC 443 + SSH 22 from allowed CIDRs only"
  vpc_id      = var.vpc_id

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
  # Pull the CI-built scraper-agent artifact.
  statement {
    sid       = "ReadAgentArtifact"
    actions   = ["s3:GetObject"]
    resources = ["arn:aws:s3:::${var.agent_releases_bucket}/agent/*"]
  }
  statement {
    sid       = "ListAgentBucket"
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::${var.agent_releases_bucket}"]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["agent/*"]
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

# ----- The instance -----------------------------------------------------
# SSH access is provisioned via cloud-init `ssh_authorized_keys` (below) rather
# than an EC2 key pair, so setting/rotating the key never forces an instance
# replacement (user_data is ignored post-launch).
resource "aws_instance" "box" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  subnet_id                   = var.subnet_id
  vpc_security_group_ids      = [aws_security_group.box.id]
  iam_instance_profile        = aws_iam_instance_profile.box.name
  associate_public_ip_address = true

  user_data = base64encode(templatefile("${path.module}/cloud-init.yaml.tftpl", {
    region                 = data.aws_region.current.name
    api_base_url           = var.api_base_url
    agent_token_secret_arn = var.agent_token_secret_arn
    ssh_public_key         = var.ssh_public_key
    agent_releases_bucket  = var.agent_releases_bucket
    agent_name             = var.agent_name
    temporal_address       = var.temporal_address
    temporal_namespace     = var.temporal_namespace
    browser_task_queue     = var.browser_task_queue
  }))

  # Replacing user_data / AMI alone shouldn't recycle the box; the agent is
  # updated in place via the pipeline's SSM RunCommand (deploy-agent.sh).
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
