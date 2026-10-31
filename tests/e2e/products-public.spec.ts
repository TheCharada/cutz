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

test("the public catalog shows available and sold-out products without checkout", async ({ page }) => {
  await login(page);
  await page.goto("/admin/b/demo/products");
  const form = page.locator('[data-slot="card"]').filter({
    has: page.getByRole("heading", { name: "Novo produto" }),
  });
  await form.getByLabel("Nome").fill("Pomada Público");
  await form.getByLabel("Preço (R$)").fill("20,00");
  await form.getByRole("button", { name: "Cadastrar produto" }).click();
  await expect(page.getByRole("heading", { name: "Pomada Público" })).toBeVisible();

  await page.goto("/b/demo");
  await page.getByRole("link", { name: "Ver produtos disponíveis" }).click();
  await expect(page).toHaveURL(/\/b\/demo\/products$/);
  await expect(page.getByRole("heading", { name: "Produtos disponíveis" })).toBeVisible();
  const product = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: "Pomada Público" }),
  });
  await expect(product).toContainText("R$ 20,00");
  await expect(product).toContainText("Esgotado");
  await expect(page.getByRole("button", { name: /comprar|carrinho|checkout/i })).toHaveCount(0);

  await page.getByRole("link", { name: "Voltar ao agendamento" }).click();
  await expect(page).toHaveURL(/\/b\/demo$/);
});
