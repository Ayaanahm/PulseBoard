import { desc, eq } from "drizzle-orm";
import { withTenant, schema } from "@/db";
import { requireTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function Audit({ params }: { params: Promise<{ tenant: string }> }) {
  const t = await requireTenant((await params).tenant, "audit:read");
  const rows = await withTenant(t.tenantId, (tx) =>
    tx.select({ at: schema.auditLog.at, action: schema.auditLog.action, target: schema.auditLog.target, actor: schema.users.email })
      .from(schema.auditLog).leftJoin(schema.users, eq(schema.users.id, schema.auditLog.actorId))
      .orderBy(desc(schema.auditLog.at)).limit(200));
  return (
    <section className="card overflow-x-auto">
      <h2 className="mb-3 font-medium">Audit log</h2>
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-2">When</th><th>Actor</th><th>Action</th><th>Target</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
              <td className="py-2 text-xs text-slate-500">{r.at.toISOString().replace("T", " ").slice(0, 19)}</td>
              <td>{r.actor ?? "—"}</td><td className="font-mono text-xs">{r.action}</td><td>{r.target}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
