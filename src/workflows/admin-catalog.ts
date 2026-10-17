import { getDb, type Database } from "@/infrastructure/db/client";
import {
  createAdminService,
  createAdminStaff,
  createStaffTimeOff,
  deleteStaffTimeOff,
  getAdminServices,
  getAdminStaff,
  getStaffServiceIds,
  getStaffSnapshot,
  getStaffTimeOff,
  getStaffWorkingHours,
  getTenantServicesByIds,
  lockStaffMembersForUpdate,
  patchAdminService,
  patchAdminStaff,
  setStaffServices,
  setStaffWorkingHours,
  validateWorkingHours,
} from "@/modules/catalog";
import { listFutureAppointmentsForStaff, listScheduledAppointmentBlocks } from "@/modules/scheduling";
import { SystemClock, type Clock } from "@/shared/clock";
import { localDateForInstant, weekdayForLocalDate } from "@/shared/time";

const systemClock = new SystemClock();
type WorkingHourInput = { weekday: number; startsAt: string; endsAt: string };

function localTimeForInstant(instant: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant);
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  if (!hour || !minute) throw new Error("Unable to derive local time");
  return `${hour}:${minute}`;
}

function appointmentFitsHours(appointment: { startsAt: Date; endsAt: Date }, timezone: string, hours: WorkingHourInput[]) {
  const startDate = localDateForInstant(appointment.startsAt, timezone);
  const endDate = localDateForInstant(new Date(appointment.endsAt.getTime() - 1), timezone);
  if (startDate !== endDate) return false;
  const weekday = weekdayForLocalDate(startDate);
  const startsAt = localTimeForInstant(appointment.startsAt, timezone);
  const endsAt = localTimeForInstant(appointment.endsAt, timezone);
  return hours.some((row) => row.weekday === weekday && row.startsAt <= startsAt && row.endsAt >= endsAt);
}

export async function listAdminCatalog(barbershopId: string, options: { database?: Database } = {}) {
  const database = options.database ?? getDb();
  const services = await getAdminServices(database, barbershopId);
  const staff = await getAdminStaff(database, barbershopId);
  return { services, staff };
}

export async function createServiceForAdmin(params: { barbershopId: string; name: string; durationMinutes: number; priceCents?: number | null }, options: { database?: Database } = {}) {
  return createAdminService(options.database ?? getDb(), { ...params, name: params.name.trim() });
}

export async function updateServiceForAdmin(params: { barbershopId: string; serviceId: string; name?: string; durationMinutes?: number; priceCents?: number | null; active?: boolean }, options: { database?: Database; clock?: Clock } = {}) {
  return patchAdminService(options.database ?? getDb(), { ...params, ...(params.name === undefined ? {} : { name: params.name.trim() }), now: (options.clock ?? systemClock).now() });
}

export async function createStaffForAdmin(params: { barbershopId: string; name: string; userId?: string | null; active?: boolean; acceptsAppointments?: boolean }, options: { database?: Database } = {}) {
  return createAdminStaff(options.database ?? getDb(), { ...params, name: params.name.trim() });
}

export async function updateStaffForAdmin(params: { barbershopId: string; staffId: string; name?: string; userId?: string | null; active?: boolean; acceptsAppointments?: boolean }, options: { database?: Database; clock?: Clock } = {}) {
  return patchAdminStaff(options.database ?? getDb(), { ...params, ...(params.name === undefined ? {} : { name: params.name.trim() }), now: (options.clock ?? systemClock).now() });
}

export async function replaceStaffServicesForAdmin(params: { barbershopId: string; staffId: string; serviceIds: string[] }, options: { database?: Database } = {}) {
  const database = options.database ?? getDb();
  const uniqueServiceIds = [...new Set(params.serviceIds)];
  return database.transaction(async (tx) => {
    const staff = await getStaffSnapshot(tx, params.barbershopId, params.staffId);
    if (!staff) return { status: "not-found" as const };
    const services = await getTenantServicesByIds(tx, params.barbershopId, uniqueServiceIds);
    if (services.length !== uniqueServiceIds.length) return { status: "validation-error" as const };
    await setStaffServices(tx, params.staffId, uniqueServiceIds);
    const rows = await getStaffServiceIds(tx, params.staffId);
    return { status: "ok" as const, serviceIds: rows.map((row) => row.serviceId) };
  });
}

export async function replaceWorkingHoursForAdmin(params: { barbershopId: string; staffId: string; timezone: string; hours: WorkingHourInput[] }, options: { database?: Database; clock?: Clock } = {}) {
  if (!validateWorkingHours(params.hours)) return { status: "validation-error" as const };
  const database = options.database ?? getDb();
  const now = (options.clock ?? systemClock).now();
  const normalized = [...params.hours].sort((a, b) => a.weekday - b.weekday || a.startsAt.localeCompare(b.startsAt));
  return database.transaction(async (tx) => {
    const locked = await lockStaffMembersForUpdate(tx, params.barbershopId, [params.staffId]);
    if (locked.length !== 1) return { status: "not-found" as const };
    const future = await listFutureAppointmentsForStaff(tx, { barbershopId: params.barbershopId, staffId: params.staffId, after: now });
    if (future.some((appointment) => !appointmentFitsHours(appointment, params.timezone, normalized))) return { status: "appointment-conflict" as const };
    await setStaffWorkingHours(tx, params.staffId, normalized);
    return { status: "ok" as const, hours: await getStaffWorkingHours(tx, params.staffId) };
  });
}

export async function createTimeOffForAdmin(params: { barbershopId: string; staffId: string; startsAt: Date; endsAt: Date; reason?: string }, options: { database?: Database } = {}) {
  if (params.endsAt <= params.startsAt) return { status: "validation-error" as const };
  const database = options.database ?? getDb();
  return database.transaction(async (tx) => {
    const locked = await lockStaffMembersForUpdate(tx, params.barbershopId, [params.staffId]);
    if (locked.length !== 1) return { status: "not-found" as const };
    const conflicts = await listScheduledAppointmentBlocks(tx, { barbershopId: params.barbershopId, staffIds: [params.staffId], rangeStartsAt: params.startsAt, rangeEndsAt: params.endsAt });
    if (conflicts.length > 0) return { status: "appointment-conflict" as const };
    const row = await createStaffTimeOff(tx, { staffId: params.staffId, startsAt: params.startsAt, endsAt: params.endsAt, reason: params.reason?.trim() || undefined });
    return { status: "ok" as const, timeOff: row };
  });
}

export async function deleteTimeOffForAdmin(params: { barbershopId: string; staffId: string; timeOffId: string }, options: { database?: Database } = {}) {
  const database = options.database ?? getDb();
  const staff = await getStaffSnapshot(database, params.barbershopId, params.staffId);
  if (!staff) return { status: "not-found" as const };
  const deleted = await deleteStaffTimeOff(database, { staffId: params.staffId, timeOffId: params.timeOffId });
  return deleted ? { status: "ok" as const } : { status: "not-found" as const };
}

export async function getStaffAdminConfiguration(params: { barbershopId: string; staffId: string }, options: { database?: Database } = {}) {
  const database = options.database ?? getDb();
  const staff = await getStaffSnapshot(database, params.barbershopId, params.staffId);
  if (!staff) return null;
  const serviceIds = (await getStaffServiceIds(database, params.staffId)).map((row) => row.serviceId);
  const hours = await getStaffWorkingHours(database, params.staffId);
  const off = await getStaffTimeOff(database, params.staffId);
  return { staff, serviceIds, hours, timeOff: off };
}
