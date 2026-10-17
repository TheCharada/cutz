import { and, asc, eq, isNull, lt, lte, or } from "drizzle-orm";
import type { DbExecutor } from "@/infrastructure/db/executor";
import { waitlistEntries, waitlistOffers } from "@/infrastructure/db/schema";

const entrySelection = {
  id: waitlistEntries.id,
  barbershopId: waitlistEntries.barbershopId,
  customerId: waitlistEntries.customerId,
  serviceId: waitlistEntries.serviceId,
  staffId: waitlistEntries.staffId,
  desiredDate: waitlistEntries.desiredDate,
  earliestTime: waitlistEntries.earliestTime,
  latestTime: waitlistEntries.latestTime,
  status: waitlistEntries.status,
  createdAt: waitlistEntries.createdAt,
  updatedAt: waitlistEntries.updatedAt,
};

const offerSelection = {
  id: waitlistOffers.id,
  barbershopId: waitlistOffers.barbershopId,
  waitlistEntryId: waitlistOffers.waitlistEntryId,
  staffId: waitlistOffers.staffId,
  startsAt: waitlistOffers.startsAt,
  endsAt: waitlistOffers.endsAt,
  status: waitlistOffers.status,
  expiresAt: waitlistOffers.expiresAt,
  appointmentId: waitlistOffers.appointmentId,
  opportunityId: waitlistOffers.opportunityId,
  opportunityStartsAt: waitlistOffers.opportunityStartsAt,
  opportunityEndsAt: waitlistOffers.opportunityEndsAt,
  createdAt: waitlistOffers.createdAt,
  respondedAt: waitlistOffers.respondedAt,
};

export function insertWaitlistEntry(
  executor: DbExecutor,
  params: {
    barbershopId: string;
    customerId: string;
    serviceId: string;
    staffId?: string;
    desiredDate: string;
    earliestTime: string;
    latestTime: string;
    managementTokenHash: string;
  },
) {
  return executor
    .insert(waitlistEntries)
    .values({ ...params, staffId: params.staffId ?? null })
    .returning(entrySelection)
    .then((rows) => rows[0]);
}

export async function findEntryByManagementTokenHash(executor: DbExecutor, tokenHash: string) {
  const [row] = await executor
    .select(entrySelection)
    .from(waitlistEntries)
    .where(eq(waitlistEntries.managementTokenHash, tokenHash))
    .limit(1);
  return row ?? null;
}

export async function lockEntryByManagementTokenHash(executor: DbExecutor, tokenHash: string) {
  const [row] = await executor
    .select(entrySelection)
    .from(waitlistEntries)
    .where(eq(waitlistEntries.managementTokenHash, tokenHash))
    .limit(1)
    .for("update");
  return row ?? null;
}

export async function lockEntryById(executor: DbExecutor, entryId: string) {
  const [row] = await executor
    .select(entrySelection)
    .from(waitlistEntries)
    .where(eq(waitlistEntries.id, entryId))
    .limit(1)
    .for("update");
  return row ?? null;
}

export function listActiveEntriesForOpportunity(
  executor: DbExecutor,
  params: { barbershopId: string; desiredDate: string; staffId: string },
) {
  return executor
    .select(entrySelection)
    .from(waitlistEntries)
    .where(
      and(
        eq(waitlistEntries.barbershopId, params.barbershopId),
        eq(waitlistEntries.status, "ACTIVE"),
        eq(waitlistEntries.desiredDate, params.desiredDate),
        or(eq(waitlistEntries.staffId, params.staffId), isNull(waitlistEntries.staffId)),
      ),
    )
    .orderBy(asc(waitlistEntries.createdAt), asc(waitlistEntries.id));
}

export function listOfferedEntryIds(executor: DbExecutor, opportunityId: string) {
  return executor
    .select({ waitlistEntryId: waitlistOffers.waitlistEntryId })
    .from(waitlistOffers)
    .where(eq(waitlistOffers.opportunityId, opportunityId));
}

export async function findPendingOfferForEntry(executor: DbExecutor, entryId: string) {
  const [row] = await executor
    .select(offerSelection)
    .from(waitlistOffers)
    .where(and(eq(waitlistOffers.waitlistEntryId, entryId), eq(waitlistOffers.status, "PENDING")))
    .limit(1);
  return row ?? null;
}

export async function findOfferById(
  executor: DbExecutor,
  barbershopId: string,
  offerId: string,
) {
  const [row] = await executor
    .select(offerSelection)
    .from(waitlistOffers)
    .where(and(eq(waitlistOffers.barbershopId, barbershopId), eq(waitlistOffers.id, offerId)))
    .limit(1);
  return row ?? null;
}

export async function findOfferByActionTokenHash(executor: DbExecutor, tokenHash: string) {
  const [row] = await executor
    .select(offerSelection)
    .from(waitlistOffers)
    .where(eq(waitlistOffers.actionTokenHash, tokenHash))
    .limit(1);
  return row ?? null;
}

export async function lockOfferByActionTokenHash(executor: DbExecutor, tokenHash: string) {
  const [row] = await executor
    .select(offerSelection)
    .from(waitlistOffers)
    .where(eq(waitlistOffers.actionTokenHash, tokenHash))
    .limit(1)
    .for("update");
  return row ?? null;
}

export async function lockOfferById(executor: DbExecutor, offerId: string) {
  const [row] = await executor
    .select(offerSelection)
    .from(waitlistOffers)
    .where(eq(waitlistOffers.id, offerId))
    .limit(1)
    .for("update");
  return row ?? null;
}

export function insertWaitlistOffer(
  executor: DbExecutor,
  params: {
    barbershopId: string;
    waitlistEntryId: string;
    staffId: string;
    startsAt: Date;
    endsAt: Date;
    expiresAt: Date;
    actionTokenHash: string;
    opportunityId: string;
    opportunityStartsAt: Date;
    opportunityEndsAt: Date;
    createdAt: Date;
  },
) {
  return executor
    .insert(waitlistOffers)
    .values(params)
    .returning(offerSelection)
    .then((rows) => rows[0]);
}

export function updateEntryStatus(
  executor: DbExecutor,
  params: {
    entryId: string;
    from: "ACTIVE";
    to: "FULFILLED" | "CANCELLED" | "EXPIRED";
    now: Date;
  },
) {
  return executor
    .update(waitlistEntries)
    .set({ status: params.to, updatedAt: params.now })
    .where(and(eq(waitlistEntries.id, params.entryId), eq(waitlistEntries.status, params.from)))
    .returning(entrySelection)
    .then((rows) => rows[0] ?? null);
}

export function updateOfferStatus(
  executor: DbExecutor,
  params: {
    offerId: string;
    from: "PENDING";
    to: "ACCEPTED" | "REJECTED" | "EXPIRED";
    now: Date;
    appointmentId?: string;
  },
) {
  return executor
    .update(waitlistOffers)
    .set({
      status: params.to,
      respondedAt: params.now,
      appointmentId: params.appointmentId ?? null,
    })
    .where(and(eq(waitlistOffers.id, params.offerId), eq(waitlistOffers.status, params.from)))
    .returning(offerSelection)
    .then((rows) => rows[0] ?? null);
}

export function listExpiredPendingOfferCandidates(executor: DbExecutor, now: Date, limit: number) {
  return executor
    .select({ id: waitlistOffers.id, staffId: waitlistOffers.staffId })
    .from(waitlistOffers)
    .where(and(eq(waitlistOffers.status, "PENDING"), lte(waitlistOffers.expiresAt, now)))
    .orderBy(asc(waitlistOffers.expiresAt), asc(waitlistOffers.id))
    .limit(limit);
}

export function expireOldActiveEntries(executor: DbExecutor, beforeDate: string, now: Date) {
  return executor
    .update(waitlistEntries)
    .set({ status: "EXPIRED", updatedAt: now })
    .where(and(eq(waitlistEntries.status, "ACTIVE"), lt(waitlistEntries.desiredDate, beforeDate)))
    .returning({ id: waitlistEntries.id });
}
