# ---------- ECR ----------
resource "aws_ecr_repository" "repo" {
  for_each             = toset(["web", "worker"])
  name                 = "${var.project}-${each.key}"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = var.environment != "prod"
  image_scanning_configuration { scan_on_push = true }
}
resource "aws_ecr_lifecycle_policy" "repo" {
  for_each   = aws_ecr_repository.repo
  repository = each.value.name
  policy = jsonencode({ rules = [{
    rulePriority = 1, description = "keep last 30",
    selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 30 },
    action       = { type = "expire" }
  }] })
}

# ---------- IAM ----------
data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}
resource "aws_iam_role" "execution" {
  name               = "${local.name}-ecs-exec"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}
resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}
resource "aws_iam_role_policy" "execution_secrets" {
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = concat([for s in aws_secretsmanager_secret.app : s.arn], [aws_secretsmanager_secret.oidc_client_secret.arn])
    }]
  })
}
# Task role: the app needs no AWS API access today — empty by design.
resource "aws_iam_role" "task" {
  name               = "${local.name}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

# ---------- ECS ----------
resource "aws_ecs_cluster" "main" {
  name = local.name
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}
resource "aws_cloudwatch_log_group" "app" {
  for_each          = toset(["web", "worker", "migrate"])
  name              = "/ecs/${local.name}/${each.key}"
  retention_in_days = 30
}

locals {
  app_url  = var.domain_name != "" ? "https://${var.domain_name}" : "http://${aws_lb.main.dns_name}"
  registry = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.aws_region}.amazonaws.com"
  secret_refs = {
    web     = ["DATABASE_URL", "AUTH_SECRET"]
    worker  = ["DATABASE_URL"]
    migrate = ["MIGRATION_DATABASE_URL", "APP_DB_PASSWORD"]
  }
  container = {
    for k, v in {
      web     = { image = "web", command = null, port = 3000 }
      worker  = { image = "worker", command = null, port = null }
      migrate = { image = "worker", command = ["npx", "tsx", "scripts/migrate.ts"], port = null }
      } : k => merge(v, {
        secrets = concat(
          [for s in local.secret_refs[k] : { name = s, valueFrom = aws_secretsmanager_secret.app[s].arn }],
          k == "web" && var.oidc_client_id != "" ? [{ name = "AUTH_OIDC_SECRET", valueFrom = aws_secretsmanager_secret.oidc_client_secret.arn }] : []
        )
    })
  }
}

resource "aws_ecs_task_definition" "app" {
  for_each                 = local.container
  family                   = "${local.name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = each.key == "web" ? 512 : 256
  memory                   = each.key == "web" ? 1024 : 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }
  container_definitions = jsonencode([{
    name                   = each.key
    image                  = "${local.registry}/${var.project}-${each.value.image}:${var.image_tag}"
    essential              = true
    command                = each.value.command
    readonlyRootFilesystem = false
    portMappings           = each.value.port == null ? [] : [{ containerPort = each.value.port, protocol = "tcp" }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "APP_ENV", value = "production" },
      { name = "AUTH_URL", value = local.app_url },
      { name = "AUTH_OIDC_ISSUER", value = var.oidc_issuer },
      { name = "AUTH_OIDC_ID", value = var.oidc_client_id },
    ]
    secrets = each.value.secrets
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.app[each.key].name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = each.key
      }
    }
  }])
}

resource "aws_ecs_service" "web" {
  name                   = "${var.project}-web"
  cluster                = aws_ecs_cluster.main.id
  task_definition        = aws_ecs_task_definition.app["web"].arn
  desired_count          = var.web_desired_count
  launch_type            = "FARGATE"
  enable_execute_command = false
  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.app.id]
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3000
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  lifecycle { ignore_changes = [desired_count] }
  depends_on = [aws_lb_listener.http]
}

resource "aws_ecs_service" "worker" {
  name            = "${var.project}-worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app["worker"].arn
  desired_count   = 1
  launch_type     = "FARGATE"
  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.app.id]
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
}

# ---------- Autoscaling (web) ----------
resource "aws_appautoscaling_target" "web" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.web.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.web_desired_count
  max_capacity       = 10
}
resource "aws_appautoscaling_policy" "web_cpu" {
  name               = "${local.name}-web-cpu"
  service_namespace  = "ecs"
  resource_id        = aws_appautoscaling_target.web.resource_id
  scalable_dimension = aws_appautoscaling_target.web.scalable_dimension
  policy_type        = "TargetTrackingScaling"
  target_tracking_scaling_policy_configuration {
    target_value = 60
    predefined_metric_specification { predefined_metric_type = "ECSServiceAverageCPUUtilization" }
  }
}
