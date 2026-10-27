import { sql } from "drizzle-orm";
import { db, withTenant, schema } from "@/db";
import { hashApiKey } from "@/lib/apikeys";
import { ingestInput } from "@/lib/validation";

/** Customers' services push request telemetry here with `Authorization: Bearer pb_live_...`. */
export async function POST(req: Request) {
  const key = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!key?.startsWith("pb_live_")) return Response.json({ error: "missing api key" }, { status: 401 });
  const [row] = await db.execute<{ tenant_for_api_key: string | null }>(
    sql`select tenant_for_api_key(${hashApiKey(key)})`,
  );
  const tenantId = row?.tenant_for_api_key;
  if (!tenantId) return Response.json({ error: "invalid api key" }, { status: 401 });

  const parsed = ingestInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  const events = Array.isArray(parsed.data) ? parsed.data : [parsed.data];

  await withTenant(tenantId, (tx) =>
    tx.insert(schema.apiEvents).values(events.map((e) => ({ ...e, tenantId, occurredAt: e.occurredAt ?? new Date() }))),
  );
  return Response.json({ accepted: events.length }, { status: 202 });
}
