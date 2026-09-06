resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${var.name_prefix}-web-oac"
  description                       = "OAC for ${var.name_prefix} web bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${var.name_prefix} ${var.env} SPA"
  default_root_object = "index.html"
  price_class         = var.price_class

  aliases = [var.web_fqdn]

  origin {
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_id                = "s3-${aws_s3_bucket.web.id}"
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  # Firebase Auth handler pages, proxied so `authDomain` can be the web FQDN
  # itself (see variables.tf). Firebase Hosting routes on the Host header, so
  # CloudFront must send the origin's own hostname, not the viewer's — hence
  # the AllViewerExceptHostHeader origin request policy below.
  origin {
    domain_name = var.firebase_auth_proxy_domain
    origin_id   = "firebase-auth"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # Must come before the default S3 behavior. Uncached: the handler is a
  # dynamic page keyed on query params, and the responses are tiny.
  ordered_cache_behavior {
    path_pattern           = "/__/auth/*"
    target_origin_id       = "firebase-auth"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    # AWS managed CachingDisabled policy.
    cache_policy_id = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    # AWS managed AllViewerExceptHostHeader origin request policy: forwards
    # all query strings, cookies and headers except Host.
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
  }

  default_cache_behavior {
    target_origin_id       = "s3-${aws_s3_bucket.web.id}"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    # AWS managed CachingOptimized policy.
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  }

  # SPA fallback: any 404/403 from S3 returns index.html so client-side
  # routing keeps working on deep links. (Applies distribution-wide, so a
  # 403/404 from the Firebase Auth origin would also render index.html; the
  # handler pages return 200 in normal operation so this is harmless.)
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.web.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
}

resource "aws_route53_record" "web" {
  zone_id = var.hosted_zone_id
  name    = var.web_fqdn
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.web.domain_name
    zone_id                = aws_cloudfront_distribution.web.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "web_aaaa" {
  zone_id = var.hosted_zone_id
  name    = var.web_fqdn
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.web.domain_name
    zone_id                = aws_cloudfront_distribution.web.hosted_zone_id
    evaluate_target_health = false
  }
}
