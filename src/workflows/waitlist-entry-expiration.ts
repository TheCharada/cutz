import { getDb, type Database } from "@/infrastructure/db/client";
import { resolveBarbershopById } from "@/modules/barbershops";
import {
  expireWaitlistEntry,
  getPendingOfferForEntry,
  listWaitlistEntryExpirationCandidates,
  lockWaitlistEntryById,
} from "@/modules/waitlist";
import { SystemClock, type Clock } from "@/shared/clock";
import { localDateTimeToInstant } from "@/shared/time";

const systemClock = new SystemClock();

export async function processExpiredWaitlistEntries(
  options: { database?: Database; clock?: Clock; limit?: number } = {},
) {
  const database = options.database ?? getDb();
  const now = (options.clock ?? systemClock).now();
  const candidates = await listWaitlistEntryExpirationCandidates(
    database,
    options.limit ?? 100,
  );
  let processed = 0;

  for (const candidate of candidates) {
    const changed = await database.transaction(async (tx) => {
      const entry = await lockWaitlistEntryById(tx, candidate.id);
      if (!entry || entry.status !== "ACTIVE") return false;

      const pendingOffer = await getPendingOfferForEntry(tx, entry.id);
      if (pendingOffer) return false;

      const barbershop = await resolveBarbershopById(tx, entry.barbershopId);
      if (!barbershop) throw new Error("WaitlistEntry references missing Barbershop");
      const windowEndsAt = localDateTimeToInstant(
        entry.desiredDate,
        entry.latestTime,
        barbershop.timezone,
      );
      if (windowEndsAt > now) return false;

      return Boolean(await expireWaitlistEntry(tx, entry.id, now));
    });

    if (changed) processed += 1;
  }

  return { scanned: candidates.length, processed };
}
