import { sql } from "drizzle-orm";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/tenant";
import { can } from "@/lib/rbac";
import { createMonitor, deleteMonitor } from "@/app/actions";
import { ActionForm } from "@/components/Forms";
import { LatencyChart, RequestsChart } from "@/components/Charts";

export const dynamic = "force-dynamic";

type MonitorRow = { id: string; name: string; url: string; enabled: boolean; uptime: number | null; last_up: boolean | null; avg_ms: number | null; checks: number };

export default async function Overview({ params }: { params: Promise<{ tenant: string }> }) {
  const t = await requireTenant((await params).tenant, "monitor:read");
  // Every query below runs under RLS — no `where tenant_id = ...` needed, and none could be bypassed.
  const { monitors, series, kpi, routes } = await withTenant(t.tenantId, async (tx) => {
    const monitors = await tx.execute<MonitorRow>(sql`
      select m.id, m.name, m.url, m.enabled,
        round(100.0 * avg(c.up::int), 2)::float as uptime,
        (select up from checks where monitor_id = m.id order by checked_at desc limit 1) as last_up,
        round(avg(c.latency_ms))::int as avg_ms, count(c.id)::int as checks
      from monitors m left join checks c on c.monitor_id = m.id and c.checked_at > now() - interval '24 hours'
      group by m.id order by m.created_at desc`);
    const series = await tx.execute<{ t: string; p50: number; p95: number; ok: number; errors: number }>(sql`
      select to_char(date_trunc('hour', occurred_at), 'HH24:00') as t,
        percentile_cont(0.5) within group (order by latency_ms)::int as p50,
        percentile_cont(0.95) within group (order by latency_ms)::int as p95,
        count(*) filter (where status_code < 500)::int as ok,
        count(*) filter (where status_code >= 500)::int as errors
      from api_events where occurred_at > now() - interval '24 hours'
      group by date_trunc('hour', occurred_at) order by date_trunc('hour', occurred_at)`);
    const [kpi] = await tx.execute<{ total: number; err_rate: number | null; p95: number | null }>(sql`
      select count(*)::int as total,
        round(100.0 * avg((status_code >= 500)::int), 2)::float as err_rate,
        percentile_cont(0.95) within group (order by latency_ms)::int as p95
      from api_events where occurred_at > now() - interval '24 hours'`);
    const routes = await tx.execute<{ route: string; method: string; n: number; p95: number; errs: number }>(sql`
      select route, method, count(*)::int as n,
        percentile_cont(0.95) within group (order by latency_ms)::int as p95,
        count(*) filter (where status_code >= 500)::int as errs
      from api_events where occurred_at > now() - interval '24 hours'
      group by route, method order by n desc limit 10`);
    return { monitors, series, kpi, routes };
  });
  const writable = can(t.role, "monitor:write");
  const deletable = can(t.role, "monitor:delete");
  const up = monitors.filter((m) => m.last_up).length;

  return (
    <>
      <section className="grid gap-4 sm:grid-cols-4">
        <Kpi label="Monitors up" value={`${up}/${monitors.length}`} />
        <Kpi label="Requests (24h)" value={kpi?.total?.toLocaleString() ?? "0"} />
        <Kpi label="Error rate" value={`${kpi?.err_rate ?? 0}%`} />
        <Kpi label="p95 latency" value={kpi?.p95 != null ? `${kpi.p95} ms` : "—"} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card"><h2 className="mb-2 text-sm font-medium">Latency (24h)</h2><LatencyChart data={[...series]} /></div>
        <div className="card"><h2 className="mb-2 text-sm font-medium">Requests (24h)</h2><RequestsChart data={[...series]} /></div>
      </section>

      <section className="card overflow-x-auto">
        <h2 className="mb-3 font-medium">Uptime monitors</h2>
        <table className="w-full text-sm" data-testid="monitors">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr><th className="py-2">Status</th><th>Name</th><th>URL</th><th>Uptime 24h</th><th>Avg</th><th /></tr>
          </thead>
          <tbody>
            {monitors.map((m) => (
              <tr key={m.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="py-2"><span className={`inline-block h-2.5 w-2.5 rounded-full ${m.last_up == null ? "bg-slate-400" : m.last_up ? "bg-emerald-500" : "bg-rose-500"}`} /></td>
                <td className="font-medium">{m.name}</td>
                <td className="max-w-xs truncate text-slate-500">{m.url}</td>
                <td>{m.uptime != null ? `${m.uptime}%` : "—"}</td>
                <td>{m.avg_ms != null ? `${m.avg_ms} ms` : "—"}</td>
                <td className="text-right">
                  {deletable && (
                    <form action={deleteMonitor.bind(null, t.slug, m.id)}>
                      <button className="text-xs text-rose-600 hover:underline">Delete</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {monitors.length === 0 && <p className="py-4 text-sm text-slate-500">No monitors yet.</p>}
      </section>

      {writable && (
        <section className="card">
          <h2 className="mb-3 font-medium">Add monitor</h2>
          <ActionForm action={createMonitor.bind(null, t.slug)} submit="Add monitor" className="grid gap-3 sm:grid-cols-4">
            <div><label className="label" htmlFor="m-name">Name</label><input id="m-name" name="name" className="input" required /></div>
            <div className="sm:col-span-2"><label className="label" htmlFor="m-url">URL</label><input id="m-url" name="url" type="url" className="input" required /></div>
            <div><label className="label" htmlFor="m-int">Interval (s)</label><input id="m-int" name="intervalSeconds" type="number" defaultValue={60} min={30} className="input" /></div>
          </ActionForm>
        </section>
      )}

      <section className="card overflow-x-auto">
        <h2 className="mb-3 font-medium">Top routes (24h)</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-2">Route</th><th>Requests</th><th>p95</th><th>5xx</th></tr></thead>
          <tbody>
            {routes.map((r) => (
              <tr key={r.method + r.route} className="border-t border-slate-100 dark:border-slate-800">
                <td className="py-2 font-mono text-xs">{r.method} {r.route}</td><td>{r.n}</td><td>{r.p95} ms</td><td>{r.errs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return <div className="card"><p className="label">{label}</p><p className="text-2xl font-semibold tabular-nums">{value}</p></div>;
}
