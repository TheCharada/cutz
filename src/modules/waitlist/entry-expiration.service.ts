import type { DbExecutor } from "@/infrastructure/db/executor";
import { findActiveEntryExpirationCandidates } from "./entry-expiration.repository";
import { updateEntryStatus } from "./waitlist.repository";

export function listWaitlistEntryExpirationCandidates(
  executor: DbExecutor,
  limit = 100,
) {
  return findActiveEntryExpirationCandidates(executor, limit);
}

export function expireWaitlistEntry(executor: DbExecutor, entryId: string, now: Date) {
  return updateEntryStatus(executor, {
    entryId,
    from: "ACTIVE",
    to: "EXPIRED",
    now,
  });
}
