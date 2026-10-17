import type { DbExecutor } from "@/infrastructure/db/executor";
import { findWaitlistEntryById } from "./entry-read.repository";

export function getWaitlistEntryById(
  executor: DbExecutor,
  barbershopId: string,
  entryId: string,
) {
  return findWaitlistEntryById(executor, barbershopId, entryId);
}
