import { and, asc, eq, lte } from "drizzle-orm";
import type { DbExecutor } from "@/infrastructure/db/executor";
import { waitlistOffers } from "@/infrastructure/db/schema";

export function findExpiredPendingOfferIds(executor: DbExecutor, now: Date, limit: number) {
  return executor
    .select({
      id: waitlistOffers.id,
      barbershopId: waitlistOffers.barbershopId,
      staffId: waitlistOffers.staffId,
    })
    .from(waitlistOffers)
    .where(and(eq(waitlistOffers.status, "PENDING"), lte(waitlistOffers.expiresAt, now)))
    .orderBy(asc(waitlistOffers.expiresAt), asc(waitlistOffers.id))
    .limit(limit);
}
