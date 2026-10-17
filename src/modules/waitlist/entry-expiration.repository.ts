import { and, asc, eq, notExists } from "drizzle-orm";
import type { DbExecutor } from "@/infrastructure/db/executor";
import { waitlistEntries, waitlistOffers } from "@/infrastructure/db/schema";

export function findActiveEntryExpirationCandidates(executor: DbExecutor, limit: number) {
  const pendingOffer = executor
    .select({ id: waitlistOffers.id })
    .from(waitlistOffers)
    .where(
      and(
        eq(waitlistOffers.waitlistEntryId, waitlistEntries.id),
        eq(waitlistOffers.status, "PENDING"),
      ),
    );

  return executor
    .select({
      id: waitlistEntries.id,
      barbershopId: waitlistEntries.barbershopId,
      desiredDate: waitlistEntries.desiredDate,
      latestTime: waitlistEntries.latestTime,
    })
    .from(waitlistEntries)
    .where(and(eq(waitlistEntries.status, "ACTIVE"), notExists(pendingOffer)))
    .orderBy(
      asc(waitlistEntries.desiredDate),
      asc(waitlistEntries.latestTime),
      asc(waitlistEntries.createdAt),
      asc(waitlistEntries.id),
    )
    .limit(limit);
}
