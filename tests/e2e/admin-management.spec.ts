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

test("legacy management route redirects to customers", async ({ page }) => {
  await login(page);
  await page.goto("/admin/b/demo/management");
  await expect(page).toHaveURL(/\/admin\/b\/demo\/customers$/);
  await expect(page.getByRole("heading", { name: "Clientes" })).toBeVisible();
});
