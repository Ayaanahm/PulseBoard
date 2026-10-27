import Link from "next/link";
import { requireTenant } from "@/lib/tenant";
import { can } from "@/lib/rbac";
import { logout } from "@/app/actions";

export default async function TenantLayout({ children, params }:
  { children: React.ReactNode; params: Promise<{ tenant: string }> }) {
  const t = await requireTenant((await params).tenant);
  const nav = [
    { href: `/t/${t.slug}`, label: "Overview", show: true },
    { href: `/t/${t.slug}/settings`, label: "Settings", show: can(t.role, "apikey:manage") },
    { href: `/t/${t.slug}/audit`, label: "Audit log", show: can(t.role, "audit:read") },
  ];
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
          <Link href="/" className="font-semibold text-indigo-600">PulseBoard</Link>
          <span data-testid="tenant-name" className="font-medium">{t.name}</span>
          <nav className="flex gap-4 text-sm">
            {nav.filter((n) => n.show).map((n) => <Link key={n.href} href={n.href} className="hover:text-indigo-600">{n.label}</Link>)}
          </nav>
          <span className="ml-auto text-xs text-slate-500">{t.email} · <b data-testid="role">{t.role}</b></span>
          <form action={logout}><button className="text-xs underline">Sign out</button></form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">{children}</main>
    </div>
  );
}
