# ---------- RDS PostgreSQL ----------
resource "random_password" "db_master" {
  length  = 32
  special = false
}
resource "random_password" "db_app" {
  length  = 32
  special = false
}
resource "random_password" "auth_secret" {
  length  = 48
  special = false
}

resource "aws_db_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_parameter_group" "pg16" {
  name   = "${local.name}-pg16"
  family = "postgres16"
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  parameter {
    name  = "log_min_duration_statement"
    value = "500"
  }
}

resource "aws_db_instance" "main" {
  identifier                   = local.name
  engine                       = "postgres"
  engine_version               = "16.4"
  instance_class               = var.db_instance_class
  allocated_storage            = 20
  max_allocated_storage        = 100
  storage_encrypted            = true
  db_name                      = "pulseboard"
  username                     = "pb_owner"
  password                     = random_password.db_master.result
  db_subnet_group_name         = aws_db_subnet_group.main.name
  vpc_security_group_ids       = [aws_security_group.db.id]
  parameter_group_name         = aws_db_parameter_group.pg16.name
  multi_az                     = var.environment == "prod"
  backup_retention_period      = 7
  deletion_protection          = var.environment == "prod"
  skip_final_snapshot          = var.environment != "prod"
  final_snapshot_identifier    = "${local.name}-final"
  performance_insights_enabled = true
  auto_minor_version_upgrade   = true
  publicly_accessible          = false
}

# ---------- Secrets (injected into tasks; never in task env plaintext) ----------
locals {
  db_host = aws_db_instance.main.address
  secrets = {
    DATABASE_URL           = "postgres://app_user:${random_password.db_app.result}@${local.db_host}:5432/pulseboard?sslmode=require"
    MIGRATION_DATABASE_URL = "postgres://pb_owner:${random_password.db_master.result}@${local.db_host}:5432/pulseboard?sslmode=require"
    APP_DB_PASSWORD        = random_password.db_app.result
    AUTH_SECRET            = random_password.auth_secret.result
  }
}

resource "aws_secretsmanager_secret" "app" {
  for_each                = local.secrets
  name                    = "${local.name}/${each.key}"
  recovery_window_in_days = 7
}
resource "aws_secretsmanager_secret_version" "app" {
  for_each      = local.secrets
  secret_id     = aws_secretsmanager_secret.app[each.key].id
  secret_string = each.value
}

# OIDC client secret is set out-of-band: aws secretsmanager put-secret-value ...
resource "aws_secretsmanager_secret" "oidc_client_secret" {
  name = "${local.name}/AUTH_OIDC_SECRET"
}

# ---------- S3: ALB access logs + VPC flow logs ----------
resource "aws_s3_bucket" "logs" {
  bucket        = "${local.name}-logs-${data.aws_caller_identity.current.account_id}"
  force_destroy = var.environment != "prod"
}
resource "aws_s3_bucket_public_access_block" "logs" {
  bucket                  = aws_s3_bucket.logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_server_side_encryption_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    id     = "expire"
    status = "Enabled"
    filter {}
    expiration { days = 90 }
  }
}

data "aws_elb_service_account" "main" {}
resource "aws_s3_bucket_policy" "logs" {
  bucket = aws_s3_bucket.logs.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AlbLogs"
        Effect    = "Allow"
        Principal = { AWS = data.aws_elb_service_account.main.arn }
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.logs.arn}/alb/*"
      },
      {
        Sid       = "FlowLogs"
        Effect    = "Allow"
        Principal = { Service = "delivery.logs.amazonaws.com" }
        Action    = ["s3:PutObject", "s3:GetBucketAcl"]
        Resource  = [aws_s3_bucket.logs.arn, "${aws_s3_bucket.logs.arn}/*"]
      },
      {
        Sid       = "DenyInsecure"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.logs.arn, "${aws_s3_bucket.logs.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      }
    ]
  })
}
