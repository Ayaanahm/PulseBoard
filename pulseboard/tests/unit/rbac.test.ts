import { describe, expect, it } from "vitest";
import { can, canAssignRole } from "@/lib/rbac";

describe("rbac", () => {
  it("viewers read but cannot write", () => {
    expect(can("viewer", "monitor:read")).toBe(true);
    expect(can("viewer", "monitor:write")).toBe(false);
  });
  it("members write but cannot delete or manage keys", () => {
    expect(can("member", "monitor:write")).toBe(true);
    expect(can("member", "monitor:delete")).toBe(false);
    expect(can("member", "apikey:manage")).toBe(false);
  });
  it("only owners delete tenants", () => {
    expect(can("admin", "tenant:delete")).toBe(false);
    expect(can("owner", "tenant:delete")).toBe(true);
  });
  it("denies null role", () => expect(can(null, "monitor:read")).toBe(false));
  it("admins cannot grant owner or demote owners", () => {
    expect(canAssignRole("admin", "member")).toBe(true);
    expect(canAssignRole("admin", "owner")).toBe(false);
    expect(canAssignRole("admin", "viewer", "owner")).toBe(false);
    expect(canAssignRole("owner", "owner")).toBe(true);
    expect(canAssignRole("member", "viewer")).toBe(false);
  });
});
