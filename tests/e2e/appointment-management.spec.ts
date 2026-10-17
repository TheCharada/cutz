import { expect, test, type Page } from "@playwright/test";

const demoTimezone = "America/Sao_Paulo";

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
  if (delta === 0) {
    delta = 7;
  }
  civilDate.setUTCDate(civilDate.getUTCDate() + delta);
  return civilDate.toISOString().slice(0, 10);
}

async function createBookingAndOpenManagement(page: Page) {
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
  await customerSection.getByLabel("Nome").fill("Cliente Capability E2E");
  await customerSection.getByLabel("Telefone").fill("(14) 99999-4321");
  await customerSection.getByRole("button", { name: "Confirmar agendamento" }).click();
  await expect(page.getByRole("heading", { name: "Agendamento confirmado" })).toBeVisible();
  await page.getByRole("link", { name: "Gerenciar agendamento" }).click();
  await expect(page.getByRole("heading", { name: "Gerenciar agendamento" })).toBeVisible();
}

test("cliente cancela agendamento por capability com confirmação explícita", async ({ page }) => {
  await createBookingAndOpenManagement(page);

  await page.getByLabel("Motivo (opcional)").fill("Imprevisto");
  await page.getByRole("button", { name: "Cancelar agendamento" }).click();

  const dialog = page.getByRole("alertdialog", { name: "Cancelar este agendamento?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Confirmar cancelamento" }).click();

  await expect(page.getByRole("heading", { name: "Agendamento cancelado" })).toBeVisible();
  await expect(page.getByText("Motivo informado: Imprevisto")).toBeVisible();
});

test("cliente reagenda agendamento por capability", async ({ page }) => {
  await createBookingAndOpenManagement(page);
  const oldUrl = page.url();

  await page.getByLabel("Nova data").fill(nextWeekday(1, demoTimezone));
  await page.getByRole("button", { name: "Buscar novos horários" }).click();
  const firstSlot = page.getByRole("button", { name: /Selecionar novo horário/ }).first();
  await expect(firstSlot).toBeVisible();
  await firstSlot.click();
  await page.getByRole("button", { name: "Confirmar reagendamento" }).click();

  await page.waitForURL((url) => url.toString() !== oldUrl);
  await expect(page).toHaveURL(/\/a\/[A-Za-z0-9_-]+$/);
  await expect(page.getByRole("heading", { name: "Agendamento confirmado" })).toBeVisible();
});
