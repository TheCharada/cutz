import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const email = process.env.SEED_ADMIN_EMAIL ?? "admin@cutz.local";
const password = process.env.SEED_ADMIN_PASSWORD ?? "cutz-dev-password";

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin\/b\/demo\/agenda$/);
}

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

test("dedicated customers and waitlist routes have no automated accessibility violations", async ({ page }) => {
  await login(page);

  await page.goto("/admin/b/demo/customers");
  await expect(page.getByRole("heading", { name: "Clientes" })).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto("/admin/b/demo/waitlist");
  await expect(page.getByRole("heading", { name: "Lista de espera", exact: true })).toBeVisible();
  await expectNoA11yViolations(page);
});
