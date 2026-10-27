import postgres from "postgres";
const sql = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1 });

async function main() {
  const tenants = [
    { name: "Acme Corp", slug: "acme", owner: "alice@acme.test" },
    { name: "Globex", slug: "globex", owner: "bob@globex.test" },
  ];
  for (const t of tenants) {
    const [exists] = await sql`SELECT id FROM tenants WHERE slug = ${t.slug}`;
    if (exists) continue;
    const [{ create_tenant: tid }] = await sql`SELECT create_tenant(${t.owner}, ${t.name}, ${t.slug})`;
    await sql`INSERT INTO monitors(tenant_id, name, url) VALUES
      (${tid}, 'Example', 'https://example.com'), (${tid}, 'HTTPBin', 'https://httpbin.org/status/200')`;
    const now = Date.now();
    const routes = ["/v1/users", "/v1/orders", "/v1/search", "/v1/auth"];
    const rows = Array.from({ length: 500 }, (_, i) => ({
      tenant_id: tid,
      route: routes[i % routes.length],
      method: i % 3 ? "GET" : "POST",
      status_code: Math.random() < 0.05 ? 500 : 200,
      latency_ms: Math.round(40 + Math.random() * 300),
      occurred_at: new Date(now - Math.random() * 24 * 3600e3),
    }));
    await sql`INSERT INTO api_events ${sql(rows)}`;
  }
  // viewer in acme for RBAC demo
  await sql`SELECT ensure_user('victor@acme.test', 'Victor Viewer')`;
  await sql`INSERT INTO memberships(tenant_id, user_id, role)
    SELECT t.id, u.id, 'viewer' FROM tenants t, users u WHERE t.slug='acme' AND u.email='victor@acme.test'
    ON CONFLICT DO NOTHING`;
  console.log("seeded");
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
