terraform {
  required_version = ">= 1.6"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.70" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
  # bucket/region passed at init: terraform init -backend-config="bucket=..." -backend-config="region=..."
  backend "s3" {
    key          = "pulseboard/prod.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.aws_region
  default_tags { tags = { Project = var.project, Environment = var.environment, ManagedBy = "terraform" } }
}

data "aws_availability_zones" "available" { state = "available" }
data "aws_caller_identity" "current" {}
