# One-time: creates the S3 bucket that stores Terraform state for the main stack.
terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.70" }
  }
}
variable "aws_region" {
  type    = string
  default = "ap-south-1"
}
variable "bucket_name" { type = string }
provider "aws" { region = var.aws_region }

resource "aws_s3_bucket" "state" { bucket = var.bucket_name }
resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
output "bucket" { value = aws_s3_bucket.state.bucket }
