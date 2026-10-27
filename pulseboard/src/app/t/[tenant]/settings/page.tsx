import { desc, eq } from "drizzle-orm";
import { withTenant, schema } from "@/db";
import { requireTenant } from "@/lib/tenant";
import { ROLES } from "@/lib/rbac";
import { createApiKey, revokeApiKey, upsertMember } from "@/app/actions";
import { ActionForm } from "@/components/Forms";

export const dynamic = "force-dynamic";

export default async function Settings({ params }: { params: Promise<{ tenant: string }> }) {
  const t = await requireTenant((await params).tenant, "apikey:manage");
  const { keys, members } = await withTenant(t.tenantId, async (tx) => ({
    keys: await tx.select().from(schema.apiKeys).orderBy(desc(schema.apiKeys.createdAt)),
    members: await tx.select({ email: schema.users.email, role: schema.memberships.role })
      .from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)),
  }));
  return (
    <>
      <section className="card space-y-4">
        <h2 className="font-medium">Ingest API keys</h2>
        <p className="text-sm text-slate-500">
          Send events: <code className="text-xs">POST /api/v1/ingest</code> with <code className="text-xs">Authorization: Bearer &lt;key&gt;</code>. Keys are stored as SHA-256 hashes.
        </p>
        <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center justify-between py-2">
              <span>{k.name} <code className="text-xs text-slate-500">{k.prefix}…</code></span>
              {k.revokedAt ? <span className="text-xs text-slate-400">revoked</span> : (
                <form action={revokeApiKey.bind(null, t.slug, k.id)}><button className="text-xs text-rose-600">Revoke</button></form>
              )}
            </li>
          ))}
        </ul>
        <ActionForm action={createApiKey.bind(null, t.slug)} submit="Create key">
          <label className="label" htmlFor="k-name">Key name</label>
          <input id="k-name" name="name" className="input max-w-xs" placeholder="production" />
        </ActionForm>
      </section>

      <section className="card space-y-4">
        <h2 className="font-medium">Members</h2>
        <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800" data-testid="members">
          {members.map((m) => (
            <li key={m.email} className="flex justify-between py-2"><span>{m.email}</span><span className="text-xs uppercase text-slate-500">{m.role}</span></li>
          ))}
        </ul>
        <ActionForm action={upsertMember.bind(null, t.slug)} submit="Save member" className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2"><label className="label" htmlFor="mem-email">Email</label><input id="mem-email" name="email" type="email" className="input" required /></div>
          <div><label className="label" htmlFor="mem-role">Role</label>
            <select id="mem-role" name="role" className="input" defaultValue="member">
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select></div>
        </ActionForm>
      </section>
    </>
  );
}
