import { describe, expect, it } from "vitest";
import { generateApiKey, hashApiKey } from "@/lib/apikeys";
import { ingestInput } from "@/lib/validation";

describe("api keys", () => {
  it("hashes deterministically and never stores raw", () => {
    const k = generateApiKey();
    expect(k.raw.startsWith("pb_live_")).toBe(true);
    expect(k.hashed).toBe(hashApiKey(k.raw));
    expect(k.hashed).not.toContain(k.raw);
  });
  it("validates ingest payloads", () => {
    expect(ingestInput.safeParse({ route: "/a", method: "get", statusCode: 200, latencyMs: 5 }).success).toBe(true);
    expect(ingestInput.safeParse({ route: "/a", method: "get", statusCode: 99, latencyMs: 5 }).success).toBe(false);
  });
});
