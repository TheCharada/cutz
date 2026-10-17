import { expect, test } from "@playwright/test";

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

test("cliente conclui booking público em verification_mode=NONE", async ({ page }) => {
  await page.goto("/b/demo");

  await expect(page.getByRole("heading", { name: "Agendar horário" })).toBeVisible();
  const slotSection = page.getByRole("heading", { name: "1. Escolha o horário" }).locator("..");
  await slotSection.getByLabel("Serviço").selectOption({ label: "Corte" });
  await slotSection.getByLabel("Profissional").selectOption({ label: "Profissional Exemplo" });
  await slotSection.getByLabel("Data").fill(nextWeekday(1, demoTimezone));
  await slotSection.getByRole("button", { name: "Buscar horários" }).click();

  const firstSlot = slotSection.getByRole("button", { name: /Selecionar horário/ }).first();
  await expect(firstSlot).toBeVisible();
  await firstSlot.click();

  const customerSection = page.getByRole("heading", { name: "2. Seus dados" }).locator("..");
  await customerSection.getByLabel("Nome").fill("Cliente E2E");
  await customerSection.getByLabel("Telefone").fill("(14) 99999-1234");
  await customerSection.getByRole("button", { name: "Confirmar agendamento" }).click();

  await expect(page.getByRole("heading", { name: "Agendamento confirmado" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Gerenciar agendamento" })).toHaveAttribute(
    "href",
    /\/a\/[A-Za-z0-9_-]+$/,
  );
});
