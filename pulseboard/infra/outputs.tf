output "app_url" { value = local.app_url }
output "ecs_cluster" { value = aws_ecs_cluster.main.name }
output "migrate_task_definition" { value = aws_ecs_task_definition.app["migrate"].arn }
output "migrate_network_configuration" {
  value = jsonencode({ awsvpcConfiguration = {
    subnets        = aws_subnet.private[*].id
    securityGroups = [aws_security_group.app.id]
    assignPublicIp = "DISABLED"
  } })
}
output "github_deploy_role_arn" { value = aws_iam_role.github_deploy.arn }
output "ecr_repositories" { value = { for k, r in aws_ecr_repository.repo : k => r.repository_url } }
