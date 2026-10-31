import type { Locator } from "@playwright/test";

export async function chooseService(container: Locator, name: string) {
  await container.getByRole("radio", { name, exact: true }).check();
}

export async function chooseStaff(container: Locator, name: string) {
  await container.getByRole("radio", { name, exact: true }).check();
}
