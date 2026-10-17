import { getDb, type Database } from "@/infrastructure/db/client";
import { resolveBarbershopById } from "@/modules/barbershops";
import { lockStaffMembersForUpdate } from "@/modules/catalog";
import {
  expireWaitlistOffer,
  listExpiredPendingOffers,
  lockWaitlistOfferById,
} from "@/modules/waitlist";
import { SystemClock, type Clock } from "@/shared/clock";
import { reserveNextWaitlistOfferForOpportunity } from "./waitlist-opportunity";

const systemClock = new SystemClock();

export async function processExpiredWaitlistOffers(
  options: {
    database?: Database;
    clock?: Clock;
    appOrigin?: string;
    limit?: number;
  } = {},
) {
  const database = options.database ?? getDb();
  const now = (options.clock ?? systemClock).now();
  const appOrigin = options.appOrigin ?? process.env.APP_ORIGIN;
  if (!appOrigin) throw new Error("APP_ORIGIN is required for waitlist capability links");

  const candidates = await listExpiredPendingOffers(database, now, options.limit ?? 25);
  let processed = 0;

  for (const candidate of candidates) {
    const changed = await database.transaction(async (tx) => {
      await lockStaffMembersForUpdate(tx, candidate.barbershopId, [candidate.staffId]);
      const offer = await lockWaitlistOfferById(tx, candidate.id);
      if (!offer || offer.status !== "PENDING" || offer.expiresAt > now) return false;

      const expired = await expireWaitlistOffer(tx, offer.id, now);
      if (!expired) return false;
      const barbershop = await resolveBarbershopById(tx, offer.barbershopId);
      if (!barbershop) throw new Error("WaitlistOffer references missing Barbershop");

      await reserveNextWaitlistOfferForOpportunity(tx, {
        barbershop,
        staffId: offer.staffId,
        opportunityId: offer.opportunityId,
        opportunityStartsAt: offer.opportunityStartsAt,
        opportunityEndsAt: offer.opportunityEndsAt,
        now,
        appOrigin,
      });
      return true;
    });

    if (changed) processed += 1;
  }

  return { scanned: candidates.length, processed };
}
