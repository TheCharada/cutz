import { expect, test, type APIRequestContext } from "@playwright/test";

const timezone = "America/Sao_Paulo";

function nextMonday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
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
  date.setUTCDate(date.getUTCDate() + ((8 - date.getUTCDay()) % 7 || 7));
  return date.toISOString().slice(0, 10);
}

function localTime(instant: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(instant));
}

async function firstAvailableSlot(request: APIRequestContext, serviceId: string, date: string) {
  const query = new URLSearchParams({ serviceId, date });
  const response = await request.get(`/api/b/demo/availability?${query}`);
  expect(response.ok()).toBe(true);
  const result = (await response.json()) as {
    slots: Array<{ staffId: string; startsAt: string; endsAt: string }>;
  };
  expect(result.slots.length).toBeGreaterThan(0);
  return result.slots[0];
}

test("shows available slots in the waitlist and continues booking with the chosen time", async ({ page, request }) => {
  await page.goto("/b/demo");
  const booking = page.locator("#booking-flow");
  const waitlist = page.getByRole("heading", { name: "Lista de espera", exact: true }).locator("..");
  await waitlist.getByLabel("Serviço").selectOption({ label: "Corte" });
  const serviceId = await waitlist.getByLabel("Serviço").inputValue();
  const date = nextMonday();
  const slot = await firstAvailableSlot(request, serviceId, date);

  await waitlist.getByLabel("Profissional").selectOption(slot.staffId);
  await waitlist.getByLabel("Data desejada").fill(date);
  await waitlist.getByLabel("A partir de").fill(localTime(slot.startsAt));
  await waitlist.getByLabel("Até").fill(localTime(slot.endsAt));

  await expect(waitlist.getByText("Encontramos horários disponíveis")).toBeVisible();
  await waitlist.getByRole("button", { name: /Agendar/ }).first().click();
  await expect(booking.getByText(`Horário selecionado: ${localTime(slot.startsAt)}`)).toBeVisible();
  await expect(booking.getByLabel("Data")).toHaveValue(date);

  const suffix = String(Date.now()).slice(-4);
  await booking.getByLabel("Nome").fill(`Cliente Sugestão ${suffix}`);
  await booking.getByLabel("Telefone").fill(`(14) 9${suffix}-7001`);
  await booking.getByRole("button", { name: "Confirmar agendamento" }).click();
  await expect(booking.getByRole("heading", { name: "Agendamento confirmado" })).toBeVisible();
});

test("lets the customer join the waitlist even when a bookable slot exists", async ({ page, request }) => {
  await page.goto("/b/demo");
  const waitlist = page.getByRole("heading", { name: "Lista de espera", exact: true }).locator("..");
  await waitlist.getByLabel("Serviço").selectOption({ label: "Corte" });
  const serviceId = await waitlist.getByLabel("Serviço").inputValue();
  const date = nextMonday();
  const slot = await firstAvailableSlot(request, serviceId, date);

  await waitlist.getByLabel("Data desejada").fill(date);
  await waitlist.getByLabel("A partir de").fill(localTime(slot.startsAt));
  await waitlist.getByLabel("Até").fill(localTime(slot.endsAt));
  await expect(waitlist.getByText("Encontramos horários disponíveis")).toBeVisible();

  const suffix = String(Date.now()).slice(-4);
  await waitlist.getByLabel("Nome").fill(`Cliente Fila ${suffix}`);
  await waitlist.getByLabel("Telefone").fill(`(13) 9${suffix}-7002`);
  await waitlist.getByRole("button", { name: "Entrar na lista de espera" }).click();
  await expect(page.getByRole("heading", { name: "Lista de espera ativada" })).toBeVisible();
});
