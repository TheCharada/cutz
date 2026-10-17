import { expect, test, type Page, type Request } from "@playwright/test";

const email = process.env.SEED_ADMIN_EMAIL ?? "admin@cutz.local";
const password = process.env.SEED_ADMIN_PASSWORD ?? "cutz-dev-password";

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin\/b\/demo\/agenda$/);
}

function isInitialAdminApiRead(request: Request) {
  if (request.method() !== "GET") return false;
  const url = new URL(request.url());
  return url.pathname === "/api/auth/session"
    || url.pathname.startsWith("/api/admin/b/demo/analytics/")
    || url.pathname === "/api/admin/b/demo/settings";
}

test("analytics and settings load through server workflows and keep filters in the URL", async ({ page }) => {
  await login(page);
  const initialApiReads: string[] = [];
  page.on("request", (request) => {
    if (isInitialAdminApiRead(request)) initialApiReads.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });

  await page.goto("/admin/b/demo/analytics?from=2026-09-01&to=2026-09-10");
  await expect(page.getByRole("heading", { name: "Indicadores", exact: true })).toBeVisible();
  await expect(page.getByLabel("De")).toHaveValue("2026-09-01");
  await expect(page.getByLabel("Até")).toHaveValue("2026-09-10");
  await expect(page.getByText("Cancelamentos", { exact: true }).first()).toBeVisible();
  expect(initialApiReads).toEqual([]);

  await page.getByLabel("De").fill("2026-09-02");
  await page.getByLabel("Até").fill("2026-09-09");
  await page.getByRole("button", { name: "Atualizar período" }).click();
  await expect(page).toHaveURL(/\/analytics\?from=2026-09-02&to=2026-09-09$/);
  await expect(page.getByLabel("De")).toHaveValue("2026-09-02");
  await expect(page.getByLabel("Até")).toHaveValue("2026-09-09");

  initialApiReads.length = 0;
  await page.goto("/admin/b/demo/settings");
  await expect(page.getByRole("heading", { name: "Configurações", exact: true })).toBeVisible();
  await expect(page.getByLabel("Nome")).toHaveValue("Barbearia Exemplo");
  await expect(page.getByLabel("Timezone")).toHaveValue("America/Sao_Paulo");
  expect(initialApiReads).toEqual([]);

  const saveResponse = page.waitForResponse((response) =>
    response.request().method() === "PATCH" && new URL(response.url()).pathname === "/api/admin/b/demo/settings",
  );
  await page.getByRole("button", { name: "Salvar configurações" }).click();
  expect((await saveResponse).status()).toBe(200);
  await expect(page.getByText("Configurações salvas.")).toBeVisible();
});

test("analytics reports invalid URL ranges without issuing report API requests", async ({ page }) => {
  await login(page);
  const reportApiReads: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname.startsWith("/api/admin/b/demo/analytics/")) {
      reportApiReads.push(url.pathname);
    }
  });

  await page.goto("/admin/b/demo/analytics?from=2026-09-10&to=2026-09-01");
  await expect(page.getByRole("alert").filter({ hasText: "Período inválido" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Resumo dos indicadores" })).toHaveCount(0);
  expect(reportApiReads).toEqual([]);
});

test("owner admin surfaces remain responsive on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);

  for (const path of ["analytics", "settings"]) {
    await page.goto(`/admin/b/demo/${path}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow, `${path} should not overflow horizontally`).toBe(false);
  }
});
