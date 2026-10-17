import type { DbExecutor } from "@/infrastructure/db/executor";
import {
  findEntryByManagementTokenHash,
  findOfferByActionTokenHash,
  findOfferById,
  findPendingOfferForEntry,
  insertWaitlistEntry,
  insertWaitlistOffer,
  listActiveEntriesForOpportunity,
  listOfferedEntryIds,
  lockEntryById,
  lockEntryByManagementTokenHash,
  lockOfferByActionTokenHash,
  lockOfferById,
  updateEntryStatus,
  updateOfferStatus,
} from "./waitlist.repository";

export function createWaitlistEntry(
  executor: DbExecutor,
  params: Parameters<typeof insertWaitlistEntry>[1],
) {
  return insertWaitlistEntry(executor, params);
}

export function getWaitlistEntryByManagementTokenHash(executor: DbExecutor, tokenHash: string) {
  return findEntryByManagementTokenHash(executor, tokenHash);
}

export function lockWaitlistEntryByManagementTokenHash(executor: DbExecutor, tokenHash: string) {
  return lockEntryByManagementTokenHash(executor, tokenHash);
}

export function lockWaitlistEntryById(executor: DbExecutor, entryId: string) {
  return lockEntryById(executor, entryId);
}

export function listWaitlistCandidates(
  executor: DbExecutor,
  params: Parameters<typeof listActiveEntriesForOpportunity>[1],
) {
  return listActiveEntriesForOpportunity(executor, params);
}

export async function getAlreadyOfferedEntryIds(executor: DbExecutor, opportunityId: string) {
  const rows = await listOfferedEntryIds(executor, opportunityId);
  return new Set(rows.map((row) => row.waitlistEntryId));
}

export function getPendingOfferForEntry(executor: DbExecutor, entryId: string) {
  return findPendingOfferForEntry(executor, entryId);
}

export function getWaitlistOfferById(executor: DbExecutor, barbershopId: string, offerId: string) {
  return findOfferById(executor, barbershopId, offerId);
}

export function getWaitlistOfferByActionTokenHash(executor: DbExecutor, tokenHash: string) {
  return findOfferByActionTokenHash(executor, tokenHash);
}

export function lockWaitlistOfferByActionTokenHash(executor: DbExecutor, tokenHash: string) {
  return lockOfferByActionTokenHash(executor, tokenHash);
}

export function lockWaitlistOfferById(executor: DbExecutor, offerId: string) {
  return lockOfferById(executor, offerId);
}

export function createWaitlistOffer(
  executor: DbExecutor,
  params: Parameters<typeof insertWaitlistOffer>[1],
) {
  return insertWaitlistOffer(executor, params);
}

export function fulfillWaitlistEntry(executor: DbExecutor, entryId: string, now: Date) {
  return updateEntryStatus(executor, { entryId, from: "ACTIVE", to: "FULFILLED", now });
}

export function cancelWaitlistEntry(executor: DbExecutor, entryId: string, now: Date) {
  return updateEntryStatus(executor, { entryId, from: "ACTIVE", to: "CANCELLED", now });
}

export function acceptWaitlistOffer(
  executor: DbExecutor,
  offerId: string,
  appointmentId: string,
  now: Date,
) {
  return updateOfferStatus(executor, {
    offerId,
    from: "PENDING",
    to: "ACCEPTED",
    now,
    appointmentId,
  });
}

export function rejectWaitlistOffer(executor: DbExecutor, offerId: string, now: Date) {
  return updateOfferStatus(executor, { offerId, from: "PENDING", to: "REJECTED", now });
}

export function expireWaitlistOffer(executor: DbExecutor, offerId: string, now: Date) {
  return updateOfferStatus(executor, { offerId, from: "PENDING", to: "EXPIRED", now });
}
