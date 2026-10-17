import { getAntiAbuseEnv } from "@/config/anti-abuse";
import { getDb, type Database } from "@/infrastructure/db/client";
import { resolveBarbershopBySlug } from "@/modules/barbershops";
import {
  getActiveBookingService,
  getCatalogAvailabilityInput,
  lockBookableStaffMember,
  staffPerformsService,
} from "@/modules/catalog";
import {
  customerSessionSatisfiesVerificationMode,
  resolveCustomerPrincipal,
} from "@/modules/customers";
import { enqueueAppointmentNotifications } from "@/modules/notifications";
import {
  countCustomerFutureAppointments,
  createAppointmentInTransaction,
  getAvailability,
  listScheduledAppointmentBlocks,
  lockCustomerAppointmentCreation,
} from "@/modules/scheduling";
import { listPendingOfferBlocks } from "@/modules/waitlist";
import { SystemClock, type Clock } from "@/shared/clock";
import { createOpaqueToken, hashOpaqueToken } from "@/shared/tokens";
import {
  localDateBounds,
  localDateForInstant,
  weekdayForLocalDate,
} from "@/shared/time";

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

export async function createPublicAppointment(
  params: {
    slug: string;
    sessionToken: string;
    serviceId: string;
    staffId: string;
    startsAt: Date;
  },
  options: {
    database?: Database;
    clock?: Clock;
    appOrigin?: string;
    maxFutureAppointments?: number;
  } = {},
) {
  const database = options.database ?? getDb();
  const clock = options.clock ?? systemClock;
  const now = clock.now();
  const appOrigin = options.appOrigin ?? process.env.APP_ORIGIN;
  const maxFutureAppointments =
    options.maxFutureAppointments ?? getAntiAbuseEnv().MAX_FUTURE_APPOINTMENTS_PER_CUSTOMER;

  if (!appOrigin) throw new Error("APP_ORIGIN is required to create appointment capability links");

  try {
    return await database.transaction(async (tx) => {
      const barbershop = await resolveBarbershopBySlug(tx, params.slug);
      if (!barbershop) return { status: "barbershop-not-found" as const };

      const customer = await resolveCustomerPrincipal(tx, {
        barbershopId: barbershop.id,
        token: params.sessionToken,
        now,
      });
      if (
        !customer ||
        !customerSessionSatisfiesVerificationMode(customer, barbershop.customerVerificationMode)
      ) {
        return { status: "customer-session-invalid" as const };
      }

      await lockCustomerAppointmentCreation(tx, barbershop.id, customer.id);
      const futureAppointments = await countCustomerFutureAppointments(tx, {
        barbershopId: barbershop.id,
        customerId: customer.id,
        after: now,
      });
      if (futureAppointments >= maxFutureAppointments) {
        return { status: "future-appointment-limit" as const };
      }

      const service = await getActiveBookingService(tx, barbershop.id, params.serviceId);
      if (!service) return { status: "service-not-found" as const };

      const staff = await lockBookableStaffMember(tx, barbershop.id, params.staffId);
      if (!staff) return { status: "staff-not-found" as const };
      if (!(await staffPerformsService(tx, barbershop.id, staff.id, service.id))) {
        return { status: "schedule-conflict" as const };
      }

      const date = localDateForInstant(params.startsAt, barbershop.timezone);
      const range = localDateBounds(date, barbershop.timezone);
      const catalog = await getCatalogAvailabilityInput(tx, {
        barbershopId: barbershop.id,
        serviceId: service.id,
        staffId: staff.id,
        weekday: weekdayForLocalDate(date),
        rangeStartsAt: range.startsAt,
        rangeEndsAt: range.endsAt,
      });
      if (!catalog || catalog.staff.length !== 1) return { status: "schedule-conflict" as const };

      const staffInput = catalog.staff[0];
      const targetStartsAt = params.startsAt.toISOString();
      const scheduleSlots = getAvailability({
        date,
        timezone: barbershop.timezone,
        bookingIntervalMinutes: barbershop.bookingIntervalMinutes,
        serviceDurationMinutes: service.durationMinutes,
        now,
        externalBlocks: [],
        staff: [{
          staffId: staff.id,
          workingHours: staffInput.workingHours,
          timeOff: staffInput.timeOff,
          appointments: [],
        }],
      });
      if (!scheduleSlots.find((slot) => slot.startsAt === targetStartsAt)) {
        return { status: "schedule-conflict" as const };
      }

      const appointmentBlocks = await listScheduledAppointmentBlocks(tx, {
        barbershopId: barbershop.id,
        staffIds: [staff.id],
        rangeStartsAt: range.startsAt,
        rangeEndsAt: range.endsAt,
      });
      const offerBlocks = await listPendingOfferBlocks(tx, {
        barbershopId: barbershop.id,
        staffIds: [staff.id],
        rangeStartsAt: range.startsAt,
        rangeEndsAt: range.endsAt,
      });
      const availableSlots = getAvailability({
        date,
        timezone: barbershop.timezone,
        bookingIntervalMinutes: barbershop.bookingIntervalMinutes,
        serviceDurationMinutes: service.durationMinutes,
        now,
        externalBlocks: offerBlocks,
        staff: [{
          staffId: staff.id,
          workingHours: staffInput.workingHours,
          timeOff: staffInput.timeOff,
          appointments: appointmentBlocks.map((block) => ({ startsAt: block.startsAt, endsAt: block.endsAt })),
        }],
      });
      const slot = availableSlots.find((candidate) => candidate.startsAt === targetStartsAt);
      if (!slot) return { status: "appointment-conflict" as const };

      const managementToken = createOpaqueToken();
      const appointment = await createAppointmentInTransaction(tx, {
        barbershopId: barbershop.id,
        customerId: customer.id,
        staffId: staff.id,
        serviceId: service.id,
        startsAt: params.startsAt,
        endsAt: new Date(slot.endsAt),
        managementTokenHash: hashOpaqueToken(managementToken),
      });
      const managementUrl = `${appOrigin.replace(/\/$/, "")}/a/${managementToken}`;

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
