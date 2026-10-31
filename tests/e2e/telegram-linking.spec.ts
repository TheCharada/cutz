import { chooseService, chooseStaff } from "./helpers/choose-service";
import { expect, test, type APIRequestContext } from "@playwright/test";

const botUsername = process.env.TELEGRAM_BOT_USERNAME;
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
test.skip(!botUsername || !webhookSecret, "Telegram test bot environment is not configured");

const timezone = "America/Sao_Paulo";

function nextMonday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const values = new Map(parts.map(item => [item.type, item.value]));
  const date = new Date(Date.UTC(
    Number(values.get("year")), Number(values.get("month")) - 1, Number(values.get("day")),
  ));
  const delta = ((8 - date.getUTCDay()) % 7) || 7;
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

async function webhook(request: APIRequestContext, text: string, updateId: number) {
  return request.post("/api/webhooks/telegram", {
    headers: { "x-telegram-bot-api-secret-token": webhookSecret! },
    data: {
      update_id: updateId,
      message: {
        chat: { id: 123456789, type: "private" },
        from: { id: 123456789, is_bot: false },
        text,
      },
    },
  });
}

test("optional Telegram linking survives booking, waitlist and stop", async ({ page, request }) => {
  const suffix = String(Date.now()).slice(-7);
  const date = nextMonday();

  await page.goto("/b/demo");
  const booking = page.getByRole("heading", { name: "1. Escolha o horário" }).locator("..");
  await chooseService(booking, "Corte");
  await chooseStaff(booking, "Profissional Exemplo");
  await booking.getByLabel("Data").fill(date);
  await booking.getByRole("button", { name: "Buscar horários" }).click();
  const slot = booking.getByRole("button", { name: /Selecionar horário/ }).first();
  await expect(slot).toBeVisible();
  await slot.click();

  const customer = page.getByRole("heading", { name: "2. Seus dados" }).locator("..");
  await customer.getByLabel("Nome").fill(`Telegram Test ${suffix}`);
  await customer.getByLabel("Telefone").fill(`(14) 9${suffix.slice(-4)}-1212`);
  await customer.getByRole("button", { name: "Confirmar agendamento" }).click();
  await expect(page.getByRole("heading", { name: "Agendamento confirmado" })).toBeVisible();

  await page.getByRole("button", { name: "Conectar Telegram" }).click();
  const firstLink = page.getByRole("link", { name: /Abrir Telegram/ });
  await expect(firstLink).toHaveAttribute("href", new RegExp(`^https://t\\.me/${botUsername}\\?start=[A-Za-z0-9_-]{43}$`));
  await expect(firstLink).toHaveAttribute("rel", /noreferrer/);
  const firstToken = new URL((await firstLink.getAttribute("href"))!).searchParams.get("start")!;
  expect((await webhook(request, `/start ${firstToken}`, 1001)).ok()).toBe(true);
  const replay = await webhook(request, `/start ${firstToken}`, 1002);
  expect((await replay.json()).text).toContain("Gere um novo link");

  await page.getByRole("link", { name: "Gerenciar agendamento" }).click();
  await expect(page.getByRole("heading", { name: "Gerenciar agendamento" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Conectar Telegram" })).toBeVisible();

  await page.goto("/b/demo");
  const waitlist = page.getByRole("heading", { name: "Lista de espera", exact: true }).locator("..");
  await chooseService(waitlist, "Corte");
  await waitlist.getByLabel("Data desejada").fill(date);
  await waitlist.getByLabel("A partir de").fill("08:00");
  await waitlist.getByLabel("Até").fill("18:00");
  await waitlist.getByRole("button", { name: "Entrar na lista de espera" }).click();
  await expect(page.getByRole("heading", { name: "Lista de espera ativada" })).toBeVisible();

  await page.getByRole("button", { name: "Conectar Telegram" }).click();
  const secondLink = page.getByRole("link", { name: /Abrir Telegram/ });
  await expect(secondLink).toBeVisible();
  const secondToken = new URL((await secondLink.getAttribute("href"))!).searchParams.get("start")!;
  expect(secondToken).not.toBe(firstToken);
  expect((await webhook(request, `/start ${secondToken}`, 1003)).ok()).toBe(true);

  expect((await webhook(request, "/stop", 1004)).ok()).toBe(true);
  await page.getByRole("link", { name: "Gerenciar lista de espera" }).click();
  await expect(page.getByRole("heading", { name: "Gerenciar lista de espera" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Conectar Telegram" })).toBeVisible();
});
