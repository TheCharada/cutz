import { chooseService, chooseStaff } from "./helpers/choose-service";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const demoTimezone = "America/Sao_Paulo";

function nextMonday(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const date = new Date(Date.UTC(
    Number(values.get("year")),
    Number(values.get("month")) - 1,
    Number(values.get("day")),
  ));
  let delta = (1 - date.getUTCDay() + 7) % 7;
  if (delta === 0) delta = 7;
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

async function createBooking(page: Page) {
  await page.goto("/b/demo");
  const slotSection = page.getByRole("heading", { name: "1. Escolha o horário" }).locator("..");
  await chooseService(slotSection, "Corte");
  await chooseStaff(slotSection, "Profissional Exemplo");
  await slotSection.getByLabel("Data").fill(nextMonday(demoTimezone));
  await slotSection.getByRole("button", { name: "Buscar horários" }).click();
  const slot = slotSection.getByRole("button", { name: /Selecionar horário/ }).first();
  await expect(slot).toBeVisible();
  await slot.click();

  const customerSection = page.getByRole("heading", { name: "2. Seus dados" }).locator("..");
  await customerSection.getByLabel("Nome").fill("Cliente Contraste E2E");
  await customerSection.getByLabel("Telefone").fill("(14) 99999-5678");
  await customerSection.getByRole("button", { name: "Confirmar agendamento" }).click();
  await expect(page.getByRole("heading", { name: "Agendamento confirmado" })).toBeVisible();
}

test("tema escuro mantém a página pública sem violações automatizadas de acessibilidade", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("cutz-theme", "dark"));
  await page.goto("/b/demo");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expectNoA11yViolations(page);
});

test("estado confirmado mantém contraste acessível em links estilizados como botão", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("cutz-theme", "light"));
  await createBooking(page);
  await expectNoA11yViolations(page);
});
