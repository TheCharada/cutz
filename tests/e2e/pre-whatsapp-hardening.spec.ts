import { chooseService } from "./helpers/choose-service";
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
  if (delta === 0) delta = 7;
  civilDate.setUTCDate(civilDate.getUTCDate() + delta);
  return civilDate.toISOString().slice(0, 10);
}

async function selectFirstSlot(page: Page) {
  const slotSection = page.getByRole("heading", { name: "1. Escolha o horário" }).locator("..");
  await chooseService(slotSection.getByLabel("Serviço"), "Corte");
  await slotSection.getByLabel("Profissional").selectOption({ label: "Profissional Exemplo" });
  await slotSection.getByLabel("Data").fill(nextWeekday(1, demoTimezone));
  await slotSection.getByRole("button", { name: "Buscar horários" }).click();
  const firstSlot = slotSection.getByRole("button", { name: /Selecionar horário/ }).first();
  await expect(firstSlot).toBeVisible();
  await firstSlot.click();
}

async function identifyAndSubmit(page: Page, phone: string) {
  const customerSection = page.getByRole("heading", { name: "2. Seus dados" }).locator("..");
  await customerSection.getByLabel("Nome").fill("Cliente Persistente E2E");
  await customerSection.getByLabel("Telefone").fill(phone);
  await customerSection.getByRole("button", { name: "Confirmar agendamento" }).click();
}

test("reutiliza a sessão do cliente e permite trocar a identidade lembrada", async ({ page }) => {
  await page.goto("/b/demo");
  await selectFirstSlot(page);
  await identifyAndSubmit(page, "(14) 99999-3456");
  await expect(page.getByRole("heading", { name: "Agendamento confirmado" })).toBeVisible();

  await page.goto("/b/demo");
  const customerSection = page.getByRole("heading", { name: "2. Seus dados" }).locator("..");
  await expect(customerSection.getByText("Continuando como")).toBeVisible();
  await expect(customerSection.getByText("Cliente Persistente E2E")).toBeVisible();
  await expect(customerSection.getByLabel("Nome")).toHaveCount(0);

  const waitlist = page.locator("#lista-de-espera");
  await expect(waitlist.getByText("Cliente Persistente E2E")).toBeVisible();
  await expect(waitlist.getByLabel("Nome")).toHaveCount(0);

  await customerSection.getByRole("button", { name: "Trocar cliente" }).click();
  await expect(customerSection.getByLabel("Nome")).toBeVisible();
  await expect(waitlist.getByLabel("Nome")).toBeVisible();
});

test("conflito de horário é localizado e atualiza a disponibilidade", async ({ page }) => {
  let availabilityRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "GET" && request.url().includes("/api/b/demo/availability?")) {
      availabilityRequests += 1;
    }
  });
  await page.route("**/api/b/demo/appointments", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "APPOINTMENT_CONFLICT",
          message: "Requested time is no longer available",
        },
      }),
    });
  });

  await page.goto("/b/demo");
  await selectFirstSlot(page);
  const beforeSubmit = availabilityRequests;
  await identifyAndSubmit(page, "(14) 99999-4567");

  const conflictAlert = page
    .getByRole("alert")
    .filter({ hasText: "Esse horário não está mais disponível" });
  await expect(conflictAlert).toContainText(
    "Esse horário não está mais disponível. Atualizamos os horários para você escolher outro.",
  );
  await expect(page.getByText("Requested time is no longer available")).toHaveCount(0);
  await expect.poll(() => availabilityRequests).toBeGreaterThan(beforeSubmit);
  await expect(page.getByText(/Horário selecionado:/)).toHaveCount(0);
});

test("tema escuro pode ser alternado e persiste no navegador", async ({ page }) => {
  await page.goto("/b/demo");
  await page.evaluate(() => window.localStorage.removeItem("cutz-theme"));
  await page.reload();

  const html = page.locator("html");
  const toggle = page.getByRole("button", { name: /Ativar tema (claro|escuro)/ });
  const initialTheme = await html.getAttribute("data-theme");
  await toggle.click();
  const expected = initialTheme === "dark" ? "light" : "dark";
  await expect(html).toHaveAttribute("data-theme", expected);

  await page.reload();
  await expect(html).toHaveAttribute("data-theme", expected);
});
