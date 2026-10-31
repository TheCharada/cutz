import { expect, test, type Page } from "@playwright/test";

const email = process.env.SEED_ADMIN_EMAIL ?? "admin@cutz.local";
const password = process.env.SEED_ADMIN_PASSWORD ?? "cutz-dev-password";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAFElEQVR4nGNs9VRlwA2Y8MiNYGkAMh0BB9BM1CcAAAAASUVORK5CYII=",
  "base64",
);

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin\/b\/demo\/agenda$/);
}

test("owner can manage a product, update stock and upload a photo", async ({ page }) => {
  await login(page);
  await page.goto("/admin/b/demo/products");
  await expect(page.getByRole("heading", { name: "Produtos e estoque" })).toBeVisible();

  await page.getByLabel("Nome").fill("Leave-in Exemplo");
  await page.getByLabel("Descrição").fill("Finalizador capilar");
  await page.getByLabel("Preço (R$)").fill("45,00");
  await page.getByLabel("Estoque mínimo").fill("2");
  await page.getByRole("button", { name: "Cadastrar produto" }).click();

  const product = page.locator('[data-slot="card"]').filter({
    has: page.getByRole("heading", { name: "Leave-in Exemplo" }),
  });
  await expect(product).toBeVisible();
  await product.getByRole("button", { name: "Movimentar estoque e consultar histórico" }).click();
  await product.getByLabel("Quantidade").fill("5");
  await product.getByLabel("Motivo").fill("Estoque inicial");
  await product.getByRole("button", { name: "Registrar movimentação" }).click();
  await expect(product.getByText("Movimentação registrada.")).toBeVisible();
  await expect(product.getByText(/Saldo atual: 5 unidade\(s\)/)).toBeVisible();

  await product.getByLabel("Fotografia do produto").setInputFiles({
    name: "produto.png", mimeType: "image/png", buffer: png,
  });
  await product.getByRole("button", { name: "Enviar imagem" }).click();
  await expect(product.locator("img")).toHaveAttribute("src", /\/images\/products\//);
  const src = await product.locator("img").getAttribute("src");
  expect(src).toBeTruthy();
  const response = await page.request.get(src!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("image/webp");
});
