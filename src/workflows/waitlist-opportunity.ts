import type { DbExecutor } from "@/infrastructure/db/executor";
import type { BarbershopContext } from "@/modules/barbershops";
import {
  getActiveBookingService,
  getCatalogAvailabilityInput,
  getStaffSnapshot,
  staffPerformsService,
} from "@/modules/catalog";
import { getCustomerIdentity } from "@/modules/customers";
import { enqueueWaitlistOfferNotification } from "@/modules/notifications";
import { getAvailability, listScheduledAppointmentBlocks } from "@/modules/scheduling";
import {
  createWaitlistOffer,
  getAlreadyOfferedEntryIds,
  getPendingOfferForEntry,
  listPendingOfferBlocks,
  listWaitlistCandidates,
  lockWaitlistEntryById,
} from "@/modules/waitlist";
import { createOpaqueToken, hashOpaqueToken } from "@/shared/tokens";
import {
  localDateBounds,
  localDateForInstant,
  localDateTimeToInstant,
  weekdayForLocalDate,
} from "@/shared/time";

export async function reserveNextWaitlistOfferForOpportunity(
  executor: DbExecutor,
  params: {
    barbershop: BarbershopContext;
    staffId: string;
    opportunityId: string;
    opportunityStartsAt: Date;
    opportunityEndsAt: Date;
    now: Date;
    appOrigin: string;
    createActionToken?: () => string;
  },
) {
  const date = localDateForInstant(params.opportunityStartsAt, params.barbershop.timezone);
  const range = localDateBounds(date, params.barbershop.timezone);
  const alreadyOffered = await getAlreadyOfferedEntryIds(executor, params.opportunityId);
  const candidates = await listWaitlistCandidates(executor, {
    barbershopId: params.barbershop.id,
    desiredDate: date,
    staffId: params.staffId,
  });

  for (const visibleEntry of candidates) {
    if (alreadyOffered.has(visibleEntry.id)) continue;
    if (await getPendingOfferForEntry(executor, visibleEntry.id)) continue;

    const entry = await lockWaitlistEntryById(executor, visibleEntry.id);
    if (!entry || entry.status !== "ACTIVE") continue;
    if (await getPendingOfferForEntry(executor, entry.id)) continue;

    const service = await getActiveBookingService(executor, params.barbershop.id, entry.serviceId);
    if (!service) continue;
    if (!(await staffPerformsService(executor, params.barbershop.id, params.staffId, service.id))) {
      continue;
    }

    const earliest = localDateTimeToInstant(date, entry.earliestTime, params.barbershop.timezone);
    const latest = localDateTimeToInstant(date, entry.latestTime, params.barbershop.timezone);
    const catalog = await getCatalogAvailabilityInput(executor, {
      barbershopId: params.barbershop.id,
      serviceId: service.id,
      staffId: params.staffId,
      weekday: weekdayForLocalDate(date),
      rangeStartsAt: range.startsAt,
      rangeEndsAt: range.endsAt,
    });
    if (!catalog || catalog.staff.length !== 1) continue;

    const appointmentBlocks = await listScheduledAppointmentBlocks(executor, {
      barbershopId: params.barbershop.id,
      staffIds: [params.staffId],
      rangeStartsAt: range.startsAt,
      rangeEndsAt: range.endsAt,
    });
    const offerBlocks = await listPendingOfferBlocks(executor, {
      barbershopId: params.barbershop.id,
      staffIds: [params.staffId],
      rangeStartsAt: range.startsAt,
      rangeEndsAt: range.endsAt,
    });
    const staffInput = catalog.staff[0];
    const slots = getAvailability({
      date,
      timezone: params.barbershop.timezone,
      bookingIntervalMinutes: params.barbershop.bookingIntervalMinutes,
      serviceDurationMinutes: service.durationMinutes,
      now: params.now,
      externalBlocks: offerBlocks,
      staff: [
        {
          staffId: params.staffId,
          workingHours: staffInput.workingHours,
          timeOff: staffInput.timeOff,
          appointments: appointmentBlocks.map((block) => ({
            startsAt: block.startsAt,
            endsAt: block.endsAt,
          })),
        },
      ],
    });
    const slot = slots.find((candidate) => {
      const startsAt = new Date(candidate.startsAt);
      const endsAt = new Date(candidate.endsAt);
      return (
        startsAt > params.now &&
        startsAt >= params.opportunityStartsAt &&
        endsAt <= params.opportunityEndsAt &&
        startsAt >= earliest &&
        endsAt <= latest
      );
    });
    if (!slot) continue;

    const offeredStartsAt = new Date(slot.startsAt);
    const offeredEndsAt = new Date(slot.endsAt);
    const customer = await getCustomerIdentity(executor, params.barbershop.id, entry.customerId);
    const staff = await getStaffSnapshot(executor, params.barbershop.id, params.staffId);
    if (!customer || !staff) continue;

    const actionToken = (params.createActionToken ?? createOpaqueToken)();
    const ttlExpiresAt = params.now.getTime() + params.barbershop.waitlistOfferTtlMinutes * 60_000;
    const expiresAt = new Date(Math.min(ttlExpiresAt, offeredStartsAt.getTime()));
    const offer = await createWaitlistOffer(executor, {
      barbershopId: params.barbershop.id,
      waitlistEntryId: entry.id,
      staffId: params.staffId,
      startsAt: offeredStartsAt,
      endsAt: offeredEndsAt,
      expiresAt,
      actionTokenHash: hashOpaqueToken(actionToken),
      opportunityId: params.opportunityId,
      opportunityStartsAt: params.opportunityStartsAt,
      opportunityEndsAt: params.opportunityEndsAt,
      createdAt: params.now,
    });
    const actionUrl = `${params.appOrigin.replace(/\/$/, "")}/o/${actionToken}`;

    await enqueueWaitlistOfferNotification(executor, {
      barbershopId: params.barbershop.id,
      waitlistEntryId: entry.id,
      waitlistOfferId: offer.id,
      phoneE164: customer.phoneE164,
      now: params.now,
      payload: {
        type: "WAITLIST_OFFER",
        waitlistOfferId: offer.id,
        customerName: customer.name,
        serviceName: service.name,
        staffName: staff.name,
        startsAt: offeredStartsAt.toISOString(),
        endsAt: offeredEndsAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        actionUrl,
      },
    });

    return { status: "offered" as const, offer, actionUrl };
  }

  return { status: "no-candidate" as const };
}
