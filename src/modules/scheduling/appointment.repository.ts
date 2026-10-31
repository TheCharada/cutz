import { and, asc, count, desc, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";
import type { DbExecutor } from "@/infrastructure/db/executor";
import { appointments } from "@/infrastructure/db/schema";
import { insertBookedService, type BookedServiceSnapshot } from "./appointment-services.repository";

const appointmentSelection = {
  id: appointments.id,
  barbershopId: appointments.barbershopId,
  customerId: appointments.customerId,
  staffId: appointments.staffId,
  serviceId: appointments.serviceId,
  startsAt: appointments.startsAt,
  endsAt: appointments.endsAt,
  status: appointments.status,
  cancelledAt: appointments.cancelledAt,
  cancelledBy: appointments.cancelledBy,
  cancellationKind: appointments.cancellationKind,
  cancellationReason: appointments.cancellationReason,
  rescheduledFromId: appointments.rescheduledFromId,
};

export async function lockAppointmentCreationForCustomer(
  executor: DbExecutor,
  barbershopId: string,
  customerId: string,
) {
  await executor.execute(
    sql`select pg_advisory_xact_lock(hashtext(${barbershopId}), hashtext(${`appointment:${customerId}`}))`,
  );
}

export async function countFutureScheduledAppointmentsForCustomer(
  executor: DbExecutor,
  params: { barbershopId: string; customerId: string; after: Date },
) {
  const [row] = await executor
    .select({ value: count() })
    .from(appointments)
    .where(
      and(
        eq(appointments.barbershopId, params.barbershopId),
        eq(appointments.customerId, params.customerId),
        eq(appointments.status, "SCHEDULED"),
        gt(appointments.startsAt, params.after),
      ),
    );
  return row.value;
}

export async function findAppointmentById(executor: DbExecutor, barbershopId: string, appointmentId: string) {
  const [row] = await executor.select(appointmentSelection).from(appointments).where(and(eq(appointments.barbershopId, barbershopId), eq(appointments.id, appointmentId))).limit(1);
  return row ?? null;
}

export async function lockAppointmentById(executor: DbExecutor, barbershopId: string, appointmentId: string) {
  const [row] = await executor.select(appointmentSelection).from(appointments).where(and(eq(appointments.barbershopId, barbershopId), eq(appointments.id, appointmentId))).limit(1).for("update");
  return row ?? null;
}

export function listAppointmentsInRange(executor: DbExecutor, params: { barbershopId: string; rangeStartsAt: Date; rangeEndsAt: Date }) {
  return executor.select(appointmentSelection).from(appointments).where(and(eq(appointments.barbershopId, params.barbershopId), lt(appointments.startsAt, params.rangeEndsAt), gt(appointments.endsAt, params.rangeStartsAt))).orderBy(asc(appointments.startsAt), asc(appointments.id));
}

export function listAppointmentsByCustomer(executor: DbExecutor, barbershopId: string, customerId: string) {
  return executor.select(appointmentSelection).from(appointments).where(and(eq(appointments.barbershopId, barbershopId), eq(appointments.customerId, customerId))).orderBy(desc(appointments.startsAt), desc(appointments.id));
}

export function listFutureScheduledAppointmentsForStaff(executor: DbExecutor, params: { barbershopId: string; staffId: string; after: Date }) {
  return executor.select({ id: appointments.id, startsAt: appointments.startsAt, endsAt: appointments.endsAt }).from(appointments).where(and(eq(appointments.barbershopId, params.barbershopId), eq(appointments.staffId, params.staffId), eq(appointments.status, "SCHEDULED"), gt(appointments.startsAt, params.after))).orderBy(asc(appointments.startsAt), asc(appointments.id));
}

export async function findAppointmentByManagementTokenHash(executor: DbExecutor, tokenHash: string) {
  const [row] = await executor.select(appointmentSelection).from(appointments).where(eq(appointments.managementTokenHash, tokenHash)).limit(1);
  return row ?? null;
}

export async function lockAppointmentByManagementTokenHash(executor: DbExecutor, tokenHash: string) {
  const [row] = await executor.select(appointmentSelection).from(appointments).where(eq(appointments.managementTokenHash, tokenHash)).limit(1).for("update");
  return row ?? null;
}

export async function findScheduledAppointmentBlocks(executor: DbExecutor, params: { barbershopId: string; staffIds: string[]; rangeStartsAt: Date; rangeEndsAt: Date; excludeAppointmentId?: string }) {
  if (params.staffIds.length === 0) return [];
  const conditions = [eq(appointments.barbershopId, params.barbershopId), eq(appointments.status, "SCHEDULED"), inArray(appointments.staffId, params.staffIds), lt(appointments.startsAt, params.rangeEndsAt), gt(appointments.endsAt, params.rangeStartsAt)];
  if (params.excludeAppointmentId) conditions.push(ne(appointments.id, params.excludeAppointmentId));
  return executor.select({ staffId: appointments.staffId, startsAt: appointments.startsAt, endsAt: appointments.endsAt }).from(appointments).where(and(...conditions)).orderBy(asc(appointments.staffId), asc(appointments.startsAt));
}

export async function insertScheduledAppointment(executor: DbExecutor, params: { barbershopId: string; customerId: string; staffId: string; serviceId: string; startsAt: Date; endsAt: Date; managementTokenHash: string; rescheduledFromId?: string; bookedSnapshot?: BookedServiceSnapshot }) {
  const { bookedSnapshot, ...details } = params;
  const [row] = await executor.insert(appointments).values(details).returning(appointmentSelection);
  await insertBookedService(executor, {
    barbershopId: row.barbershopId,
    appointmentId: row.id,
    serviceId: row.serviceId,
    snapshot: bookedSnapshot,
  });
  return row;
}

export async function updateScheduledAppointmentAsCancelled(executor: DbExecutor, params: { appointmentId: string; cancelledAt: Date; cancelledBy: "CUSTOMER" | "STAFF"; cancellationKind: "CANCELLATION" | "RESCHEDULED"; cancellationReason?: string }) {
  const [row] = await executor.update(appointments).set({ status: "CANCELLED", cancelledAt: params.cancelledAt, cancelledBy: params.cancelledBy, cancellationKind: params.cancellationKind, cancellationReason: params.cancellationReason ?? null, updatedAt: params.cancelledAt }).where(and(eq(appointments.id, params.appointmentId), eq(appointments.status, "SCHEDULED"))).returning(appointmentSelection);
  return row ?? null;
}

export async function updateScheduledAppointmentStatus(executor: DbExecutor, params: { barbershopId: string; appointmentId: string; status: "COMPLETED" | "NO_SHOW"; now: Date }) {
  const [row] = await executor.update(appointments).set({ status: params.status, updatedAt: params.now }).where(and(eq(appointments.barbershopId, params.barbershopId), eq(appointments.id, params.appointmentId), eq(appointments.status, "SCHEDULED"))).returning(appointmentSelection);
  return row ?? null;
}
