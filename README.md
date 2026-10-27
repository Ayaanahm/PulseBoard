[README.md](https://github.com/user-attachments/files/34038418/README.md)
# PulseBoard — Multi-Tenant API Analytics & Uptime Monitoring

A production-style SaaS: teams monitor endpoint uptime and push API telemetry, with
**database-enforced tenant isolation**, **OIDC SSO + fine-grained RBAC**, a full
**CI/CD pipeline with Playwright E2E**, and **AWS infrastructure in Terraform**.

**Stack:** TypeScript · Next.js 15 (App Router, server actions) · Node.js worker · PostgreSQL 16 ·
Drizzle ORM · Auth.js (OIDC) · Tailwind · Recharts · Vitest · Playwright · Docker ·
Terraform · AWS (VPC, ECS Fargate, RDS, ALB, WAF, ECR, S3, Secrets Manager) · GitHub Actions

```
             ┌──────────── AWS (Terraform) ─────────────────────────────────────┐
 Browser ──► │ WAF ─► ALB (TLS 1.3) ─► ECS Fargate: web (Next.js, autoscaled)    │
 Customer    │                         ECS Fargate: worker (uptime checker)      │
 services ─► │  POST /api/v1/ingest            │                                 │
 (API key)   │                                 ▼ private subnets, SSL only       │
             │                RDS PostgreSQL 16 (Multi-AZ, encrypted, RLS)       │
             │ Secrets Manager · CloudWatch · S3 (ALB + VPC flow logs) · ECR     │
             └───────────────────────────────────────────────────────────────────┘
 GitHub Actions ──OIDC (no static keys)──► build images → terraform apply → migrate → smoke test
```

## Key features

### 1. Multi-tenant isolation (Postgres row-level security)
- Every tenant table has `tenant_id` plus an RLS policy `tenant_id = current_tenant()` with
  `FORCE ROW LEVEL SECURITY` (`drizzle/0000_init.sql`).
- The app connects as `app_user`, which is **not** the table owner and has **NOBYPASSRLS**.
  Even a buggy query with no `WHERE tenant_id` can't return another tenant's rows.
- `withTenant(tenantId, fn)` (`src/db/index.ts`) runs each request in a transaction with
  `set_config('app.tenant_id', id, true)`. Because the setting is **transaction-local**, it can't
  leak between pooled connections.
- **Fails closed:** with no tenant set, queries return zero rows.
- The few legitimate cross-tenant lookups (memberships for a user, API-key → tenant, worker job
  claiming) are narrow `SECURITY DEFINER` functions. The app role never gets bypass rights.
- `tests/integration/rls.test.ts` checks this against a real database: cross-tenant reads,
  writes, deletes, and leaks across transactions.

### 2. Auth: OIDC + RBAC
- Auth.js with a generic **OIDC** provider (PKCE + state + nonce): Auth0, Okta, Cognito,
  Keycloak, Entra ID. GitHub OAuth is optional.
- Roles are `owner > admin > member > viewer`. Each role maps to a set of permissions
  (`monitor:write`, `apikey:manage`, `audit:read`, …) in `src/lib/rbac.ts`.
- Access is enforced on the server for every page, server action and API route
  (`requireTenant` / `apiTenant`). The UI also hides controls the user can't use.
- Privilege-escalation guard: an admin can't grant `owner` or change an owner's role.
- A non-member gets a **404, not a 403**, so tenants can't be enumerated.
- Audit log of sensitive actions.

### 3. Product
- **Uptime monitors:** a background worker claims due monitors with `FOR UPDATE SKIP LOCKED`,
  so you can run several replicas safely. It records status, latency and uptime %.
- **API analytics:** customers send events to `POST /api/v1/ingest` with a
  `pb_live_…` key. Only the SHA-256 hash of the key is stored. The dashboard shows p50/p95
  latency, request and error volume, and top routes.
- **SSRF protection:** monitors can't target private, loopback or link-local ranges
  (e.g. `169.254.169.254` metadata). DNS is re-resolved at check time to defeat rebinding.
- Security headers (HSTS, frame-deny, nosniff), zod validation everywhere, a non-root
  container, and a health endpoint.

### 4. CI/CD (`.github/workflows`)
- **ci.yml:** lint → typecheck → migrate + seed a real Postgres service → unit + RLS
  integration tests → production build → **Playwright E2E** → `terraform fmt/validate` + Trivy
  IaC scan.
- **deploy.yml** (on green CI to `main`): assume the AWS role via **GitHub OIDC** → build and push
  immutable SHA-tagged images to ECR → `terraform apply` → run migrations as a one-off ECS task →
  wait for services to stabilise → smoke-test `/api/health`. ECS's deployment circuit breaker
  rolls back automatically if the new version fails.

### 5. Infrastructure as Code (`infra/`)
- VPC with public and private subnets across 2 AZs, NAT, and VPC flow logs to S3.
- Security groups chained ALB → app → DB (least privilege).
- RDS Postgres 16: private, encrypted, SSL forced, Multi-AZ in prod, backups,
  deletion protection.
- ECS Fargate services for web and worker, a migrate task definition, CPU autoscaling, and
  Container Insights.
- ALB + ACM TLS 1.3 + Route 53 (optional custom domain) + WAF (AWS managed rules and per-IP
  rate limiting).
- Secrets Manager for the DB URLs and auth secret. The task execution role can only read those
  specific secrets.
- An ECR repo with immutable tags, scan-on-push and a lifecycle policy.
- A GitHub OIDC provider and deploy role scoped to `repo:<you>/pulseboard:environment:production`.
- `infra/bootstrap/` creates the encrypted, versioned S3 bucket for Terraform state.

## Run locally

```bash
docker compose up --build          # Postgres + migrate/seed + web + worker
open http://localhost:3000/login   # dev login: alice@acme.test (owner), victor@acme.test (viewer), bob@globex.test
```

Or without Docker for the app:

```bash
cp .env.example .env && npm install
docker compose up -d db
npm run db:migrate && npm run db:seed
npm run dev            # terminal 1
npm run worker         # terminal 2
```

Tests:

```bash
npm test               # unit + RLS integration (needs DB)
npm run test:e2e       # builds, starts the app, runs Playwright
```

Send telemetry. Create a key under **Settings**, then:

```bash
curl -X POST localhost:3000/api/v1/ingest -H "Authorization: Bearer pb_live_..." \
  -H "content-type: application/json" \
  -d '[{"route":"/v1/users","method":"GET","statusCode":200,"latencyMs":42}]'
```

## Deploy to AWS

1. **State bucket:** `cd infra/bootstrap && terraform init && terraform apply -var bucket_name=<unique-name>`
2. **First apply** (from your machine, with admin credentials):
   ```bash
   cd infra
   cp example.tfvars prod.tfvars   # set github_repo, optional domain_name/route53_zone_id, OIDC issuer/client id
   terraform init -backend-config="bucket=<state-bucket>" -backend-config="region=ap-south-1"
   terraform apply -var-file=prod.tfvars
   ```
   The services start once the first images are pushed (step 4).
3. **Set the OIDC client secret:**
   `aws secretsmanager put-secret-value --secret-id pulseboard-prod/AUTH_OIDC_SECRET --secret-string <secret>`
   In your IdP, set the callback URL to `<app_url>/api/auth/callback/oidc`.
4. **GitHub:** create a `production` environment with these variables: `AWS_DEPLOY_ROLE_ARN`
   (from the `github_deploy_role_arn` output), `TF_STATE_BUCKET` and `AWS_REGION`. Also add the
   values from `prod.tfvars` as `TF_VAR_*` variables, or commit a non-secret tfvars file.
   Then push to `main`.

**Cost note:** NAT gateway, ALB, Multi-AZ RDS and two Fargate tasks come to roughly
$100–150/month. For a demo, set `environment = "dev"`, which disables Multi-AZ and deletion
protection, and run `terraform destroy` afterwards.

## Design decisions and trade-offs
- **Why RLS instead of only scoping by tenant ID in code:** RLS is defence in depth. A
  missing filter becomes an empty result instead of a data breach. The app still resolves
  membership explicitly, which handles authorisation.
- **Shared schema, not schema- or database-per-tenant:** it scales to many small tenants
  cheaply. A noisy-neighbour tier could move to a dedicated database later.
- **The worker is a separate service:** it can scale and fail independently of the web tier,
  and `SKIP LOCKED` makes horizontal scaling safe.
- **Dev login:** it is enabled only when `AUTH_DEV_LOGIN=true` **and** `APP_ENV` isn't
  `production`. Terraform always sets `APP_ENV=production`.
- **Next steps for real production:** partition `api_events` by time (or move it to
  TimescaleDB or ClickHouse), add alerting (Slack/email when a monitor goes down), Stripe
  billing per plan, a permissions boundary on the deploy role, and OpenTelemetry tracing.
