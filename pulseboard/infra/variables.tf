variable "project" {
  type    = string
  default = "pulseboard"
}
variable "environment" {
  type    = string
  default = "prod"
}
variable "aws_region" {
  type    = string
  default = "ap-south-1"
}
variable "image_tag" {
  type        = string
  description = "Container image tag (git SHA) to deploy"
  default     = "latest"
}
variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}
variable "domain_name" {
  type        = string
  description = "Optional app domain (e.g. app.example.com). Empty = serve on ALB DNS over HTTP."
  default     = ""
}
variable "route53_zone_id" {
  type    = string
  default = ""
}
variable "github_repo" {
  type        = string
  description = "owner/repo allowed to assume the deploy role via OIDC"
}
variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}
variable "web_desired_count" {
  type    = number
  default = 2
}
variable "oidc_issuer" {
  type    = string
  default = ""
}
variable "oidc_client_id" {
  type    = string
  default = ""
}
