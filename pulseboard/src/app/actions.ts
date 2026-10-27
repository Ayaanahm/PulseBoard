"use server";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, withTenant, schema, type Tx } from "@/db";
import { requireTenant, requireUser } from "@/lib/tenant";
import { monitorInput, tenantInput, memberInput } from "@/lib/validation";
import { validateMonitorUrl } from "@/lib/ssrf";
import { generateApiKey } from "@/lib/apikeys";
import { canAssignRole, type Role } from "@/lib/rbac";
import { signIn, signOut } from "@/auth";

export type ActionState = { error?: string; ok?: string; secret?: string } | undefined;

async function audit(tx: Tx, tenantId: string, email: string, action: string, target?: string) {
  const [u] = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email));
  await tx.insert(schema.auditLog).values({ tenantId, actorId: u?.id, action, target });
}

export async function createTenant(_: ActionState, fd: FormData): Promise<ActionState> {
  const { email } = await requireUser();
  const p = tenantInput.safeParse({ name: fd.get("name"), slug: fd.get("slug") });
  if (!p.success) return { error: "Name 2–60 chars; slug lowercase letters, digits, dashes." };
  try {
    await db.execute(sql`select create_tenant(${email}, ${p.data.name}, ${p.data.slug})`);
  } catch {
    return { error: "That slug is taken." };
  }
  redirect(`/t/${p.data.slug}`);
}

export async function createMonitor(slug: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const t = await requireTenant(slug, "monitor:write");
  const p = monitorInput.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Invalid input" };
  try { validateMonitorUrl(p.data.url); } catch (e) { return { error: (e as Error).message }; }
  await withTenant(t.tenantId, async (tx) => {
    const [m] = await tx.insert(schema.monitors).values({ ...p.data, tenantId: t.tenantId }).returning();
    await audit(tx, t.tenantId, t.email, "monitor.create", m.name);
  });
  revalidatePath(`/t/${slug}`);
  return { ok: "Monitor created" };
}

export async function deleteMonitor(slug: string, id: string) {
  const t = await requireTenant(slug, "monitor:delete");
  await withTenant(t.tenantId, async (tx) => {
    const [m] = await tx.delete(schema.monitors).where(eq(schema.monitors.id, id)).returning();
    if (m) await audit(tx, t.tenantId, t.email, "monitor.delete", m.name);
  });
  revalidatePath(`/t/${slug}`);
}

export async function createApiKey(slug: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const t = await requireTenant(slug, "apikey:manage");
  const name = String(fd.get("name") ?? "").trim().slice(0, 60) || "default";
  const k = generateApiKey();
  await withTenant(t.tenantId, async (tx) => {
    await tx.insert(schema.apiKeys).values({ tenantId: t.tenantId, name, prefix: k.prefix, hashedKey: k.hashed });
    await audit(tx, t.tenantId, t.email, "apikey.create", name);
  });
  revalidatePath(`/t/${slug}/settings`);
  return { ok: "Copy this key now — it won't be shown again.", secret: k.raw };
}

export async function revokeApiKey(slug: string, id: string) {
  const t = await requireTenant(slug, "apikey:manage");
  await withTenant(t.tenantId, async (tx) => {
    await tx.update(schema.apiKeys).set({ revokedAt: new Date() }).where(eq(schema.apiKeys.id, id));
    await audit(tx, t.tenantId, t.email, "apikey.revoke", id);
  });
  revalidatePath(`/t/${slug}/settings`);
}

export async function upsertMember(slug: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const t = await requireTenant(slug, "member:manage");
  const p = memberInput.safeParse({ email: fd.get("email"), role: fd.get("role") });
  if (!p.success) return { error: "Valid email and role required" };
  return withTenant(t.tenantId, async (tx) => {
    const [{ ensure_user: userId }] = await tx.execute<{ ensure_user: string }>(
      sql`select ensure_user(${p.data.email}, null)`);
    const [existing] = await tx.select().from(schema.memberships)
      .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.tenantId, t.tenantId)));
    if (!canAssignRole(t.role, p.data.role as Role, existing?.role as Role | undefined))
      return { error: "You can't assign that role." };
    await tx.insert(schema.memberships).values({ tenantId: t.tenantId, userId, role: p.data.role })
      .onConflictDoUpdate({ target: [schema.memberships.tenantId, schema.memberships.userId], set: { role: p.data.role } });
    await audit(tx, t.tenantId, t.email, "member.upsert", `${p.data.email}:${p.data.role}`);
    revalidatePath(`/t/${slug}/settings`);
    return { ok: `${p.data.email} is now ${p.data.role}` };
  });
}

export async function devLogin(fd: FormData) {
  await signIn("dev", { email: fd.get("email"), redirectTo: String(fd.get("callbackUrl") || "/") });
}
export async function ssoLogin(provider: string, callbackUrl: string) {
  await signIn(provider, { redirectTo: callbackUrl || "/" });
}
export async function logout() { await signOut({ redirectTo: "/login" }); }
