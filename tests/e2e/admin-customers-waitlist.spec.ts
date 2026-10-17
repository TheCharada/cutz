import { expect, test, type Page } from "@playwright/test";

const email = process.env.SEED_ADMIN_EMAIL ?? "admin@cutz.local";
const password = process.env.SEED_ADMIN_PASSWORD ?? "cutz-dev-password";
const demoTimezone = "America/Sao_Paulo";

function nextWeekday(targetDay: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const date = new Date(Date.UTC(Number(values.get("year")), Number(values.get("month")) - 1, Number(values.get("day"))));
  let delta = (targetDay - date.getUTCDay() + 7) % 7;
  if (delta === 0) delta = 7;
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin\/b\/demo\/agenda$/);
}

test("staff surfaces load customers server-side and operate the waitlist through dedicated routes", async ({ page }) => {
  await login(page);

  await page.getByRole("link", { name: "Clientes" }).click();
  await expect(page).toHaveURL(/\/admin\/b\/demo\/customers$/);
  await page.getByLabel("Pesquisar cliente").fill("E2E Complete");
  await page.getByRole("button", { name: "Pesquisar" }).click();
  await expect(page).toHaveURL(/\/customers\?q=E2E\+Complete$/);
  await expect(page.getByText("1 cliente(s) encontrado(s).", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: /E2E Complete/ }).click();
  await expect(page.getByRole("heading", { name: "E2E Complete" })).toBeVisible();
  await expect(page.getByText(/01\/09\/2026, 09:00/)).toBeVisible();

  await page.getByRole("link", { name: "Lista de espera" }).click();
  await expect(page).toHaveURL(/\/admin\/b\/demo\/waitlist$/);
  await expect(page.getByRole("heading", { name: "Lista de espera", exact: true })).toBeVisible();
  await page.getByLabel("Cliente").selectOption({ label: "E2E Complete · +5511999990001" });
  await page.getByLabel("Serviço").selectOption({ label: "Corte" });
  await page.getByLabel("Profissional").selectOption({ label: "Profissional Exemplo" });
  await page.getByLabel("Data desejada").fill(nextWeekday(1, demoTimezone));
  await page.getByRole("button", { name: "Adicionar à lista de espera" }).click();
  await expect(page.getByText("Entrada adicionada à lista de espera.")).toBeVisible();

  const entry = page.getByRole("article").filter({ hasText: "E2E Complete" }).last();
  await expect(entry).toContainText("Ativa");
  await entry.getByRole("button", { name: "Cancelar entrada" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Cancelar entrada da lista de espera?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancelar entrada" }).click();
  await expect(page.getByText("Entrada cancelada.")).toBeVisible();
  await expect(entry).toContainText("Cancelada");
});
