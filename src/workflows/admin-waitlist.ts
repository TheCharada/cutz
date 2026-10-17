import { getDb, type Database } from "@/infrastructure/db/client";
import type { BarbershopContext } from "@/modules/barbershops";
import {
  getActiveBookingService,
  getStaffSnapshot,
  lockStaffMembersForUpdate,
  staffPerformsService,
} from "@/modules/catalog";
import { getCustomerIdentity } from "@/modules/customers";
import { enqueueWaitlistEntryCreatedNotification } from "@/modules/notifications";
import {
  cancelWaitlistEntry,
  createWaitlistEntry,
  getAdminWaitlistEntry,
  getPendingOfferForEntry,
  listAdminWaitlistEntries,
  lockAdminWaitlistEntryForUpdate,
  lockWaitlistOfferById,
  rejectWaitlistOffer,
} from "@/modules/waitlist";
import { SystemClock, type Clock } from "@/shared/clock";
import { createOpaqueToken, hashOpaqueToken } from "@/shared/tokens";
import { localDateForInstant, localDateTimeToInstant } from "@/shared/time";
import { reserveNextWaitlistOfferForOpportunity } from "./waitlist-opportunity";

const systemClock = new SystemClock();

export function listAdminWaitlist(
  barbershopId: string,
  options: { database?: Database } = {},
) {
  return listAdminWaitlistEntries(options.database ?? getDb(), barbershopId);
}

export async function createAdminWaitlistEntry(
  params: {
    barbershop: BarbershopContext;
    customerId: string;
    serviceId: string;
    staffId?: string;
    desiredDate: string;
    earliestTime: string;
    latestTime: string;
  },
  options: { database?: Database; clock?: Clock; appOrigin?: string } = {},
) {
  const database = options.database ?? getDb();
  const now = (options.clock ?? systemClock).now();
  const appOrigin = options.appOrigin ?? process.env.APP_ORIGIN;
  if (!appOrigin) throw new Error("APP_ORIGIN is required for waitlist capability links");

  return database.transaction(async (tx) => {
    const customer = await getCustomerIdentity(tx, params.barbershop.id, params.customerId);
    if (!customer) return { status: "customer-not-found" as const };

    const service = await getActiveBookingService(tx, params.barbershop.id, params.serviceId);
    if (!service) return { status: "service-not-found" as const };

    let staff: Awaited<ReturnType<typeof getStaffSnapshot>> | null = null;
    if (params.staffId) {
      staff = await getStaffSnapshot(tx, params.barbershop.id, params.staffId);
      if (!staff || !staff.active || !staff.acceptsAppointments) {
        return { status: "staff-not-found" as const };
      }
      if (!(await staffPerformsService(tx, params.barbershop.id, staff.id, service.id))) {
        return { status: "staff-not-found" as const };
      }
    }

    const today = localDateForInstant(now, params.barbershop.timezone);
    const windowEndsAt = localDateTimeToInstant(
      params.desiredDate,
      params.latestTime,
      params.barbershop.timezone,
    );
    if (params.desiredDate < today || windowEndsAt <= now) {
      return { status: "invalid-window" as const };
    }

    const managementToken = createOpaqueToken();
    const entry = await createWaitlistEntry(tx, {
      barbershopId: params.barbershop.id,
      customerId: customer.id,
      serviceId: service.id,
      staffId: staff?.id,
      desiredDate: params.desiredDate,
      earliestTime: params.earliestTime,
      latestTime: params.latestTime,
      managementTokenHash: hashOpaqueToken(managementToken),
    });
    const managementUrl = `${appOrigin.replace(/\/$/, "")}/w/${managementToken}`;

    await enqueueWaitlistEntryCreatedNotification(tx, {
      barbershopId: params.barbershop.id,
      waitlistEntryId: entry.id,
      phoneE164: customer.phoneE164,
      now,
      payload: {
        type: "WAITLIST_ENTRY_CREATED",
        waitlistEntryId: entry.id,
        customerName: customer.name,
        serviceName: service.name,
        desiredDate: entry.desiredDate,
        earliestTime: entry.earliestTime,
        latestTime: entry.latestTime,
        managementUrl,
      },
    });

    return { status: "ok" as const, entry, managementUrl };
  });
}

export async function cancelAdminWaitlistEntry(
  params: { barbershop: BarbershopContext; entryId: string },
  options: { database?: Database; clock?: Clock; appOrigin?: string } = {},
) {
  const database = options.database ?? getDb();
  const now = (options.clock ?? systemClock).now();
  const appOrigin = options.appOrigin ?? process.env.APP_ORIGIN;
  if (!appOrigin) throw new Error("APP_ORIGIN is required for waitlist capability links");

  const visible = await getAdminWaitlistEntry(database, params.barbershop.id, params.entryId);
  if (!visible) return { status: "not-found" as const };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const visibleOffer = await getPendingOfferForEntry(database, visible.id);
    const result = await database.transaction(async (tx) => {
      let lockedOffer: Awaited<ReturnType<typeof lockWaitlistOfferById>> | null = null;
      if (visibleOffer) {
        await lockStaffMembersForUpdate(tx, params.barbershop.id, [visibleOffer.staffId]);
        lockedOffer = await lockWaitlistOfferById(tx, visibleOffer.id);
      }

      const entry = await lockAdminWaitlistEntryForUpdate(tx, params.barbershop.id, params.entryId);
      if (!entry) return { status: "not-found" as const };
      if (entry.status === "CANCELLED") {
        return { status: "ok" as const, changed: false, entry };
      }
      if (entry.status !== "ACTIVE") return { status: "entry-conflict" as const };

      const currentPendingOffer = await getPendingOfferForEntry(tx, entry.id);
      if (currentPendingOffer && currentPendingOffer.id !== lockedOffer?.id) {
        return { status: "retry-with-offer" as const };
      }

      const cancelled = await cancelWaitlistEntry(tx, entry.id, now);
      if (!cancelled) return { status: "entry-conflict" as const };

      if (lockedOffer?.status === "PENDING") {
        const rejected = await rejectWaitlistOffer(tx, lockedOffer.id, now);
        if (rejected) {
          await reserveNextWaitlistOfferForOpportunity(tx, {
            barbershop: params.barbershop,
            staffId: rejected.staffId,
            opportunityId: rejected.opportunityId,
            opportunityStartsAt: rejected.opportunityStartsAt,
            opportunityEndsAt: rejected.opportunityEndsAt,
            now,
            appOrigin,
          });
        }
      }

      return { status: "ok" as const, changed: true, entry: cancelled };
    });

    if (result.status === "retry-with-offer") continue;
    return result;
  }

  throw new Error("Admin WaitlistEntry cancellation could not stabilize pending offer state");
}
