import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL is required");
const sql = postgres(url, { max: 1, onnotice: () => {} });

async function main() {
  await sql`CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())`;
  const dir = join(process.cwd(), "drizzle");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const [done] = await sql`SELECT 1 FROM _migrations WHERE name = ${f}`;
    if (done) continue;
    console.log(`applying ${f}`);
    await sql.begin(async (tx) => {
      await tx.unsafe(readFileSync(join(dir, f), "utf8"));
      await tx`INSERT INTO _migrations(name) VALUES (${f})`;
    });
  }
  // Rotate app_user password from env in deployed envs
  if (process.env.APP_DB_PASSWORD) {
    await sql.unsafe(`ALTER ROLE app_user PASSWORD '${process.env.APP_DB_PASSWORD.replace(/'/g, "''")}'`);
  }
  console.log("migrations complete");
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
