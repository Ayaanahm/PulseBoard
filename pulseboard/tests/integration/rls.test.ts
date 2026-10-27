/**
 * Proves tenant isolation is enforced by Postgres itself, not just app code.
 * Requires a migrated DB: DATABASE_URL (app_user) and MIGRATION_DATABASE_URL (owner).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

const enabled = !!process.env.DATABASE_URL && !!process.env.MIGRATION_DATABASE_URL;
const d = enabled ? describe : describe.skip;

d("row-level security", () => {
  const owner = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} });
  const app = postgres(process.env.DATABASE_URL!, { max: 1 });
  let a = "", b = "";
  const sfx = Date.now();

  beforeAll(async () => {
    [{ create_tenant: a }] = await owner`select create_tenant(${`a${sfx}@t.test`}, 'A', ${`rls-a-${sfx}`})`;
    [{ create_tenant: b }] = await owner`select create_tenant(${`b${sfx}@t.test`}, 'B', ${`rls-b-${sfx}`})`;
    await owner`insert into monitors(tenant_id, name, url) values (${a}, 'a-secret', 'https://a.test'), (${b}, 'b-secret', 'https://b.test')`;
  });
  afterAll(async () => {
    await owner`delete from tenants where id in (${a}, ${b})`;
    await owner.end(); await app.end();
  });

  const asTenant = <T>(tid: string | null, fn: (tx: postgres.TransactionSql) => Promise<T>) =>
    app.begin(async (tx) => { if (tid) await tx`select set_config('app.tenant_id', ${tid}, true)`; return fn(tx); }) as Promise<T>;

  it("sees nothing when no tenant is set (fail closed)", async () => {
    const rows = await asTenant(null, (tx) => tx`select * from monitors`);
    expect(rows.length).toBe(0);
  });
  it("sees only its own rows", async () => {
    const rows = await asTenant(a, (tx) => tx`select name from monitors`);
    expect(rows.map((r) => r.name)).toEqual(["a-secret"]);
  });
  it("cannot read another tenant even with explicit filter", async () => {
    const rows = await asTenant(a, (tx) => tx`select * from monitors where tenant_id = ${b}`);
    expect(rows.length).toBe(0);
  });
  it("cannot insert rows into another tenant", async () => {
    await expect(asTenant(a, (tx) => tx`insert into monitors(tenant_id, name, url) values (${b}, 'x', 'https://x.test')`))
      .rejects.toThrow(/row-level security/);
  });
  it("cannot update/delete another tenant's rows", async () => {
    const res = await asTenant(a, (tx) => tx`delete from monitors where tenant_id = ${b}`);
    expect(res.count).toBe(0);
  });
  it("setting does not leak across transactions on the same connection", async () => {
    await asTenant(a, (tx) => tx`select 1`);
    const rows = await asTenant(null, (tx) => tx`select * from monitors`);
    expect(rows.length).toBe(0);
  });
});
