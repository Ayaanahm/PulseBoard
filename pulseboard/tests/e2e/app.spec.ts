import { test, expect, type Page } from "@playwright/test";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Your workspaces" })).toBeVisible();
}

test("unauthenticated users are redirected to login", async ({ page }) => {
  await page.goto("/t/acme");
  await expect(page).toHaveURL(/\/login/);
});

test("owner sees dashboard and can create a monitor", async ({ page }) => {
  await login(page, "alice@acme.test");
  await page.getByRole("link", { name: /Acme Corp/ }).click();
  await expect(page.getByTestId("tenant-name")).toHaveText("Acme Corp");
  await expect(page.getByTestId("role")).toHaveText("owner");
  const name = `E2E ${Date.now()}`;
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("URL").fill("https://example.org");
  await page.getByRole("button", { name: "Add monitor" }).click();
  await expect(page.getByTestId("monitors")).toContainText(name);
});

test("SSRF: monitor pointing at cloud metadata is rejected", async ({ page }) => {
  await login(page, "alice@acme.test");
  await page.goto("/t/acme");
  await page.getByLabel("Name").fill("evil");
  await page.getByLabel("URL").fill("http://169.254.169.254/latest/meta-data");
  await page.getByRole("button", { name: "Add monitor" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /Private IPs/ })).toBeVisible();
});

test("tenant isolation: user cannot open another tenant", async ({ page }) => {
  await login(page, "alice@acme.test");
  const res = await page.goto("/t/globex");
  expect(res?.status()).toBe(404);
});

test("RBAC: viewer cannot see write controls or settings", async ({ page, request }) => {
  await login(page, "victor@acme.test");
  await page.goto("/t/acme");
  await expect(page.getByTestId("role")).toHaveText("viewer");
  await expect(page.getByRole("button", { name: "Add monitor" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
  const api = await page.request.post("/api/t/acme/monitors", { data: { name: "x", url: "https://example.com" } });
  expect(api.status()).toBe(403);
  void request;
});

test("API key ingest flow", async ({ page }) => {
  await login(page, "alice@acme.test");
  await page.goto("/t/acme/settings");
  await page.getByLabel("Key name").fill("e2e");
  await page.getByRole("button", { name: "Create key" }).click();
  const key = (await page.getByTestId("secret").textContent())!.trim();
  const ok = await page.request.post("/api/v1/ingest", {
    headers: { authorization: `Bearer ${key}` },
    data: [{ route: "/e2e", method: "GET", statusCode: 200, latencyMs: 12 }],
  });
  expect(ok.status()).toBe(202);
  const bad = await page.request.post("/api/v1/ingest", { headers: { authorization: "Bearer pb_live_nope" }, data: {} });
  expect(bad.status()).toBe(401);
});
