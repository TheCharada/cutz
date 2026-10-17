import type { DbExecutor } from "@/infrastructure/db/executor";
import { findExpiredPendingOfferIds } from "./expiration.repository";

export function listExpiredPendingOffers(executor: DbExecutor, now: Date, limit = 25) {
  return findExpiredPendingOfferIds(executor, now, limit);
}
