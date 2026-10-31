import { randomUUID } from "node:crypto";
import { getDb, type Database } from "@/infrastructure/db/client";
import type { DbExecutor } from "@/infrastructure/db/executor";
import type { BarbershopContext } from "@/modules/barbershops";
import {
  getActiveBookingService,
  getCatalogAvailabilityInput,
  getServiceSnapshot,
  getStaffSnapshot,
  lockBookableStaffMember,
  lockStaffMembersForUpdate,
  staffPerformsService,
} from "@/modules/catalog";
import { getCustomerIdentity } from "@/modules/customers";
import {
  cancelPendingAppointmentReminder,
  enqueueAppointmentCancelledNotification,
  enqueueAppointmentNotifications,
  enqueueAppointmentRescheduledNotifications,
} from "@/modules/notifications";
import {
  cancelScheduledAppointmentInTransaction,
  getBookedServiceRecord,
  createAppointmentInTransaction,
  finishScheduledAppointmentInTransaction,
  getAppointmentById,
  getAvailability,
  listAppointmentsForRange,
  listScheduledAppointmentBlocks,
  lockAppointmentForUpdate,
} from "@/modules/scheduling";
import { listPendingOfferBlocks } from "@/modules/waitlist";
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

async function appointmentSnapshots(executor: DbExecutor, appointment: {
  barbershopId: string; customerId: string; serviceId: string; staffId: string;
}) {
  const customer = await getCustomerIdentity(executor, appointment.barbershopId, appointment.customerId);
  const service = await getServiceSnapshot(executor, appointment.barbershopId, appointment.serviceId);
  const staff = await getStaffSnapshot(executor, appointment.barbershopId, appointment.staffId);
  if (!customer || !service || !staff) throw new Error("Appointment references missing tenant-scoped data");
  return { customer, service, staff };
}

export async function listAdminAgenda(params: { barbershop: BarbershopContext; date: string }, options: { database?: Database } = {}) {
  const database = options.database ?? getDb();
  const range = localDateBounds(params.date, params.barbershop.timezone);
  const appointments = await listAppointmentsForRange(database, { barbershopId: params.barbershop.id, rangeStartsAt: range.startsAt, rangeEndsAt: range.endsAt });
  const rows = [];
  for (const appointment of appointments) {
    const snapshots = await appointmentSnapshots(database, appointment);
    rows.push({ ...appointment, customer: { id: snapshots.customer.id, name: snapshots.customer.name, phoneE164: snapshots.customer.phoneE164 }, service: { id: snapshots.service.id, name: snapshots.service.name, durationMinutes: snapshots.service.durationMinutes }, staff: { id: snapshots.staff.id, name: snapshots.staff.name } });
  }
  return rows;
}

async function calculateAdminAvailability(executor: DbExecutor, params: { barbershop: BarbershopContext; serviceId: string; staffId: string; date: string; now: Date; excludeAppointmentId?: string }) {
  const service = await getActiveBookingService(executor, params.barbershop.id, params.serviceId);
  if (!service) return { status: "service-not-found" as const };
  const range = localDateBounds(params.date, params.barbershop.timezone);
  const catalog = await getCatalogAvailabilityInput(executor, { barbershopId: params.barbershop.id, serviceId: service.id, staffId: params.staffId, weekday: weekdayForLocalDate(params.date), rangeStartsAt: range.startsAt, rangeEndsAt: range.endsAt });
  if (!catalog || catalog.staff.length !== 1) return { status: "schedule-conflict" as const };
  const staffInput = catalog.staff[0];
  const appointmentBlocks = await listScheduledAppointmentBlocks(executor, { barbershopId: params.barbershop.id, staffIds: [params.staffId], rangeStartsAt: range.startsAt, rangeEndsAt: range.endsAt, excludeAppointmentId: params.excludeAppointmentId });
  const offerBlocks = await listPendingOfferBlocks(executor, { barbershopId: params.barbershop.id, staffIds: [params.staffId], rangeStartsAt: range.startsAt, rangeEndsAt: range.endsAt });
  const slots = getAvailability({ date: params.date, timezone: params.barbershop.timezone, bookingIntervalMinutes: params.barbershop.bookingIntervalMinutes, serviceDurationMinutes: service.durationMinutes, now: params.now, externalBlocks: offerBlocks, staff: [{ staffId: params.staffId, workingHours: staffInput.workingHours, timeOff: staffInput.timeOff, appointments: appointmentBlocks.map((block) => ({ startsAt: block.startsAt, endsAt: block.endsAt })) }] });
  return { status: "ok" as const, service, staff: { id: staffInput.id, name: staffInput.name }, slots };
}

export async function createAdminAppointment(params: { barbershop: BarbershopContext; customerId: string; serviceId: string; staffId: string; startsAt: Date }, options: { database?: Database; clock?: Clock; appOrigin?: string; createManagementToken?: () => string } = {}) {
  const database = options.database ?? getDb();
  const now = (options.clock ?? systemClock).now();
  const appOrigin = options.appOrigin ?? process.env.APP_ORIGIN;
  if (!appOrigin) throw new Error("APP_ORIGIN is required for appointment capability links");
  try {
    return await database.transaction(async (tx) => {
      const customer = await getCustomerIdentity(tx, params.barbershop.id, params.customerId);
      if (!customer) return { status: "customer-not-found" as const };
      const service = await getActiveBookingService(tx, params.barbershop.id, params.serviceId);
      if (!service) return { status: "service-not-found" as const };
      const staff = await lockBookableStaffMember(tx, params.barbershop.id, params.staffId);
      if (!staff) return { status: "staff-not-found" as const };
      if (!(await staffPerformsService(tx, params.barbershop.id, staff.id, service.id))) return { status: "appointment-conflict" as const };
      const date = localDateForInstant(params.startsAt, params.barbershop.timezone);
      const availability = await calculateAdminAvailability(tx, { barbershop: params.barbershop, serviceId: service.id, staffId: staff.id, date, now });
      if (availability.status !== "ok") return { status: "appointment-conflict" as const };
      const slot = availability.slots.find((candidate) => candidate.startsAt === params.startsAt.toISOString());
      if (!slot) return { status: "appointment-conflict" as const };
      const token = (options.createManagementToken ?? createOpaqueToken)();
      const appointment = await createAppointmentInTransaction(tx, { barbershopId: params.barbershop.id, customerId: customer.id, staffId: staff.id, serviceId: service.id, startsAt: params.startsAt, endsAt: new Date(slot.endsAt), managementTokenHash: hashOpaqueToken(token) });
      const managementUrl = `${appOrigin.replace(/\/$/, "")}/a/${token}`;
      await enqueueAppointmentNotifications(tx, { barbershopId: params.barbershop.id, appointmentId: appointment.id, phoneE164: customer.phoneE164, now, startsAt: appointment.startsAt, reminderOffsetMinutes: params.barbershop.reminderOffsetMinutes, createdPayload: { type: "APPOINTMENT_CREATED", appointmentId: appointment.id, customerName: customer.name, serviceName: service.name, staffName: staff.name, startsAt: appointment.startsAt.toISOString(), managementUrl }, reminderPayload: { type: "APPOINTMENT_REMINDER", appointmentId: appointment.id, customerName: customer.name, serviceName: service.name, staffName: staff.name, startsAt: appointment.startsAt.toISOString() } });
      return { status: "ok" as const, appointment, managementUrl };
    });
  } catch (error) {
    if (isAppointmentOverlapError(error)) return { status: "appointment-conflict" as const };
    throw error;
  }
}

export async function finishAdminAppointment(params: { barbershop: BarbershopContext; appointmentId: string; status: "COMPLETED" | "NO_SHOW" }, options: { database?: Database; clock?: Clock } = {}) {
  const database = options.database ?? getDb();
  const now = (options.clock ?? systemClock).now();
  const visible = await getAppointmentById(database, params.barbershop.id, params.appointmentId);
  if (!visible) return { status: "not-found" as const };
  if (visible.status !== "SCHEDULED" || now < visible.startsAt) return { status: "appointment-conflict" as const };
  return database.transaction(async (tx) => {
    await lockStaffMembersForUpdate(tx, params.barbershop.id, [visible.staffId]);
    const appointment = await lockAppointmentForUpdate(tx, params.barbershop.id, params.appointmentId);
    if (!appointment) return { status: "not-found" as const };
    if (appointment.status !== "SCHEDULED" || now < appointment.startsAt) return { status: "appointment-conflict" as const };
    const updated = await finishScheduledAppointmentInTransaction(tx, { barbershopId: params.barbershop.id, appointmentId: appointment.id, status: params.status, now });
    if (!updated) return { status: "appointment-conflict" as const };
    await cancelPendingAppointmentReminder(tx, { barbershopId: params.barbershop.id, appointmentId: appointment.id });
    return { status: "ok" as const, appointment: updated };
  });
}

export async function cancelAdminAppointment(params: { barbershop: BarbershopContext; appointmentId: string; reason?: string }, options: { database?: Database; clock?: Clock; appOrigin?: string } = {}) {
  const database = options.database ?? getDb();
  const now = (options.clock ?? systemClock).now();
  const appOrigin = options.appOrigin ?? process.env.APP_ORIGIN;
  if (!appOrigin) throw new Error("APP_ORIGIN is required for waitlist links");
  const visible = await getAppointmentById(database, params.barbershop.id, params.appointmentId);
  if (!visible) return { status: "not-found" as const };
  if (visible.status === "CANCELLED") return { status: "ok" as const, changed: false, appointment: visible };
  if (visible.status !== "SCHEDULED") return { status: "appointment-conflict" as const };
  return database.transaction(async (tx) => {
    await lockStaffMembersForUpdate(tx, params.barbershop.id, [visible.staffId]);
    const appointment = await lockAppointmentForUpdate(tx, params.barbershop.id, params.appointmentId);
    if (!appointment) return { status: "not-found" as const };
    if (appointment.status === "CANCELLED") return { status: "ok" as const, changed: false, appointment };
    if (appointment.status !== "SCHEDULED") return { status: "appointment-conflict" as const };
    const snapshots = await appointmentSnapshots(tx, appointment);
    const cancelled = await cancelScheduledAppointmentInTransaction(tx, { barbershopId: params.barbershop.id, appointmentId: appointment.id, cancelledAt: now, cancelledBy: "STAFF", cancellationKind: "CANCELLATION", cancellationReason: params.reason?.trim() || undefined });
    if (!cancelled) return { status: "appointment-conflict" as const };
    await cancelPendingAppointmentReminder(tx, { barbershopId: params.barbershop.id, appointmentId: appointment.id });
    await enqueueAppointmentCancelledNotification(tx, { barbershopId: params.barbershop.id, appointmentId: appointment.id, phoneE164: snapshots.customer.phoneE164, now, payload: { type: "APPOINTMENT_CANCELLED", appointmentId: appointment.id, customerName: snapshots.customer.name, serviceName: snapshots.service.name, staffName: snapshots.staff.name, startsAt: appointment.startsAt.toISOString(), ...(params.reason?.trim() ? { reason: params.reason.trim() } : {}) } });
    const waitlist = await reserveNextWaitlistOfferForOpportunity(tx, { barbershop: params.barbershop, staffId: appointment.staffId, opportunityId: randomUUID(), opportunityStartsAt: appointment.startsAt, opportunityEndsAt: appointment.endsAt, now, appOrigin });
    return { status: "ok" as const, changed: true, appointment: cancelled, waitlist };
  });
}

function releasedRanges(oldAppointment: { staffId: string; startsAt: Date; endsAt: Date }, next: { staffId: string; startsAt: Date; endsAt: Date }) {
  if (oldAppointment.staffId !== next.staffId || next.endsAt <= oldAppointment.startsAt || next.startsAt >= oldAppointment.endsAt) return [{ startsAt: oldAppointment.startsAt, endsAt: oldAppointment.endsAt }];
  const ranges: Array<{ startsAt: Date; endsAt: Date }> = [];
  if (next.startsAt > oldAppointment.startsAt) ranges.push({ startsAt: oldAppointment.startsAt, endsAt: new Date(Math.min(next.startsAt.getTime(), oldAppointment.endsAt.getTime())) });
  if (next.endsAt < oldAppointment.endsAt) ranges.push({ startsAt: new Date(Math.max(next.endsAt.getTime(), oldAppointment.startsAt.getTime())), endsAt: oldAppointment.endsAt });
  return ranges.filter((range) => range.endsAt > range.startsAt);
}

export async function rescheduleAdminAppointment(params: { barbershop: BarbershopContext; appointmentId: string; staffId: string; startsAt: Date }, options: { database?: Database; clock?: Clock; appOrigin?: string; createManagementToken?: () => string } = {}) {
  const database = options.database ?? getDb();
  const now = (options.clock ?? systemClock).now();
  const appOrigin = options.appOrigin ?? process.env.APP_ORIGIN;
  if (!appOrigin) throw new Error("APP_ORIGIN is required for appointment links");
  const visible = await getAppointmentById(database, params.barbershop.id, params.appointmentId);
  if (!visible) return { status: "not-found" as const };
  if (visible.status !== "SCHEDULED") return { status: "appointment-conflict" as const };
  try {
    return await database.transaction(async (tx) => {
      await lockStaffMembersForUpdate(tx, params.barbershop.id, [visible.staffId, params.staffId]);
      const oldAppointment = await lockAppointmentForUpdate(tx, params.barbershop.id, params.appointmentId);
      if (!oldAppointment) return { status: "not-found" as const };
      if (oldAppointment.status !== "SCHEDULED") return { status: "appointment-conflict" as const };
      const date = localDateForInstant(params.startsAt, params.barbershop.timezone);
      const availability = await calculateAdminAvailability(tx, { barbershop: params.barbershop, serviceId: oldAppointment.serviceId, staffId: params.staffId, date, now, excludeAppointmentId: oldAppointment.id });
      if (availability.status !== "ok") return { status: "appointment-conflict" as const };
      const slot = availability.slots.find((candidate) => candidate.startsAt === params.startsAt.toISOString());
      if (!slot) return { status: "appointment-conflict" as const };
      const snapshots = await appointmentSnapshots(tx, oldAppointment);
      const targetStaff = await getStaffSnapshot(tx, params.barbershop.id, params.staffId);
      if (!targetStaff) return { status: "appointment-conflict" as const };
      const booked = await getBookedServiceRecord(tx, params.barbershop.id, oldAppointment.id);
      const cancelled = await cancelScheduledAppointmentInTransaction(tx, { barbershopId: params.barbershop.id, appointmentId: oldAppointment.id, cancelledAt: now, cancelledBy: "STAFF", cancellationKind: "RESCHEDULED" });
      if (!cancelled) return { status: "appointment-conflict" as const };
      await cancelPendingAppointmentReminder(tx, { barbershopId: params.barbershop.id, appointmentId: oldAppointment.id });
      const token = (options.createManagementToken ?? createOpaqueToken)();
      const appointment = await createAppointmentInTransaction(tx, { barbershopId: params.barbershop.id, customerId: oldAppointment.customerId, staffId: params.staffId, serviceId: oldAppointment.serviceId, startsAt: params.startsAt, endsAt: new Date(slot.endsAt), managementTokenHash: hashOpaqueToken(token), rescheduledFromId: oldAppointment.id, bookedSnapshot: booked ? { serviceNameSnapshot: booked.serviceNameSnapshot, durationMinutesSnapshot: booked.durationMinutesSnapshot, unitPriceCents: booked.unitPriceCents, historicalSnapshotComplete: booked.historicalSnapshotComplete } : undefined });
      const managementUrl = `${appOrigin.replace(/\/$/, "")}/a/${token}`;
      await enqueueAppointmentRescheduledNotifications(tx, { barbershopId: params.barbershop.id, appointmentId: appointment.id, phoneE164: snapshots.customer.phoneE164, now, startsAt: appointment.startsAt, reminderOffsetMinutes: params.barbershop.reminderOffsetMinutes, rescheduledPayload: { type: "APPOINTMENT_RESCHEDULED", appointmentId: appointment.id, previousAppointmentId: oldAppointment.id, customerName: snapshots.customer.name, serviceName: snapshots.service.name, staffName: targetStaff.name, startsAt: appointment.startsAt.toISOString(), managementUrl }, reminderPayload: { type: "APPOINTMENT_REMINDER", appointmentId: appointment.id, customerName: snapshots.customer.name, serviceName: snapshots.service.name, staffName: targetStaff.name, startsAt: appointment.startsAt.toISOString() } });
      let waitlist: unknown = { status: "no-candidate" as const };
      for (const range of releasedRanges(oldAppointment, appointment)) {
        const result = await reserveNextWaitlistOfferForOpportunity(tx, { barbershop: params.barbershop, staffId: oldAppointment.staffId, opportunityId: randomUUID(), opportunityStartsAt: range.startsAt, opportunityEndsAt: range.endsAt, now, appOrigin });
        if (result.status === "offered") { waitlist = result; break; }
      }
      return { status: "ok" as const, appointment, managementUrl, waitlist };
    });
  } catch (error) {
    if (isAppointmentOverlapError(error)) return { status: "appointment-conflict" as const };
    throw error;
  }
}
