import { describe, expect, it } from "vitest";
import { isPrivateIp, validateMonitorUrl } from "@/lib/ssrf";

describe("ssrf guard", () => {
  it.each(["10.0.0.1", "127.0.0.1", "169.254.169.254", "172.16.5.4", "192.168.1.1", "::1", "fd00::1", "::ffff:10.0.0.1"])(
    "flags %s as private", (ip) => expect(isPrivateIp(ip)).toBe(true));
  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1"])("allows %s", (ip) => expect(isPrivateIp(ip)).toBe(false));
  it("rejects non-http, creds, localhost, metadata IP", () => {
    expect(() => validateMonitorUrl("file:///etc/passwd")).toThrow();
    expect(() => validateMonitorUrl("https://u:p@example.com")).toThrow();
    expect(() => validateMonitorUrl("http://localhost:3000")).toThrow();
    expect(() => validateMonitorUrl("http://169.254.169.254/latest/meta-data")).toThrow();
  });
  it("accepts public URLs", () => expect(validateMonitorUrl("https://example.com/health").hostname).toBe("example.com"));
});
