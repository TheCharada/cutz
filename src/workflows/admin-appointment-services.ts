import { getDb, type Database } from "@/infrastructure/db/client";
import type { BarbershopContext } from "@/modules/barbershops";
import { getServiceSnapshot } from "@/modules/catalog";
import {
  addAdditionalServiceRecord,
  findAdditionalServiceByOperation,
  findAppointmentServiceById,
  getAppointmentById,
  listAppointmentServiceRecords,
  lockAppointmentForUpdate,
  voidAdditionalServiceRecord,
} from "@/modules/scheduling";
import { SystemClock, type Clock } from "@/shared/clock";

const systemClock = new SystemClock();

function summarize(items: Awaited<ReturnType<typeof listAppointmentServiceRecords>>) {
  const active = items.filter((item) => item.voidedAt === null);
  return {
    knownAmountCents: active.reduce((sum, item) => sum + (item.unitPriceCents ?? 0), 0),
    hasUnknownPrices: active.some((item) => item.unitPriceCents === null),
  };
}

export async function getAdminAppointmentServices(
  params: { barbershop: BarbershopContext; appointmentId: string },
  options: { database?: Database; clock?: Clock } = {},
) {
  const database = options.database ?? getDb();
  const appointment = await getAppointmentById(database, params.barbershop.id, params.appointmentId);
  if (!appointment) return { status: "not-found" as const };
  const items = await listAppointmentServiceRecords(database, params.barbershop.id, appointment.id);
  const now = (options.clock ?? systemClock).now();
  return {
    status: "ok" as const,
    appointment,
    items: [...items].sort((a, b) =>
      (a.kind === "BOOKED" ? 0 : 1) - (b.kind === "BOOKED" ? 0 : 1) ||
      a.createdAt.getTime() - b.createdAt.getTime(),
    ),
    totals: summarize(items),
    canAdd: appointment.status === "COMPLETED" ||
      (appointment.status === "SCHEDULED" && now >= appointment.startsAt),
  };
}

export async function recordAdminAppointmentService(
  params: {
    barbershop: BarbershopContext;
    appointmentId: string;
    serviceId: string;
    unitPriceCents: number | null;
    performedAt: Date | null;
    priceAdjustmentReason: string | null;
    operationId: string;
    userId: string;
  },
  options: { database?: Database; clock?: Clock } = {},
) {
  const database = options.database ?? getDb();
  const now = (options.clock ?? systemClock).now();

  return database.transaction(async (tx) => {
    const appointment = await lockAppointmentForUpdate(tx, params.barbershop.id, params.appointmentId);
    if (!appointment) return { status: "not-found" as const };

    const previous = await findAdditionalServiceByOperation(
      tx, params.barbershop.id, params.appointmentId, params.operationId,
    );
    if (previous) {
      const same = previous.voidedAt === null && previous.kind === "ADDITIONAL" &&
        previous.serviceId === params.serviceId &&
        previous.unitPriceCents === params.unitPriceCents &&
        previous.priceAdjustmentReason === params.priceAdjustmentReason &&
        (previous.performedAt?.getTime() ?? null) === (params.performedAt?.getTime() ?? null);
      return same
        ? { status: "already-recorded" as const, item: previous }
        : { status: "operation-conflict" as const };
    }

    if (appointment.status !== "COMPLETED" &&
        (appointment.status !== "SCHEDULED" || now < appointment.startsAt)) {
      return { status: "appointment-conflict" as const };
    }
    if (params.performedAt && params.performedAt > now) {
      return { status: "invalid-performed-at" as const };
    }

    const service = await getServiceSnapshot(tx, params.barbershop.id, params.serviceId);
    if (!service || !service.active) return { status: "service-not-found" as const };

    if (service.priceCents !== null && service.priceCents !== params.unitPriceCents &&
        !params.priceAdjustmentReason) {
      return { status: "price-reason-required" as const };
    }

    const item = await addAdditionalServiceRecord(tx, {
      barbershopId: params.barbershop.id,
      appointmentId: appointment.id,
      serviceId: service.id,
      serviceNameSnapshot: service.name,
      durationMinutesSnapshot: service.durationMinutes,
      unitPriceCents: params.unitPriceCents,
      priceAdjustmentReason: params.priceAdjustmentReason,
      performedAt: params.performedAt,
      operationId: params.operationId,
      createdByUserId: params.userId,
      now,
    });
    return { status: "ok" as const, item };
  });
}

export async function voidAdminAppointmentService(
  params: {
    barbershop: BarbershopContext;
    appointmentId: string;
    itemId: string;
    userId: string;
    reason: string;
  },
  options: { database?: Database; clock?: Clock } = {},
) {
  const database = options.database ?? getDb();
  const now = (options.clock ?? systemClock).now();

  return database.transaction(async (tx) => {
    const appointment = await lockAppointmentForUpdate(tx, params.barbershop.id, params.appointmentId);
    if (!appointment) return { status: "not-found" as const };
    const item = await findAppointmentServiceById(
      tx, params.barbershop.id, params.appointmentId, params.itemId,
    );
    if (!item) return { status: "not-found" as const };
    if (item.kind !== "ADDITIONAL") return { status: "booked-service" as const };
    if (item.voidedAt) return { status: "already-voided" as const, item };
    const updated = await voidAdditionalServiceRecord(tx, {
      barbershopId: params.barbershop.id,
      appointmentId: appointment.id,
      itemId: item.id,
      userId: params.userId,
      reason: params.reason,
      now,
    });
    if (!updated) return { status: "operation-conflict" as const };
    return { status: "ok" as const, item: updated };
  });
}
