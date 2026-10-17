import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const demoTimezone = "America/Sao_Paulo";
const email = process.env.SEED_ADMIN_EMAIL ?? "admin@cutz.local";
const password = process.env.SEED_ADMIN_PASSWORD ?? "cutz-dev-password";

function localDateParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
  };
}

function nextWeekday(targetDay: number, timeZone: string) {
  const local = localDateParts(new Date(), timeZone);
  const civilDate = new Date(Date.UTC(local.year, local.month - 1, local.day));
  const current = civilDate.getUTCDay();
  let delta = (targetDay - current + 7) % 7;
  if (delta === 0) delta = 7;
  civilDate.setUTCDate(civilDate.getUTCDate() + delta);
  return civilDate.toISOString().slice(0, 10);
}

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin\/b\/demo\/agenda$/);
}

async function createBooking(page: Page, phone: string) {
  await page.goto("/b/demo");
  const slotSection = page.getByRole("heading", { name: "1. Escolha o horário" }).locator("..");
  await slotSection.getByLabel("Serviço").selectOption({ label: "Corte" });
  await slotSection.getByLabel("Profissional").selectOption({ label: "Profissional Exemplo" });
  await slotSection.getByLabel("Data").fill(nextWeekday(1, demoTimezone));
  await slotSection.getByRole("button", { name: "Buscar horários" }).click();
  const firstSlot = slotSection.getByRole("button", { name: /Selecionar horário/ }).first();
  await expect(firstSlot).toBeVisible();
  await firstSlot.click();

  const customerSection = page.getByRole("heading", { name: "2. Seus dados" }).locator("..");
  await customerSection.getByLabel("Nome").fill("Cliente A11y E2E");
  await customerSection.getByLabel("Telefone").fill(phone);
  await customerSection.getByRole("button", { name: "Confirmar agendamento" }).click();
  await expect(page.getByRole("heading", { name: "Agendamento confirmado" })).toBeVisible();
}

test("booking público não possui violações automatizadas de acessibilidade", async ({ page }) => {
  await page.goto("/b/demo");
  await expect(page.getByRole("heading", { name: "Agendar horário" })).toBeVisible();
  await expectNoA11yViolations(page);
});

test("capability de appointment e confirmação destrutiva não possuem violações automatizadas", async ({ page }) => {
  await createBooking(page, "(14) 99999-8765");
  await page.getByRole("link", { name: "Gerenciar agendamento" }).click();
  await expect(page.getByRole("heading", { name: "Gerenciar agendamento" })).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByRole("button", { name: "Cancelar agendamento" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Cancelar este agendamento?" });
  await expect(dialog).toBeVisible();
  await expectNoA11yViolations(page);
  await dialog.getByRole("button", { name: "Voltar" }).click();
  await expect(dialog).toBeHidden();
});

test("login, agenda e clientes não possuem violações automatizadas de acessibilidade", async ({ page }) => {
  await page.goto("/admin/login");
  await expect(page.getByRole("heading", { name: "Acesso administrativo" })).toBeVisible();
  await expectNoA11yViolations(page);

  await login(page);
  await expect(page.getByRole("heading", { name: "Barbearia Exemplo" })).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByRole("link", { name: "Clientes" }).click();
  await expect(page.getByRole("heading", { name: "Clientes" })).toBeVisible();
  await expectNoA11yViolations(page);
});

test("fluxo público permite ativar ações principais pelo teclado", async ({ page }) => {
  await page.goto("/b/demo");
  const slotSection = page.getByRole("heading", { name: "1. Escolha o horário" }).locator("..");
  await slotSection.getByLabel("Serviço").selectOption({ label: "Corte" });
  await slotSection.getByLabel("Profissional").selectOption({ label: "Profissional Exemplo" });
  await slotSection.getByLabel("Data").fill(nextWeekday(1, demoTimezone));

  const search = slotSection.getByRole("button", { name: "Buscar horários" });
  await search.focus();
  await page.keyboard.press("Enter");
  const firstSlot = slotSection.getByRole("button", { name: /Selecionar horário/ }).first();
  await expect(firstSlot).toBeVisible();
  await firstSlot.focus();
  await page.keyboard.press("Space");
  await expect(firstSlot).toHaveAttribute("aria-pressed", "true");

  const customerSection = page.getByRole("heading", { name: "2. Seus dados" }).locator("..");
  const name = customerSection.getByLabel("Nome");
  await name.focus();
  await page.keyboard.type("Cliente Teclado E2E");
  const phone = customerSection.getByLabel("Telefone");
  await phone.focus();
  await page.keyboard.type("(14) 99999-7654");
  const confirm = customerSection.getByRole("button", { name: "Confirmar agendamento" });
  await confirm.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Agendamento confirmado" })).toBeVisible();
});

test("booking público tem smoke responsivo em mobile e desktop", async ({ page }) => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/b/demo");
    await expect(page.getByRole("heading", { name: "Agendar horário" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  }
});
