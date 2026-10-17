import { and, asc, eq, gt, inArray, lt, ne } from "drizzle-orm";
import type { DbExecutor } from "@/infrastructure/db/executor";
import { waitlistOffers } from "@/infrastructure/db/schema";

export async function findPendingOfferBlocks(
  executor: DbExecutor,
  params: {
    barbershopId: string;
    staffIds: string[];
    rangeStartsAt: Date;
    rangeEndsAt: Date;
    excludeOfferId?: string;
  },
) {
  if (params.staffIds.length === 0) {
    return [];
  }

  const conditions = [
    eq(waitlistOffers.barbershopId, params.barbershopId),
    eq(waitlistOffers.status, "PENDING"),
    inArray(waitlistOffers.staffId, params.staffIds),
    lt(waitlistOffers.startsAt, params.rangeEndsAt),
    gt(waitlistOffers.endsAt, params.rangeStartsAt),
  ];

  if (params.excludeOfferId) {
    conditions.push(ne(waitlistOffers.id, params.excludeOfferId));
  }

  return executor
    .select({
      staffId: waitlistOffers.staffId,
      startsAt: waitlistOffers.startsAt,
      endsAt: waitlistOffers.endsAt,
    })
    .from(waitlistOffers)
    .where(and(...conditions))
    .orderBy(asc(waitlistOffers.staffId), asc(waitlistOffers.startsAt));
}
