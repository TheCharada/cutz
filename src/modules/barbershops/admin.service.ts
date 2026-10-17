import type { DbExecutor } from "@/infrastructure/db/executor";
import { findAdminBarbershopSettings, updateAdminBarbershopSettings } from "./admin.repository";

export function getAdminBarbershopSettings(executor: DbExecutor, barbershopId: string) {
  return findAdminBarbershopSettings(executor, barbershopId);
}

export function patchAdminBarbershopSettings(
  executor: DbExecutor,
  params: Parameters<typeof updateAdminBarbershopSettings>[1],
) {
  return updateAdminBarbershopSettings(executor, params);
}
