import { and, eq, gte, lt } from "drizzle-orm";
import type { DbExecutor } from "@/infrastructure/db/executor";
import { appointments, waitlistOffers } from "@/infrastructure/db/schema";

export async function listAppointmentsForAnalytics(
  executor: DbExecutor,
  params: { barbershopId: string; startsAt: Date; endsAt: Date },
) {
  return executor
    .select({
      id: appointments.id,
      startsAt: appointments.startsAt,
      status: appointments.status,
      cancellationKind: appointments.cancellationKind,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.barbershopId, params.barbershopId),
        gte(appointments.startsAt, params.startsAt),
        lt(appointments.startsAt, params.endsAt),
      ),
    );
}

export async function listWaitlistOffersForAnalytics(
  executor: DbExecutor,
  params: { barbershopId: string; startsAt: Date; endsAt: Date },
) {
  return executor
    .select({
      id: waitlistOffers.id,
      opportunityId: waitlistOffers.opportunityId,
      opportunityStartsAt: waitlistOffers.opportunityStartsAt,
      status: waitlistOffers.status,
    })
    .from(waitlistOffers)
    .where(
      and(
        eq(waitlistOffers.barbershopId, params.barbershopId),
        gte(waitlistOffers.opportunityStartsAt, params.startsAt),
        lt(waitlistOffers.opportunityStartsAt, params.endsAt),
      ),
    );
}
