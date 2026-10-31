import type { Locator } from "@playwright/test";

export async function chooseService(select: Locator, name: string) {
  const value = await select.locator("option").filter({
    hasText: `${name} · `,
  }).first().getAttribute("value");
  if (!value) throw new Error(`Serviço "${name}" não encontrado`);
  await select.selectOption(value);
}
