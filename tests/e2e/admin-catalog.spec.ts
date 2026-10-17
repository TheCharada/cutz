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

test("owner manages services and staff through dedicated catalog routes", async ({ page }) => {
  await login(page);

  await page.getByRole("link", { name: "Serviços", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/b\/demo\/services$/);
  await expect(page.getByRole("heading", { name: "Serviços", exact: true })).toBeVisible();

  const invalidName = `E2E Catálogo inválido ${Date.now()}`;
  await page.getByLabel("Nome", { exact: true }).first().fill(invalidName);
  await page.getByLabel("Preço (R$)").first().fill("55foo");
  await page.getByRole("button", { name: "Criar serviço" }).click();
  await expect(page.getByText(/Informe um preço válido, com no máximo duas casas decimais/)).toBeVisible();
  await expect(page.getByText(invalidName, { exact: true })).toHaveCount(0);

  const serviceName = `E2E Catálogo ${Date.now()}`;
  await page.getByLabel("Nome", { exact: true }).first().fill(serviceName);
  await page.getByLabel("Preço (R$)").first().fill("55,00");
  await page.getByRole("button", { name: "Criar serviço" }).click();
  await expect(page.getByText(serviceName, { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Profissionais", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/b\/demo\/staff$/);
  await expect(page.getByRole("heading", { name: "Profissionais", exact: true })).toBeVisible();

  const staffName = `E2E Profissional Catálogo ${Date.now()}`;
  await page.getByLabel("Nome do profissional").fill(staffName);
  await page.getByRole("button", { name: "Adicionar profissional" }).click();
  await expect(page.getByText(staffName, { exact: true })).toBeVisible();

  await page.getByRole("link", { name: `Configurar ${staffName}` }).click();
  await expect(page).toHaveURL(/\/admin\/b\/demo\/staff\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: staffName, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Serviços realizados", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Jornada semanal", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Indisponibilidades", exact: true })).toBeVisible();

  const serviceCheckbox = page.getByLabel(serviceName, { exact: true });
  await serviceCheckbox.check();
  const saveResponse = page.waitForResponse((response) => /\/api\/admin\/b\/demo\/staff\/[^/]+\/services$/.test(response.url()) && response.request().method() === "PUT");
  await page.getByRole("button", { name: "Salvar serviços" }).click();
  expect((await saveResponse).status()).toBe(200);
  await expect(serviceCheckbox).toBeChecked();
});
