import type { DbExecutor } from "@/infrastructure/db/executor";
import {
  findAdminWaitlistEntry,
  listAdminWaitlistRows,
  lockAdminWaitlistEntry,
} from "./admin.repository";

export function listAdminWaitlistEntries(executor: DbExecutor, barbershopId: string) {
  return listAdminWaitlistRows(executor, barbershopId);
}

export function getAdminWaitlistEntry(executor: DbExecutor, barbershopId: string, entryId: string) {
  return findAdminWaitlistEntry(executor, barbershopId, entryId);
}

export function lockAdminWaitlistEntryForUpdate(
  executor: DbExecutor,
  barbershopId: string,
  entryId: string,
) {
  return lockAdminWaitlistEntry(executor, barbershopId, entryId);
}
