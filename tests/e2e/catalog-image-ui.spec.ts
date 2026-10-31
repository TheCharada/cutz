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

test("owner can upload, replace and remove service and staff photos", async ({ page }) => {
  await login(page);
  await page.goto("/admin/b/demo/services");
  const service = page.locator('[data-slot="card"]').filter({
    has: page.getByRole("heading", { name: "Corte", exact: true }),
  });
  const file = { name: "imagem.png", mimeType: "image/png", buffer: png };
  await service.getByLabel("Fotografia do serviço").setInputFiles(file);
  await service.getByRole("button", { name: "Enviar imagem" }).click();
  await expect(service.locator("img")).toHaveAttribute("src", /\/api\/b\/demo\/images\/services\//);

  const firstUrl = await service.locator("img").getAttribute("src");
  expect(firstUrl).toContain("/api/b/demo/images/services/");

  await service.getByLabel("Fotografia do serviço").setInputFiles(file);
  await service.getByRole("button", { name: "Substituir imagem" }).click();
  await expect.poll(async () => {
    const src = await service.locator("img").getAttribute("src");
    return Boolean(src?.startsWith("/api/b/demo/images/services/") && src !== firstUrl);
  }).toBe(true);

  await page.goto("/b/demo");
  const servicePhoto = page.getByRole("radio", { name: "Corte" }).locator("..").locator("img");
  await expect(servicePhoto).toBeVisible();
  const publicUrl = await servicePhoto.getAttribute("src");
  expect(publicUrl).toBeTruthy();
  const response = await page.request.get(publicUrl!);
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("image/webp");

  await page.goto("/admin/b/demo/services");
  const savedService = page.locator('[data-slot="card"]').filter({
    has: page.getByRole("heading", { name: "Corte", exact: true }),
  });
  await savedService.getByRole("button", { name: "Remover imagem" }).click();
  await savedService.getByRole("button", { name: "Confirmar remoção" }).click();
  await expect(savedService.locator("img")).toHaveCount(0);

  await page.goto("/admin/b/demo/staff");
  await page.getByRole("link", { name: "Configurar Profissional Exemplo" }).click();
  const staffUrl = page.url();
  await page.getByLabel("Fotografia do profissional").setInputFiles(file);
  await page.getByRole("button", { name: "Enviar imagem" }).click();
  await expect(page.locator('[data-slot="card"]').first().locator("img"))
    .toHaveAttribute("src", /\/api\/b\/demo\/images\/staff\//);

  await page.goto("/b/demo");
  const staffPhoto = page.getByRole("radio", { name: "Profissional Exemplo" })
    .locator("..").locator("img");
  await expect(staffPhoto).toBeVisible();

  await page.goto(staffUrl);
  await page.getByRole("button", { name: "Remover imagem" }).click();
  await page.getByRole("button", { name: "Confirmar remoção" }).click();
  await expect(page.locator('[data-slot="card"]').first().locator("img")).toHaveCount(0);

  await page.goto("/b/demo");
  await expect(page.getByRole("radio", { name: "Corte" }).locator("..").locator("img")).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Profissional Exemplo" })
    .locator("..").locator("img")).toHaveCount(0);
});
