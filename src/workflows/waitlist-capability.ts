import { getDb, type Database } from "@/infrastructure/db/client";
import { resolveBarbershopById } from "@/modules/barbershops";
import {
  getActiveBookingService,
  getCatalogAvailabilityInput,
  getServiceSnapshot,
  getStaffSnapshot,
  lockStaffMembersForUpdate,
} from "@/modules/catalog";
import { getCustomerIdentity } from "@/modules/customers";
import { enqueueAppointmentNotifications } from "@/modules/notifications";
import {
  createAppointmentInTransaction,
  getAvailability,
  listScheduledAppointmentBlocks,
} from "@/modules/scheduling";
import {
  acceptWaitlistOffer,
  cancelWaitlistEntry,
  fulfillWaitlistEntry,
  getPendingOfferForEntry,
  getWaitlistEntryById,
  getWaitlistEntryByManagementTokenHash,
  getWaitlistOfferByActionTokenHash,
  listPendingOfferBlocks,
  lockWaitlistEntryById,
  lockWaitlistEntryByManagementTokenHash,
  lockWaitlistOfferByActionTokenHash,
  lockWaitlistOfferById,
  rejectWaitlistOffer,
} from "@/modules/waitlist";
import { SystemClock, type Clock } from "@/shared/clock";
import { createOpaqueToken, hashOpaqueToken } from "@/shared/tokens";
import { localDateBounds, localDateForInstant, weekdayForLocalDate } from "@/shared/time";
import { reserveNextWaitlistOfferForOpportunity } from "./waitlist-opportunity";

const systemClock = new SystemClock();

type PgError = Error & { code?: string; constraint?: string };
type ErrorWithCause = Error & { cause?: unknown };

function asPgError(error: unknown): PgError | null {
  if (!(error instanceof Error)) return null;
  const direct = error as PgError;
  if (direct.code || direct.constraint) return direct;
  const cause = (error as ErrorWithCause).cause;
  return cause instanceof Error ? (cause as PgError) : null;
}

function isAppointmentOverlapError(error: unknown) {
  const pgError = asPgError(error);
  return pgError?.code === "23P01" && pgError.constraint === "appointments_no_scheduled_overlap";
}

async function loadEntryView(database: Database, tokenHash: string) {
  const entry = await getWaitlistEntryByManagementTokenHash(database, tokenHash);
  if (!entry) return null;
  const barbershop = await resolveBarbershopById(database, entry.barbershopId);
  const customer = await getCustomerIdentity(database, entry.barbershopId, entry.customerId);
  const service = await getServiceSnapshot(database, entry.barbershopId, entry.serviceId);
  const staff = entry.staffId
    ? await getStaffSnapshot(database, entry.barbershopId, entry.staffId)
    : null;
  const pendingOffer = await getPendingOfferForEntry(database, entry.id);
  if (!barbershop || !customer || !service) {
    throw new Error("WaitlistEntry references missing tenant-scoped data");
  }
  return { entry, barbershop, customer, service, staff, pendingOffer };
}

export async function getWaitlistEntryCapability(
  token: string,
  options: { database?: Database } = {},
) {
  const database = options.database ?? getDb();
  const view = await loadEntryView(database, hashOpaqueToken(token));
  return view ? { status: "ok" as const, ...view } : { status: "not-found" as const };
}

export async function cancelWaitlistEntryByCapability(
  token: string,
  options: { database?: Database; clock?: Clock; appOrigin?: string } = {},
) {
  const database = options.database ?? getDb();
  const now = (options.clock ?? systemClock).now();
  const appOrigin = options.appOrigin ?? process.env.APP_ORIGIN;
  if (!appOrigin) throw new Error("APP_ORIGIN is required for waitlist capability links");

  const tokenHash = hashOpaqueToken(token);
  const visible = await getWaitlistEntryByManagementTokenHash(database, tokenHash);
  if (!visible) return { status: "not-found" as const };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const visibleOffer = await getPendingOfferForEntry(database, visible.id);
    const result = await database.transaction(async (tx) => {
      let lockedOffer: Awaited<ReturnType<typeof lockWaitlistOfferById>> | null = null;
      if (visibleOffer) {
        await lockStaffMembersForUpdate(tx, visible.barbershopId, [visibleOffer.staffId]);
        lockedOffer = await lockWaitlistOfferById(tx, visibleOffer.id);
      }

      const entry = await lockWaitlistEntryByManagementTokenHash(tx, tokenHash);
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
          const barbershop = await resolveBarbershopById(tx, entry.barbershopId);
          if (!barbershop) throw new Error("WaitlistOffer references missing Barbershop");
          await reserveNextWaitlistOfferForOpportunity(tx, {
            barbershop,
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

  throw new Error("WaitlistEntry cancellation could not stabilize pending offer state");
}

async function loadOfferView(database: Database, tokenHash: string) {
  const offer = await getWaitlistOfferByActionTokenHash(database, tokenHash);
  if (!offer) return null;
  const entry = await getWaitlistEntryById(database, offer.barbershopId, offer.waitlistEntryId);
  if (!entry) throw new Error("WaitlistOffer references missing WaitlistEntry");
  const barbershop = await resolveBarbershopById(database, offer.barbershopId);
  const customer = await getCustomerIdentity(database, offer.barbershopId, entry.customerId);
  const service = await getServiceSnapshot(database, offer.barbershopId, entry.serviceId);
  const staff = await getStaffSnapshot(database, offer.barbershopId, offer.staffId);
  if (!barbershop || !customer || !service || !staff) {
    throw new Error("WaitlistOffer references missing tenant-scoped data");
  }
  return { offer, entry, barbershop, customer, service, staff };
}

export async function getWaitlistOfferCapability(
  token: string,
  options: { database?: Database } = {},
) {
  const database = options.database ?? getDb();
  const view = await loadOfferView(database, hashOpaqueToken(token));
  return view ? { status: "ok" as const, ...view } : { status: "not-found" as const };
}

export async function rejectWaitlistOfferByCapability(
  token: string,
  options: { database?: Database; clock?: Clock; appOrigin?: string } = {},
) {
  const database = options.database ?? getDb();
  const now = (options.clock ?? systemClock).now();
  const appOrigin = options.appOrigin ?? process.env.APP_ORIGIN;
  if (!appOrigin) throw new Error("APP_ORIGIN is required for waitlist capability links");
  const tokenHash = hashOpaqueToken(token);
  const visible = await getWaitlistOfferByActionTokenHash(database, tokenHash);
  if (!visible) return { status: "not-found" as const };

  return database.transaction(async (tx) => {
    await lockStaffMembersForUpdate(tx, visible.barbershopId, [visible.staffId]);
    const offer = await lockWaitlistOfferByActionTokenHash(tx, tokenHash);
    if (!offer) return { status: "not-found" as const };
    if (offer.status === "REJECTED") {
      return { status: "already-rejected" as const, offer };
    }
    if (offer.status !== "PENDING") return { status: "offer-conflict" as const, offer };

    const rejected = await rejectWaitlistOffer(tx, offer.id, now);
    if (!rejected) return { status: "offer-conflict" as const, offer };
    const barbershop = await resolveBarbershopById(tx, offer.barbershopId);
    if (!barbershop) throw new Error("WaitlistOffer references missing Barbershop");
    const next = await reserveNextWaitlistOfferForOpportunity(tx, {
      barbershop,
      staffId: offer.staffId,
      opportunityId: offer.opportunityId,
      opportunityStartsAt: offer.opportunityStartsAt,
      opportunityEndsAt: offer.opportunityEndsAt,
      now,
      appOrigin,
    });
    return { status: "ok" as const, offer: rejected, next };
  });
}

export async function acceptWaitlistOfferByCapability(
  token: string,
  options: {
    database?: Database;
    clock?: Clock;
    appOrigin?: string;
    createManagementToken?: () => string;
  } = {},
) {
  const database = options.database ?? getDb();
  const now = (options.clock ?? systemClock).now();
  const appOrigin = options.appOrigin ?? process.env.APP_ORIGIN;
  if (!appOrigin) throw new Error("APP_ORIGIN is required for appointment capability links");
  const tokenHash = hashOpaqueToken(token);
  const visible = await getWaitlistOfferByActionTokenHash(database, tokenHash);
  if (!visible) return { status: "not-found" as const };

  try {
    return await database.transaction(async (tx) => {
      await lockStaffMembersForUpdate(tx, visible.barbershopId, [visible.staffId]);
      const offer = await lockWaitlistOfferByActionTokenHash(tx, tokenHash);
      if (!offer) return { status: "not-found" as const };
      if (offer.status === "ACCEPTED") {
        if (!offer.appointmentId) {
          throw new Error("Accepted WaitlistOffer is missing appointment_id");
        }
        return { status: "already-accepted" as const, appointmentId: offer.appointmentId };
      }
      if (offer.status === "EXPIRED" || now >= offer.expiresAt) {
        return { status: "offer-expired" as const };
      }
      if (offer.status !== "PENDING") return { status: "offer-conflict" as const };

      const entry = await lockWaitlistEntryById(tx, offer.waitlistEntryId);
      if (!entry || entry.status !== "ACTIVE") return { status: "entry-conflict" as const };
      const barbershop = await resolveBarbershopById(tx, offer.barbershopId);
      if (!barbershop) throw new Error("WaitlistOffer references missing Barbershop");
      const customer = await getCustomerIdentity(tx, offer.barbershopId, entry.customerId);
      const service = await getActiveBookingService(tx, offer.barbershopId, entry.serviceId);
      const staff = await getStaffSnapshot(tx, offer.barbershopId, offer.staffId);
      if (!customer || !service || !staff || !staff.active || !staff.acceptsAppointments) {
        return { status: "appointment-conflict" as const };
      }

      const date = localDateForInstant(offer.startsAt, barbershop.timezone);
      const range = localDateBounds(date, barbershop.timezone);
      const catalog = await getCatalogAvailabilityInput(tx, {
        barbershopId: barbershop.id,
        serviceId: service.id,
        staffId: offer.staffId,
        weekday: weekdayForLocalDate(date),
        rangeStartsAt: range.startsAt,
        rangeEndsAt: range.endsAt,
      });
      if (!catalog || catalog.staff.length !== 1) {
        return { status: "appointment-conflict" as const };
      }

      const appointmentBlocks = await listScheduledAppointmentBlocks(tx, {
        barbershopId: barbershop.id,
        staffIds: [offer.staffId],
        rangeStartsAt: range.startsAt,
        rangeEndsAt: range.endsAt,
      });
      const offerBlocks = await listPendingOfferBlocks(tx, {
        barbershopId: barbershop.id,
        staffIds: [offer.staffId],
        rangeStartsAt: range.startsAt,
        rangeEndsAt: range.endsAt,
        excludeOfferId: offer.id,
      });
      const staffInput = catalog.staff[0];
      const slots = getAvailability({
        date,
        timezone: barbershop.timezone,
        bookingIntervalMinutes: barbershop.bookingIntervalMinutes,
        serviceDurationMinutes: service.durationMinutes,
        now,
        externalBlocks: offerBlocks,
        staff: [
          {
            staffId: offer.staffId,
            workingHours: staffInput.workingHours,
            timeOff: staffInput.timeOff,
            appointments: appointmentBlocks.map((block) => ({
              startsAt: block.startsAt,
              endsAt: block.endsAt,
            })),
          },
        ],
      });
      const slot = slots.find((candidate) => candidate.startsAt === offer.startsAt.toISOString());
      if (!slot || slot.endsAt !== offer.endsAt.toISOString()) {
        return { status: "appointment-conflict" as const };
      }

      const managementToken = (options.createManagementToken ?? createOpaqueToken)();
      const appointment = await createAppointmentInTransaction(tx, {
        barbershopId: barbershop.id,
        customerId: entry.customerId,
        staffId: offer.staffId,
        serviceId: entry.serviceId,
        startsAt: offer.startsAt,
        endsAt: offer.endsAt,
        managementTokenHash: hashOpaqueToken(managementToken),
      });
      const managementUrl = `${appOrigin.replace(/\/$/, "")}/a/${managementToken}`;

      const accepted = await acceptWaitlistOffer(tx, offer.id, appointment.id, now);
      const fulfilled = await fulfillWaitlistEntry(tx, entry.id, now);
      if (!accepted || !fulfilled) throw new Error("Waitlist acceptance transition failed");

      await enqueueAppointmentNotifications(tx, {
        barbershopId: barbershop.id,
        appointmentId: appointment.id,
        phoneE164: customer.phoneE164,
        now,
        startsAt: appointment.startsAt,
        reminderOffsetMinutes: barbershop.reminderOffsetMinutes,
        createdPayload: {
          type: "APPOINTMENT_CREATED",
          appointmentId: appointment.id,
          customerName: customer.name,
          serviceName: service.name,
          staffName: staff.name,
          startsAt: appointment.startsAt.toISOString(),
          managementUrl,
        },
        reminderPayload: {
          type: "APPOINTMENT_REMINDER",
          appointmentId: appointment.id,
          customerName: customer.name,
          serviceName: service.name,
          staffName: staff.name,
          startsAt: appointment.startsAt.toISOString(),
        },
      });

      return { status: "ok" as const, appointment, managementUrl };
    });
  } catch (error) {
    if (isAppointmentOverlapError(error)) return { status: "appointment-conflict" as const };
    throw error;
  }
}
