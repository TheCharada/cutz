import { randomUUID } from "node:crypto";
import { getDb, type Database } from "@/infrastructure/db/client";
import type { DbExecutor } from "@/infrastructure/db/executor";
import { resolveBarbershopById } from "@/modules/barbershops";
import {
  getActiveBookingService,
  getCatalogAvailabilityInput,
  getServiceSnapshot,
  getStaffSnapshot,
  lockStaffMembersForUpdate,
} from "@/modules/catalog";
import { getCustomerIdentity } from "@/modules/customers";
import {
  cancelPendingAppointmentReminder,
  enqueueAppointmentCancelledNotification,
  enqueueAppointmentRescheduledNotifications,
} from "@/modules/notifications";
import {
  cancelScheduledAppointmentInTransaction,
  createAppointmentInTransaction,
  getAppointmentByManagementTokenHash,
  getAvailability,
  listScheduledAppointmentBlocks,
  lockAppointmentByManagementToken,
} from "@/modules/scheduling";
import { listPendingOfferBlocks } from "@/modules/waitlist";
import { SystemClock, type Clock } from "@/shared/clock";
import { createOpaqueToken, hashOpaqueToken } from "@/shared/tokens";
import { localDateBounds, localDateForInstant, weekdayForLocalDate } from "@/shared/time";
import { reserveNextWaitlistOfferForOpportunity } from "./waitlist-opportunity";

const systemClock = new SystemClock();

type PgError = Error & { code?: string; constraint?: string };
type ErrorWithCause = Error & { cause?: unknown };
type ManagedAppointment = NonNullable<
  Awaited<ReturnType<typeof getAppointmentByManagementTokenHash>>
>;
type AppointmentRange = Pick<ManagedAppointment, "staffId" | "startsAt" | "endsAt">;

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

function releasedRangesAfterReschedule(oldAppointment: AppointmentRange, newAppointment: AppointmentRange) {
  if (oldAppointment.staffId !== newAppointment.staffId) {
    return [{ startsAt: oldAppointment.startsAt, endsAt: oldAppointment.endsAt }];
  }

  if (
    newAppointment.endsAt <= oldAppointment.startsAt ||
    newAppointment.startsAt >= oldAppointment.endsAt
  ) {
    return [{ startsAt: oldAppointment.startsAt, endsAt: oldAppointment.endsAt }];
  }

  const released: Array<{ startsAt: Date; endsAt: Date }> = [];
  if (newAppointment.startsAt > oldAppointment.startsAt) {
    released.push({
      startsAt: oldAppointment.startsAt,
      endsAt: new Date(Math.min(newAppointment.startsAt.getTime(), oldAppointment.endsAt.getTime())),
    });
  }
  if (newAppointment.endsAt < oldAppointment.endsAt) {
    released.push({
      startsAt: new Date(Math.max(newAppointment.endsAt.getTime(), oldAppointment.startsAt.getTime())),
      endsAt: oldAppointment.endsAt,
    });
  }
  return released.filter((range) => range.endsAt > range.startsAt);
}

async function reserveRescheduleWaitlistOffer(
  executor: DbExecutor,
  params: {
    oldAppointment: AppointmentRange;
    newAppointment: AppointmentRange;
    barbershop: NonNullable<Awaited<ReturnType<typeof resolveBarbershopById>>>;
    now: Date;
    appOrigin: string;
  },
) {
  const releasedRanges = releasedRangesAfterReschedule(
    params.oldAppointment,
    params.newAppointment,
  );

  for (const released of releasedRanges) {
    const result = await reserveNextWaitlistOfferForOpportunity(executor, {
      barbershop: params.barbershop,
      staffId: params.oldAppointment.staffId,
      opportunityId: randomUUID(),
      opportunityStartsAt: released.startsAt,
      opportunityEndsAt: released.endsAt,
      now: params.now,
      appOrigin: params.appOrigin,
    });
    if (result.status === "offered") return result;
  }

  return { status: "no-candidate" as const };
}

async function loadAppointmentSnapshots(executor: DbExecutor, appointment: ManagedAppointment) {
  const barbershop = await resolveBarbershopById(executor, appointment.barbershopId);
  const customer = await getCustomerIdentity(
    executor,
    appointment.barbershopId,
    appointment.customerId,
  );
  const service = await getServiceSnapshot(
    executor,
    appointment.barbershopId,
    appointment.serviceId,
  );
  const staff = await getStaffSnapshot(executor, appointment.barbershopId, appointment.staffId);
  if (!barbershop || !customer || !service || !staff) {
    throw new Error("Appointment references missing tenant-scoped data");
  }
  return { barbershop, customer, service, staff };
}

function publicAppointment(
  appointment: ManagedAppointment,
  snapshots: Awaited<ReturnType<typeof loadAppointmentSnapshots>>,
) {
  return {
    barbershop: {
      slug: snapshots.barbershop.slug,
      timezone: snapshots.barbershop.timezone,
    },
    customer: { name: snapshots.customer.name },
    service: {
      id: snapshots.service.id,
      name: snapshots.service.name,
      durationMinutes: snapshots.service.durationMinutes,
    },
    staff: { id: snapshots.staff.id, name: snapshots.staff.name },
    appointment: {
      id: appointment.id,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      status: appointment.status,
      cancelledAt: appointment.cancelledAt,
      cancelledBy: appointment.cancelledBy,
      cancellationKind: appointment.cancellationKind,
      cancellationReason: appointment.cancellationReason,
      rescheduledFromId: appointment.rescheduledFromId,
    },
  };
}

async function calculateRescheduleAvailability(
  executor: DbExecutor,
  params: { appointment: ManagedAppointment; staffId: string; date: string; now: Date },
) {
  const barbershop = await resolveBarbershopById(executor, params.appointment.barbershopId);
  if (!barbershop) return { status: "appointment-conflict" as const };
  const service = await getActiveBookingService(
    executor,
    params.appointment.barbershopId,
    params.appointment.serviceId,
  );
  if (!service) return { status: "appointment-conflict" as const };

  const range = localDateBounds(params.date, barbershop.timezone);
  const catalog = await getCatalogAvailabilityInput(executor, {
    barbershopId: barbershop.id,
    serviceId: service.id,
    staffId: params.staffId,
    weekday: weekdayForLocalDate(params.date),
    rangeStartsAt: range.startsAt,
    rangeEndsAt: range.endsAt,
  });
  if (!catalog || catalog.staff.length !== 1) {
    return { status: "appointment-conflict" as const };
  }

  const staffInput = catalog.staff[0];
  const appointmentBlocks = await listScheduledAppointmentBlocks(executor, {
    barbershopId: barbershop.id,
    staffIds: [staffInput.id],
    rangeStartsAt: range.startsAt,
    rangeEndsAt: range.endsAt,
    excludeAppointmentId: params.appointment.id,
  });
  const offerBlocks = await listPendingOfferBlocks(executor, {
    barbershopId: barbershop.id,
    staffIds: [staffInput.id],
    rangeStartsAt: range.startsAt,
    rangeEndsAt: range.endsAt,
  });
  const slots = getAvailability({
    date: params.date,
    timezone: barbershop.timezone,
    bookingIntervalMinutes: barbershop.bookingIntervalMinutes,
    serviceDurationMinutes: service.durationMinutes,
    now: params.now,
    externalBlocks: offerBlocks,
    staff: [
      {
        staffId: staffInput.id,
        workingHours: staffInput.workingHours,
        timeOff: staffInput.timeOff,
        appointments: appointmentBlocks.map((block) => ({
          startsAt: block.startsAt,
          endsAt: block.endsAt,
        })),
      },
    ],
  });
  return {
    status: "ok" as const,
    barbershop,
    service,
    targetStaff: { id: staffInput.id, name: staffInput.name },
    slots,
  };
}

export async function getAppointmentCapability(
  token: string,
  options: { database?: Database } = {},
) {
  const database = options.database ?? getDb();
  const appointment = await getAppointmentByManagementTokenHash(database, hashOpaqueToken(token));
  if (!appointment) return { status: "not-found" as const };
  const snapshots = await loadAppointmentSnapshots(database, appointment);
  return { status: "ok" as const, ...publicAppointment(appointment, snapshots) };
}

export async function getRescheduleAvailabilityByCapability(
  params: { token: string; staffId: string; date: string },
  options: { database?: Database; clock?: Clock } = {},
) {
  const database = options.database ?? getDb();
  const appointment = await getAppointmentByManagementTokenHash(
    database,
    hashOpaqueToken(params.token),
  );
  if (!appointment) return { status: "not-found" as const };
  if (appointment.status !== "SCHEDULED") return { status: "terminal-conflict" as const };

  const availability = await calculateRescheduleAvailability(database, {
    appointment,
    staffId: params.staffId,
    date: params.date,
    now: (options.clock ?? systemClock).now(),
  });
  if (availability.status !== "ok") return availability;
  return { status: "ok" as const, slots: availability.slots };
}

export async function cancelAppointmentByCapability(
  params: { token: string; reason?: string },
  options: { database?: Database; clock?: Clock; appOrigin?: string } = {},
) {
  const database = options.database ?? getDb();
  const now = (options.clock ?? systemClock).now();
  const appOrigin = options.appOrigin ?? process.env.APP_ORIGIN;
  if (!appOrigin) throw new Error("APP_ORIGIN is required for waitlist capability links");
  const tokenHash = hashOpaqueToken(params.token);
  const visible = await getAppointmentByManagementTokenHash(database, tokenHash);
  if (!visible) return { status: "not-found" as const };
  if (visible.status === "CANCELLED") {
    const snapshots = await loadAppointmentSnapshots(database, visible);
    return {
      status: "ok" as const,
      changed: false,
      waitlist: { status: "unchanged" as const },
      ...publicAppointment(visible, snapshots),
    };
  }
  if (visible.status === "COMPLETED" || visible.status === "NO_SHOW") {
    return { status: "terminal-conflict" as const };
  }

  return database.transaction(async (tx) => {
    await lockStaffMembersForUpdate(tx, visible.barbershopId, [visible.staffId]);
    const appointment = await lockAppointmentByManagementToken(tx, tokenHash);
    if (!appointment) return { status: "not-found" as const };
    const snapshots = await loadAppointmentSnapshots(tx, appointment);
    if (appointment.status === "CANCELLED") {
      return {
        status: "ok" as const,
        changed: false,
        waitlist: { status: "unchanged" as const },
        ...publicAppointment(appointment, snapshots),
      };
    }
    if (appointment.status !== "SCHEDULED") return { status: "terminal-conflict" as const };

    const cancelled = await cancelScheduledAppointmentInTransaction(tx, {
      appointmentId: appointment.id,
      cancelledAt: now,
      cancelledBy: "CUSTOMER",
      cancellationKind: "CANCELLATION",
      cancellationReason: params.reason?.trim() || undefined,
    });
    if (!cancelled) throw new Error("Locked scheduled Appointment could not be cancelled");

    await cancelPendingAppointmentReminder(tx, {
      barbershopId: appointment.barbershopId,
      appointmentId: appointment.id,
    });
    await enqueueAppointmentCancelledNotification(tx, {
      barbershopId: appointment.barbershopId,
      appointmentId: appointment.id,
      phoneE164: snapshots.customer.phoneE164,
      now,
      payload: {
        type: "APPOINTMENT_CANCELLED",
        appointmentId: appointment.id,
        customerName: snapshots.customer.name,
        serviceName: snapshots.service.name,
        staffName: snapshots.staff.name,
        startsAt: appointment.startsAt.toISOString(),
        ...(params.reason?.trim() ? { reason: params.reason.trim() } : {}),
      },
    });

    const waitlist = await reserveNextWaitlistOfferForOpportunity(tx, {
      barbershop: snapshots.barbershop,
      staffId: appointment.staffId,
      opportunityId: randomUUID(),
      opportunityStartsAt: appointment.startsAt,
      opportunityEndsAt: appointment.endsAt,
      now,
      appOrigin,
    });

    return {
      status: "ok" as const,
      changed: true,
      waitlist,
      ...publicAppointment(cancelled, snapshots),
    };
  });
}

export async function rescheduleAppointmentByCapability(
  params: { token: string; staffId: string; startsAt: Date },
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
  const createManagementToken = options.createManagementToken ?? createOpaqueToken;
  if (!appOrigin) throw new Error("APP_ORIGIN is required to create appointment capability links");

  const tokenHash = hashOpaqueToken(params.token);
  const visible = await getAppointmentByManagementTokenHash(database, tokenHash);
  if (!visible) return { status: "not-found" as const };
  if (visible.status !== "SCHEDULED") return { status: "terminal-conflict" as const };

  try {
    return await database.transaction(async (tx) => {
      await lockStaffMembersForUpdate(tx, visible.barbershopId, [visible.staffId, params.staffId]);
      const oldAppointment = await lockAppointmentByManagementToken(tx, tokenHash);
      if (!oldAppointment) return { status: "not-found" as const };
      if (oldAppointment.status !== "SCHEDULED") return { status: "terminal-conflict" as const };

      const barbershop = await resolveBarbershopById(tx, oldAppointment.barbershopId);
      if (!barbershop) return { status: "appointment-conflict" as const };
      const date = localDateForInstant(params.startsAt, barbershop.timezone);
      const availability = await calculateRescheduleAvailability(tx, {
        appointment: oldAppointment,
        staffId: params.staffId,
        date,
        now,
      });
      if (availability.status !== "ok") return { status: "appointment-conflict" as const };

      const slot = availability.slots.find(
        (candidate) => candidate.startsAt === params.startsAt.toISOString(),
      );
      if (!slot) return { status: "appointment-conflict" as const };
      const customer = await getCustomerIdentity(
        tx,
        oldAppointment.barbershopId,
        oldAppointment.customerId,
      );
      if (!customer) return { status: "appointment-conflict" as const };

      const cancelled = await cancelScheduledAppointmentInTransaction(tx, {
        appointmentId: oldAppointment.id,
        cancelledAt: now,
        cancelledBy: "CUSTOMER",
        cancellationKind: "RESCHEDULED",
      });
      if (!cancelled) {
        throw new Error("Locked scheduled Appointment could not be marked as rescheduled");
      }
      await cancelPendingAppointmentReminder(tx, {
        barbershopId: availability.barbershop.id,
        appointmentId: oldAppointment.id,
      });

      const managementToken = createManagementToken();
      const newAppointment = await createAppointmentInTransaction(tx, {
        barbershopId: availability.barbershop.id,
        customerId: oldAppointment.customerId,
        staffId: availability.targetStaff.id,
        serviceId: oldAppointment.serviceId,
        startsAt: params.startsAt,
        endsAt: new Date(slot.endsAt),
        managementTokenHash: hashOpaqueToken(managementToken),
        rescheduledFromId: oldAppointment.id,
      });
      const managementUrl = `${appOrigin.replace(/\/$/, "")}/a/${managementToken}`;

      await enqueueAppointmentRescheduledNotifications(tx, {
        barbershopId: availability.barbershop.id,
        appointmentId: newAppointment.id,
        phoneE164: customer.phoneE164,
        now,
        startsAt: newAppointment.startsAt,
        reminderOffsetMinutes: availability.barbershop.reminderOffsetMinutes,
        rescheduledPayload: {
          type: "APPOINTMENT_RESCHEDULED",
          appointmentId: newAppointment.id,
          previousAppointmentId: oldAppointment.id,
          customerName: customer.name,
          serviceName: availability.service.name,
          staffName: availability.targetStaff.name,
          startsAt: newAppointment.startsAt.toISOString(),
          managementUrl,
        },
        reminderPayload: {
          type: "APPOINTMENT_REMINDER",
          appointmentId: newAppointment.id,
          customerName: customer.name,
          serviceName: availability.service.name,
          staffName: availability.targetStaff.name,
          startsAt: newAppointment.startsAt.toISOString(),
        },
      });

      const waitlist = await reserveRescheduleWaitlistOffer(tx, {
        oldAppointment,
        newAppointment,
        barbershop: availability.barbershop,
        now,
        appOrigin,
      });

      return {
        status: "ok" as const,
        oldAppointment: cancelled,
        appointment: newAppointment,
        managementUrl,
        waitlist,
      };
    });
  } catch (error) {
    if (isAppointmentOverlapError(error)) return { status: "appointment-conflict" as const };
    throw error;
  }
}
