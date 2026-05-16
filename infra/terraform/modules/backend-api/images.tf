# S3 bucket holding user-uploaded images (e.g. expense receipt photos).
# Bytes are uploaded by clients via short-lived presigned URLs that the API
# mints; the API itself never streams the bytes. Objects are namespaced by
# user id under `users/<userId>/...` so a single bucket policy can keep all
# tenants isolated. See backend/src/routes/uploads.ts.

resource "aws_s3_bucket" "images" {
  bucket = "${var.name_prefix}-images"
}

resource "aws_s3_bucket_versioning" "images" {
  bucket = aws_s3_bucket.images.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "images" {
  bucket = aws_s3_bucket.images.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "images" {
  bucket                  = aws_s3_bucket.images.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "images" {
  bucket = aws_s3_bucket.images.id

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# CORS so browsers (e.g. the read-only web UI later, or any future direct
# upload from the SPA) can PUT/GET via presigned URLs. The Android client
# doesn't need this — it uses raw OkHttp — but enabling it doesn't loosen
# any auth: presigned URLs are still the only way in.
resource "aws_s3_bucket_cors_configuration" "images" {
  bucket = aws_s3_bucket.images.id

  cors_rule {
    allowed_methods = ["GET", "PUT", "HEAD"]
    allowed_origins = ["*"]
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

# Grant the ECS task role permission to PUT/GET/HEAD objects in this bucket.
# The task role is assumed by the API container, which uses it both for
# minting presigned URLs (HeadBucket / signing context) and for any
# server-side maintenance that may land here later.
data "aws_iam_policy_document" "images_access" {
  statement {
    sid    = "ImagesObjectAccess"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:HeadObject",
    ]
    resources = ["${aws_s3_bucket.images.arn}/*"]
  }

  statement {
    sid       = "ImagesBucketAccess"
    effect    = "Allow"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.images.arn]
  }
}

resource "aws_iam_role_policy" "task_images" {
  name   = "${var.name_prefix}-task-images"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.images_access.json
}
