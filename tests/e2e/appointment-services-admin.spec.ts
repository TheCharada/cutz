import { expect, test, type Page } from "@playwright/test";

const email = process.env.SEED_ADMIN_EMAIL ?? "admin@cutz.local";
const password = process.env.SEED_ADMIN_PASSWORD ?? "cutz-dev-password";

async function openHistoricalAgenda(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin\/b\/demo\/agenda$/);
  await page.getByLabel("Data da agenda").fill("2026-09-01");
  await page.getByRole("button", { name: "Atualizar" }).click();
  await expect(page).toHaveURL(/date=2026-09-01/);
}

test("records and corrects a service after the original appointment is completed", async ({ page }) => {
  await openHistoricalAgenda(page);
  const appointment = page.locator("article").filter({ hasText: "E2E Complete" });
  if (await appointment.getByRole("button", { name: "Concluir" }).count()) {
    await appointment.getByRole("button", { name: "Concluir" }).click();
  }
  await expect(appointment.getByText("Concluído")).toBeVisible();

  await appointment.getByRole("button", { name: "Ver atendimento" }).click();
  const panel = appointment.locator('[aria-label="Serviços do atendimento"]');
  await expect(panel.getByText("Serviços do atendimento")).toBeVisible();
  await expect(panel.getByText("Corte")).toBeVisible();

  await panel.getByLabel("Serviço").selectOption({ label: "Barba" });
  await panel.getByLabel("Valor aplicado (R$)").fill("25,00");
  await panel.getByRole("button", { name: "Registrar serviço" }).click();
  await expect(panel.getByText("Adicional")).toBeVisible();
  await expect(panel.getByText(/R\$\s*25,00/).first()).toBeVisible();

  await panel.getByRole("button", { name: "Anular" }).click();
  await panel.getByLabel("Motivo da anulação").fill("Lançamento de teste");
  await panel.getByRole("button", { name: "Confirmar anulação" }).click();
  await expect(panel.getByText("Anulado")).toBeVisible();
  await expect(panel.getByText("Motivo da anulação: Lançamento de teste")).toBeVisible();
});

test("keeps no-show appointments read-only", async ({ page }) => {
  await openHistoricalAgenda(page);
  const appointment = page.locator("article").filter({ hasText: "E2E No-show" });
  if (await appointment.getByRole("button", { name: "No-show" }).count()) {
    await appointment.getByRole("button", { name: "No-show" }).click();
  }
  await appointment.getByRole("button", { name: "Ver atendimento" }).click();
  const panel = appointment.locator('[aria-label="Serviços do atendimento"]');
  await expect(panel.getByText("Não é possível registrar serviços neste atendimento.")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Registrar serviço" })).toHaveCount(0);
});
