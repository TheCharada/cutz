import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { DbExecutor } from "@/infrastructure/db/executor";
import { appointmentServices, services } from "@/infrastructure/db/schema";

export type BookedServiceSnapshot = {
  serviceNameSnapshot: string;
  durationMinutesSnapshot: number | null;
  unitPriceCents: number | null;
  historicalSnapshotComplete: boolean;
};

export async function insertBookedService(
  executor: DbExecutor,
  params: {
    barbershopId: string;
    appointmentId: string;
    serviceId: string;
    snapshot?: BookedServiceSnapshot;
  },
) {
  let snapshot = params.snapshot;
  if (!snapshot) {
    const [service] = await executor.select({
      name: services.name,
      durationMinutes: services.durationMinutes,
      priceCents: services.priceCents,
    }).from(services).where(and(
      eq(services.barbershopId, params.barbershopId),
      eq(services.id, params.serviceId),
    )).limit(1);
    if (!service) throw new Error("Booked appointment references a missing service");
    snapshot = {
      serviceNameSnapshot: service.name,
      durationMinutesSnapshot: service.durationMinutes,
      unitPriceCents: service.priceCents,
      historicalSnapshotComplete: true,
    };
  }
  const [item] = await executor.insert(appointmentServices).values({
    barbershopId: params.barbershopId,
    appointmentId: params.appointmentId,
    serviceId: params.serviceId,
    kind: "BOOKED",
    ...snapshot,
  }).returning();
  return item;
}

export function listAppointmentServiceRecords(
  executor: DbExecutor,
  barbershopId: string,
  appointmentId: string,
) {
  return executor.select().from(appointmentServices).where(and(
    eq(appointmentServices.barbershopId, barbershopId),
    eq(appointmentServices.appointmentId, appointmentId),
  )).orderBy(asc(appointmentServices.createdAt), asc(appointmentServices.id));
}

export async function listBookedServiceRecords(
  executor: DbExecutor,
  barbershopId: string,
  appointmentIds: string[],
) {
  if (appointmentIds.length === 0) return [];
  return executor.select({
    appointmentId: appointmentServices.appointmentId,
    serviceNameSnapshot: appointmentServices.serviceNameSnapshot,
    durationMinutesSnapshot: appointmentServices.durationMinutesSnapshot,
    unitPriceCents: appointmentServices.unitPriceCents,
    historicalSnapshotComplete: appointmentServices.historicalSnapshotComplete,
  }).from(appointmentServices).where(and(
    eq(appointmentServices.barbershopId, barbershopId),
    inArray(appointmentServices.appointmentId, appointmentIds),
    eq(appointmentServices.kind, "BOOKED"),
  ));
}

export async function getBookedServiceRecord(
  executor: DbExecutor,
  barbershopId: string,
  appointmentId: string,
) {
  const [record] = await executor.select().from(appointmentServices).where(and(
    eq(appointmentServices.barbershopId, barbershopId),
    eq(appointmentServices.appointmentId, appointmentId),
    eq(appointmentServices.kind, "BOOKED"),
  )).limit(1);
  return record ?? null;
}

export async function findAdditionalServiceByOperation(
  executor: DbExecutor,
  barbershopId: string,
  appointmentId: string,
  operationId: string,
) {
  const [record] = await executor.select().from(appointmentServices).where(and(
    eq(appointmentServices.barbershopId, barbershopId),
    eq(appointmentServices.appointmentId, appointmentId),
    eq(appointmentServices.operationId, operationId),
  )).limit(1);
  return record ?? null;
}

export async function addAdditionalServiceRecord(
  executor: DbExecutor,
  params: {
    barbershopId: string;
    appointmentId: string;
    serviceId: string;
    serviceNameSnapshot: string;
    durationMinutesSnapshot: number;
    unitPriceCents: number | null;
    performedAt: Date | null;
    priceAdjustmentReason: string | null;
    operationId: string;
    createdByUserId: string;
    now: Date;
  },
) {
  const [item] = await executor.insert(appointmentServices).values({
    barbershopId: params.barbershopId,
    appointmentId: params.appointmentId,
    serviceId: params.serviceId,
    kind: "ADDITIONAL",
    serviceNameSnapshot: params.serviceNameSnapshot,
    durationMinutesSnapshot: params.durationMinutesSnapshot,
    unitPriceCents: params.unitPriceCents,
    performedAt: params.performedAt,
    priceAdjustmentReason: params.priceAdjustmentReason,
    operationId: params.operationId,
    createdByUserId: params.createdByUserId,
    createdAt: params.now,
  }).returning();
  return item;
}

export async function hasAdditionalServiceRecords(
  executor: DbExecutor,
  barbershopId: string,
  appointmentId: string,
) {
  const [record] = await executor.select({ id: appointmentServices.id })
    .from(appointmentServices).where(and(
      eq(appointmentServices.barbershopId, barbershopId),
      eq(appointmentServices.appointmentId, appointmentId),
      eq(appointmentServices.kind, "ADDITIONAL"),
      isNull(appointmentServices.voidedAt),
    )).limit(1);
  return Boolean(record);
}

export function markBookedServicePerformed(
  executor: DbExecutor,
  params: { barbershopId: string; appointmentId: string; now: Date },
) {
  return executor.update(appointmentServices).set({ performedAt: params.now })
    .where(and(
      eq(appointmentServices.barbershopId, params.barbershopId),
      eq(appointmentServices.appointmentId, params.appointmentId),
      eq(appointmentServices.kind, "BOOKED"),
      isNull(appointmentServices.performedAt),
    ));
}

export async function voidAdditionalServiceRecord(
  executor: DbExecutor,
  params: {
    barbershopId: string;
    appointmentId: string;
    itemId: string;
    userId: string;
    reason: string;
    now: Date;
  },
) {
  const [item] = await executor.update(appointmentServices)
    .set({
      voidedAt: params.now,
      voidedByUserId: params.userId,
      voidReason: params.reason,
    }).where(and(
      eq(appointmentServices.barbershopId, params.barbershopId),
      eq(appointmentServices.appointmentId, params.appointmentId),
      eq(appointmentServices.id, params.itemId),
      eq(appointmentServices.kind, "ADDITIONAL"),
      isNull(appointmentServices.voidedAt),
    )).returning();
  return item ?? null;
}

export async function findAppointmentServiceById(
  executor: DbExecutor,
  barbershopId: string,
  appointmentId: string,
  itemId: string,
) {
  const [item] = await executor.select().from(appointmentServices).where(and(
    eq(appointmentServices.barbershopId, barbershopId),
    eq(appointmentServices.appointmentId, appointmentId),
    eq(appointmentServices.id, itemId),
  )).limit(1);
  return item ?? null;
}
