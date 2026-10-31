import { chooseService } from "./helpers/choose-service";
import { expect, test } from "@playwright/test";
import pg from "pg";

const { Client } = pg;
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
  if (delta === 0) delta = 7;
  civilDate.setUTCDate(civilDate.getUTCDate() + delta);
  return civilDate.toISOString().slice(0, 10);
}

function localTime(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("hour")}:${values.get("minute")}`;
}

function capabilityToken(href: string) {
  const token = new URL(href, "http://localhost").pathname.split("/").filter(Boolean).at(-1);
  if (!token) throw new Error(`Missing capability token in ${href}`);
  return token;
}

async function findOfferActionUrl(waitlistEntryId: string) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for waitlist E2E");

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(
      `select payload
         from notification_jobs
        where waitlist_entry_id = $1
          and type = 'WAITLIST_OFFER'
        order by created_at desc
        limit 1`,
      [waitlistEntryId],
    );
    const payload = result.rows[0]?.payload as { actionUrl?: unknown } | undefined;
    if (!payload || typeof payload.actionUrl !== "string") {
      throw new Error("WAITLIST_OFFER NotificationJob not found");
    }
    return payload.actionUrl;
  } finally {
    await client.end();
  }
}

test("cliente entra na fila, recebe vaga liberada e aceita criando Appointment", async ({ page, request }) => {
  const desiredDate = nextWeekday(1, demoTimezone);
  const suffix = String(Date.now()).slice(-4);

  await page.goto("/b/demo");
  const bookingSlots = page.getByRole("heading", { name: "1. Escolha o horário" }).locator("..");
  await chooseService(bookingSlots.getByLabel("Serviço"), "Corte");
  await bookingSlots.getByLabel("Profissional").selectOption({ label: "Profissional Exemplo" });
  await bookingSlots.getByLabel("Data").fill(desiredDate);
  await bookingSlots.getByRole("button", { name: "Buscar horários" }).click();
  const firstSlot = bookingSlots.getByRole("button", { name: /Selecionar horário/ }).first();
  await expect(firstSlot).toBeVisible();
  await firstSlot.click();

  const customerData = page.getByRole("heading", { name: "2. Seus dados" }).locator("..");
  await customerData.getByLabel("Nome").fill(`Cliente Origem ${suffix}`);
  await customerData.getByLabel("Telefone").fill(`(14) 9${suffix}-1001`);
  await customerData.getByRole("button", { name: "Confirmar agendamento" }).click();
  await expect(page.getByRole("heading", { name: "Agendamento confirmado" })).toBeVisible();

  const appointmentLink = page.getByRole("link", { name: "Gerenciar agendamento" });
  const appointmentHref = await appointmentLink.getAttribute("href");
  if (!appointmentHref) throw new Error("Missing appointment management URL");
  const appointmentToken = capabilityToken(appointmentHref);
  const appointmentResponse = await request.get(`/api/capabilities/appointments/${appointmentToken}`);
  expect(appointmentResponse.ok()).toBe(true);
  const appointmentView = (await appointmentResponse.json()) as {
    appointment: { startsAt: string; endsAt: string };
  };

  await page.goto("/b/demo");
  const waitlist = page.getByRole("heading", { name: "Lista de espera", exact: true }).locator("..");
  await chooseService(waitlist.getByLabel("Serviço"), "Corte");
  await waitlist.getByLabel("Profissional").selectOption({ label: "Profissional Exemplo" });
  await waitlist.getByLabel("Data desejada").fill(desiredDate);
  await waitlist.getByLabel("A partir de").fill(localTime(appointmentView.appointment.startsAt, demoTimezone));
  await waitlist.getByLabel("Até").fill(localTime(appointmentView.appointment.endsAt, demoTimezone));

  await expect(waitlist.getByText(`Cliente Origem ${suffix}`)).toBeVisible();
  await waitlist.getByRole("button", { name: "Trocar cliente" }).click();
  await expect(waitlist.getByLabel("Nome")).toBeVisible();
  await waitlist.getByLabel("Nome").fill(`Cliente Fila ${suffix}`);
  await waitlist.getByLabel("Telefone").fill(`(13) 9${suffix}-1002`);
  await waitlist.getByRole("button", { name: "Entrar na lista de espera" }).click();

  await expect(page.getByRole("heading", { name: "Lista de espera ativada" })).toBeVisible();
  const waitlistLink = page.getByRole("link", { name: "Gerenciar lista de espera" });
  const waitlistHref = await waitlistLink.getAttribute("href");
  if (!waitlistHref) throw new Error("Missing waitlist management URL");
  const waitlistToken = capabilityToken(waitlistHref);
  const waitlistResponse = await request.get(`/api/capabilities/waitlist/${waitlistToken}`);
  expect(waitlistResponse.ok()).toBe(true);
  const waitlistView = (await waitlistResponse.json()) as { waitlistEntry: { id: string } };

  await page.goto(appointmentHref);
  await expect(page.getByRole("heading", { name: "Gerenciar agendamento" })).toBeVisible();
  await page.getByRole("button", { name: "Cancelar agendamento" }).click();
  const cancelDialog = page.getByRole("alertdialog", { name: "Cancelar este agendamento?" });
  await expect(cancelDialog).toBeVisible();
  await cancelDialog.getByRole("button", { name: "Confirmar cancelamento" }).click();
  await expect(page.getByRole("heading", { name: "Agendamento cancelado" })).toBeVisible();

  const actionUrl = await findOfferActionUrl(waitlistView.waitlistEntry.id);
  await page.goto(actionUrl);
  await expect(page.getByRole("heading", { name: "Uma vaga foi reservada para você" })).toBeVisible();
  await page.getByRole("button", { name: "Aceitar vaga" }).click();

  await page.waitForURL(/\/a\/[A-Za-z0-9_-]+$/);
  await expect(page.getByRole("heading", { name: "Gerenciar agendamento" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Agendamento confirmado" })).toBeVisible();
});
