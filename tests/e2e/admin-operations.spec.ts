import { expect, test, type Page } from "@playwright/test";

const email = process.env.SEED_ADMIN_EMAIL ?? "admin@cutz.local";
const password = process.env.SEED_ADMIN_PASSWORD ?? "cutz-dev-password";

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin\/b\/demo\/agenda$/);
  await expect(page.getByRole("heading", { name: "Barbearia Exemplo" })).toBeVisible();
}

async function openHistoricalAgenda(page: Page) {
  await page.getByLabel("Data da agenda").fill("2026-09-01");
  await page.getByRole("button", { name: "Atualizar" }).click();
  await expect(page).toHaveURL(/\/admin\/b\/demo\/agenda\?date=2026-09-01$/);
  await expect(page.getByText("E2E Complete")).toBeVisible();
  await expect(page.getByText("E2E No-show")).toBeVisible();
}

test("login → agenda → complete", async ({ page }) => {
  await login(page);
  await openHistoricalAgenda(page);

  const appointment = page.locator("article").filter({ hasText: "E2E Complete" });
  await appointment.getByRole("button", { name: "Concluir" }).click();
  await expect(appointment.getByText("Concluído")).toBeVisible();
});

test("login → agenda → no-show", async ({ page }) => {
  await login(page);
  await openHistoricalAgenda(page);

  const appointment = page.locator("article").filter({ hasText: "E2E No-show" });
  await appointment.getByRole("button", { name: "No-show" }).click();
  await expect(appointment.getByText("No-show", { exact: true })).toBeVisible();
});

test("sessão administrativa existente não volta a exibir o formulário de login", async ({ page }) => {
  await login(page);
  await page.goto("/admin/login");
  await expect(page).toHaveURL(/\/admin\/b\/demo\/agenda$/);
  await expect(page.getByRole("heading", { name: "Barbearia Exemplo" })).toBeVisible();
});
