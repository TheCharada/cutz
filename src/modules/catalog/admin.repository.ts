import { and, asc, eq, inArray } from "drizzle-orm";
import type { DbExecutor } from "@/infrastructure/db/executor";
import { services, staffMembers, staffServices, timeOff, workingHours } from "@/infrastructure/db/schema";

export function listAdminServices(executor: DbExecutor, barbershopId: string) {
  return executor.select().from(services).where(eq(services.barbershopId, barbershopId)).orderBy(asc(services.name), asc(services.id));
}

export async function insertAdminService(executor: DbExecutor, params: {
  barbershopId: string; name: string; durationMinutes: number; priceCents?: number | null;
}) {
  const [row] = await executor.insert(services).values(params).returning();
  return row;
}

export async function updateAdminService(executor: DbExecutor, params: {
  barbershopId: string; serviceId: string; name?: string; durationMinutes?: number; priceCents?: number | null; active?: boolean; now: Date;
}) {
  const set = { updatedAt: params.now } as Record<string, unknown>;
  if (params.name !== undefined) set.name = params.name;
  if (params.durationMinutes !== undefined) set.durationMinutes = params.durationMinutes;
  if (params.priceCents !== undefined) set.priceCents = params.priceCents;
  if (params.active !== undefined) set.active = params.active;
  const [row] = await executor.update(services).set(set).where(and(eq(services.barbershopId, params.barbershopId), eq(services.id, params.serviceId))).returning();
  return row ?? null;
}

export function listAdminStaff(executor: DbExecutor, barbershopId: string) {
  return executor.select().from(staffMembers).where(eq(staffMembers.barbershopId, barbershopId)).orderBy(asc(staffMembers.name), asc(staffMembers.id));
}

export async function insertAdminStaff(executor: DbExecutor, params: {
  barbershopId: string; name: string; userId?: string | null; active?: boolean; acceptsAppointments?: boolean;
}) {
  const [row] = await executor.insert(staffMembers).values(params).returning();
  return row;
}

export async function updateAdminStaff(executor: DbExecutor, params: {
  barbershopId: string; staffId: string; name?: string; userId?: string | null; active?: boolean; acceptsAppointments?: boolean; now: Date;
}) {
  const set = { updatedAt: params.now } as Record<string, unknown>;
  if (params.name !== undefined) set.name = params.name;
  if (params.userId !== undefined) set.userId = params.userId;
  if (params.active !== undefined) set.active = params.active;
  if (params.acceptsAppointments !== undefined) set.acceptsAppointments = params.acceptsAppointments;
  const [row] = await executor.update(staffMembers).set(set).where(and(eq(staffMembers.barbershopId, params.barbershopId), eq(staffMembers.id, params.staffId))).returning();
  return row ?? null;
}

export function listTenantServicesByIds(executor: DbExecutor, barbershopId: string, serviceIds: string[]) {
  if (serviceIds.length === 0) return Promise.resolve([]);
  return executor.select({ id: services.id }).from(services).where(and(eq(services.barbershopId, barbershopId), inArray(services.id, serviceIds)));
}

export async function replaceStaffServices(executor: DbExecutor, staffId: string, serviceIds: string[]) {
  await executor.delete(staffServices).where(eq(staffServices.staffId, staffId));
  if (serviceIds.length > 0) await executor.insert(staffServices).values(serviceIds.map((serviceId) => ({ staffId, serviceId })));
}

export function listStaffServiceIds(executor: DbExecutor, staffId: string) {
  return executor.select({ serviceId: staffServices.serviceId }).from(staffServices).where(eq(staffServices.staffId, staffId)).orderBy(asc(staffServices.serviceId));
}

export function listAllWorkingHours(executor: DbExecutor, staffId: string) {
  return executor.select().from(workingHours).where(eq(workingHours.staffId, staffId)).orderBy(asc(workingHours.weekday), asc(workingHours.startsAt), asc(workingHours.id));
}

export async function replaceWorkingHours(executor: DbExecutor, staffId: string, hours: Array<{ weekday: number; startsAt: string; endsAt: string }>) {
  await executor.delete(workingHours).where(eq(workingHours.staffId, staffId));
  if (hours.length > 0) await executor.insert(workingHours).values(hours.map((row) => ({ staffId, ...row })));
}

export function listStaffTimeOff(executor: DbExecutor, staffId: string) {
  return executor.select().from(timeOff).where(eq(timeOff.staffId, staffId)).orderBy(asc(timeOff.startsAt), asc(timeOff.id));
}

export async function insertTimeOff(executor: DbExecutor, params: { staffId: string; startsAt: Date; endsAt: Date; reason?: string }) {
  const [row] = await executor.insert(timeOff).values({ ...params, reason: params.reason ?? null }).returning();
  return row;
}

export async function deleteTenantTimeOff(executor: DbExecutor, params: { staffId: string; timeOffId: string }) {
  const [row] = await executor
    .delete(timeOff)
    .where(and(eq(timeOff.id, params.timeOffId), eq(timeOff.staffId, params.staffId)))
    .returning({ id: timeOff.id });
  return row ?? null;
}
