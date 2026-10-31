import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, getPool } from "@/infrastructure/db/client";
import {
  appointmentServices, appointments, barbershops, customers, notificationJobs,
  services, staffMembers, staffServices, users, workingHours,
} from "@/infrastructure/db/schema";
import type { BarbershopContext } from "@/modules/barbershops";
import { FixedClock } from "@/shared/clock";
import { createAdminAppointment, cancelAdminAppointment, finishAdminAppointment, rescheduleAdminAppointment } from "@/workflows/admin-appointments";
import { completeAdminAppointment } from "@/workflows/admin-appointment-completion";
import {
  getAdminAppointmentServices, recordAdminAppointmentService, voidAdminAppointmentService,
} from "@/workflows/admin-appointment-services";

const db = getDb();
const appOrigin = "http://127.0.0.1:3000";
const initialClock = new FixedClock(new Date("2026-09-07T10:00:00.000Z"));
const serviceClock = new FixedClock(new Date("2026-09-07T12:30:00.000Z"));

function context(tenant: typeof barbershops.$inferSelect): BarbershopContext {
  return {
    id: tenant.id, slug: tenant.slug, timezone: tenant.timezone,
    bookingIntervalMinutes: tenant.bookingIntervalMinutes,
    customerVerificationMode: tenant.customerVerificationMode,
    waitlistOfferTtlMinutes: tenant.waitlistOfferTtlMinutes,
    reminderOffsetMinutes: tenant.reminderOffsetMinutes,
  };
}

async function fixture() {
  const key = randomUUID().slice(0, 8);
  const [tenant, otherTenant] = await db.insert(barbershops).values([
    { name: "Services A", slug: `services-a-${key}`, timezone: "America/Sao_Paulo",
      bookingIntervalMinutes: 30, customerVerificationMode: "NONE",
      waitlistOfferTtlMinutes: 10, reminderOffsetMinutes: 60 },
    { name: "Services B", slug: `services-b-${key}`, timezone: "America/Sao_Paulo",
      bookingIntervalMinutes: 30, customerVerificationMode: "NONE",
      waitlistOfferTtlMinutes: 10, reminderOffsetMinutes: 60 },
  ]).returning();
  const [customer] = await db.insert(customers).values({
    barbershopId: tenant.id, name: "Cliente", phoneE164: `+55149${Math.floor(10000000 + Math.random() * 89999999)}`,
  }).returning();
  const [booked, extra, foreign] = await db.insert(services).values([
    { barbershopId: tenant.id, name: "Corte", durationMinutes: 30, priceCents: 3500 },
    { barbershopId: tenant.id, name: "Barba", durationMinutes: 20, priceCents: 2500 },
    { barbershopId: otherTenant.id, name: "Outro serviço", durationMinutes: 30, priceCents: 9000 },
  ]).returning();
  const [staff] = await db.insert(staffMembers).values({
    barbershopId: tenant.id, name: "Profissional",
  }).returning();
  await db.insert(staffServices).values({ staffId: staff.id, serviceId: booked.id });
  await db.insert(workingHours).values({
    staffId: staff.id, weekday: 1, startsAt: "09:00", endsAt: "18:00",
  });
  const [user] = await db.insert(users).values({
    email: `services-${key}@example.test`, passwordHash: "test-hash",
  }).returning();
  const barbershop = context(tenant);

  async function book(start = "2026-09-07T12:00:00.000Z") {
    const result = await createAdminAppointment({
      barbershop, customerId: customer.id, staffId: staff.id,
      serviceId: booked.id, startsAt: new Date(start),
    }, { database: db, clock: initialClock, appOrigin });
    if (result.status !== "ok") throw new Error(`Unexpected booking result: ${result.status}`);
    return result.appointment;
  }

  async function clean() {
    await db.delete(notificationJobs).where(eq(notificationJobs.barbershopId, tenant.id));
    await db.delete(appointments).where(eq(appointments.barbershopId, tenant.id));
    await db.delete(workingHours).where(eq(workingHours.staffId, staff.id));
    await db.delete(staffServices).where(eq(staffServices.staffId, staff.id));
    await db.delete(staffMembers).where(eq(staffMembers.id, staff.id));
    await db.delete(services).where(inArray(services.id, [booked.id, extra.id, foreign.id]));
    await db.delete(customers).where(eq(customers.barbershopId, tenant.id));
    await db.delete(users).where(eq(users.id, user.id));
    await db.delete(barbershops).where(inArray(barbershops.id, [tenant.id, otherTenant.id]));
  }

  return { tenant, otherTenant, barbershop, customer, booked, extra, foreign, user, book, clean };
}

describe("appointment service records", () => {
  let f: Awaited<ReturnType<typeof fixture>>;

  beforeEach(async () => { f = await fixture(); });
  afterEach(async () => { await f.clean(); });
  afterAll(async () => { await getPool().end(); });

  async function add(appointmentId: string, overrides: Partial<Parameters<typeof recordAdminAppointmentService>[0]> = {}) {
    return recordAdminAppointmentService({
      barbershop: f.barbershop, appointmentId,
      serviceId: f.extra.id, unitPriceCents: 2500,
      performedAt: new Date("2026-09-07T12:20:00.000Z"),
      priceAdjustmentReason: null, operationId: randomUUID(),
      userId: f.user.id, ...overrides,
    }, { database: db, clock: serviceClock });
  }

  it("takes an original price snapshot and records extra work after completion without changing the booking", async () => {
    const appointment = await f.book();
    const [booked] = await db.select().from(appointmentServices)
      .where(eq(appointmentServices.appointmentId, appointment.id));
    expect(booked).toMatchObject({
      kind: "BOOKED", serviceId: f.booked.id,
      serviceNameSnapshot: "Corte", durationMinutesSnapshot: 30,
      unitPriceCents: 3500, historicalSnapshotComplete: true,
    });

    const completed = await completeAdminAppointment({
      barbershop: f.barbershop, appointmentId: appointment.id,
    }, { database: db, clock: serviceClock });
    expect(completed.status).toBe("ok");
    const result = await add(appointment.id);
    expect(result.status).toBe("ok");

    await db.update(services).set({ priceCents: 6000 }).where(eq(services.id, f.extra.id));
    await db.update(services).set({ priceCents: 4200 }).where(eq(services.id, f.booked.id));

    const detail = await getAdminAppointmentServices({
      barbershop: f.barbershop, appointmentId: appointment.id,
    }, { database: db, clock: serviceClock });
    expect(detail.status).toBe("ok");
    if (detail.status !== "ok") throw new Error("No appointment detail");
    expect(detail.items.map((item) => item.unitPriceCents)).toEqual([3500, 2500]);
    expect(detail.totals).toEqual({ knownAmountCents: 6000, hasUnknownPrices: false });

    const [stored] = await db.select().from(appointments).where(eq(appointments.id, appointment.id));
    expect(stored.status).toBe("COMPLETED");
    expect(stored.startsAt).toEqual(appointment.startsAt);
    expect(stored.endsAt).toEqual(appointment.endsAt);
    expect(stored.serviceId).toBe(f.booked.id);
  });

  it("does not duplicate a service when the same request is retried", async () => {
    const appointment = await f.book();
    const operationId = randomUUID();
    expect((await add(appointment.id, { operationId })).status).toBe("ok");
    expect((await add(appointment.id, { operationId })).status).toBe("already-recorded");
    expect((await add(appointment.id, { operationId, unitPriceCents: 2300,
      priceAdjustmentReason: "Desconto aplicado" })).status).toBe("operation-conflict");
    const items = await db.select().from(appointmentServices)
      .where(eq(appointmentServices.appointmentId, appointment.id));
    expect(items).toHaveLength(2);
  });

  it("records a correction instead of erasing an additional service", async () => {
    const appointment = await f.book();
    const result = await add(appointment.id);
    if (result.status !== "ok") throw new Error("Expected additional service");

    const denied = await voidAdminAppointmentService({
      barbershop: f.barbershop, appointmentId: appointment.id,
      itemId: (await db.select().from(appointmentServices)
        .where(eq(appointmentServices.appointmentId, appointment.id)))
        .find((item) => item.kind === "BOOKED")!.id,
      userId: f.user.id, reason: "Lançamento errado",
    }, { database: db, clock: serviceClock });
    expect(denied.status).toBe("booked-service");

    const voided = await voidAdminAppointmentService({
      barbershop: f.barbershop, appointmentId: appointment.id,
      itemId: result.item.id, userId: f.user.id, reason: "Lançamento errado",
    }, { database: db, clock: serviceClock });
    expect(voided.status).toBe("ok");
    const detail = await getAdminAppointmentServices({
      barbershop: f.barbershop, appointmentId: appointment.id,
    }, { database: db });
    expect(detail.status).toBe("ok");
    if (detail.status !== "ok") throw new Error("Missing appointment");
    expect(detail.totals.knownAmountCents).toBe(3500);
    expect(detail.items.find((item) => item.id === result.item.id)?.voidReason).toBe("Lançamento errado");
    expect(detail.items).toHaveLength(2);
  });

  it("blocks cancel, no-show and reschedule while work has been recorded", async () => {
    const appointment = await f.book();
    expect((await add(appointment.id)).status).toBe("ok");
    const cancelled = await cancelAdminAppointment({
      barbershop: f.barbershop, appointmentId: appointment.id,
    }, { database: db, clock: serviceClock, appOrigin });
    expect(cancelled.status).toBe("appointment-conflict");

    const noShow = await finishAdminAppointment({
      barbershop: f.barbershop, appointmentId: appointment.id, status: "NO_SHOW",
    }, { database: db, clock: serviceClock });
    expect(noShow.status).toBe("appointment-conflict");

    const moved = await rescheduleAdminAppointment({
      barbershop: f.barbershop, appointmentId: appointment.id,
      staffId: f.staff.id, startsAt: new Date("2026-09-07T13:00:00.000Z"),
    }, { database: db, clock: serviceClock, appOrigin });
    expect(moved.status).toBe("appointment-conflict");
  });

  it("rejects foreign or inactive services, future appointments, and future completion times", async () => {
    const appointment = await f.book();
    const futureClock = new FixedClock(new Date("2026-09-07T11:00:00.000Z"));
    expect((await recordAdminAppointmentService({
      barbershop: f.barbershop, appointmentId: appointment.id,
      serviceId: f.extra.id, unitPriceCents: 2500, performedAt: null,
      priceAdjustmentReason: null, userId: f.user.id, operationId: randomUUID(),
    }, { database: db, clock: futureClock })).status).toBe("appointment-conflict");
    expect((await add(appointment.id, { serviceId: f.foreign.id })).status).toBe("service-not-found");
    expect((await add(appointment.id, { performedAt: new Date("2026-09-07T15:00:00.000Z") })).status)
      .toBe("invalid-performed-at");
    expect((await add(appointment.id, { unitPriceCents: 1800 })).status).toBe("price-reason-required");
    await db.update(services).set({ active: false }).where(eq(services.id, f.extra.id));
    expect((await add(appointment.id)).status).toBe("service-not-found");
  });

  it("preserves a booked price when an appointment is rescheduled", async () => {
    const appointment = await f.book();
    await db.update(services).set({ priceCents: 4500 }).where(eq(services.id, f.booked.id));
    const moved = await rescheduleAdminAppointment({
      barbershop: f.barbershop, appointmentId: appointment.id,
      staffId: f.staff.id, startsAt: new Date("2026-09-07T13:00:00.000Z"),
    }, { database: db, clock: initialClock, appOrigin });
    expect(moved.status).toBe("ok");
    if (moved.status !== "ok") throw new Error("Could not reschedule");
    const [booked] = await db.select().from(appointmentServices)
      .where(eq(appointmentServices.appointmentId, moved.appointment.id));
    expect(booked.unitPriceCents).toBe(3500);
  });

  it("does not expose another establishment's appointment services", async () => {
    const appointment = await f.book();
    const otherBarbershop = context({ ...f.tenant, id: f.otherTenant.id, slug: f.otherTenant.slug });
    expect((await getAdminAppointmentServices({
      barbershop: otherBarbershop, appointmentId: appointment.id,
    }, { database: db })).status).toBe("not-found");
    expect((await recordAdminAppointmentService({
      barbershop: otherBarbershop, appointmentId: appointment.id,
      serviceId: f.extra.id, unitPriceCents: 2500, performedAt: null,
      priceAdjustmentReason: null, userId: f.user.id, operationId: randomUUID(),
    }, { database: db, clock: serviceClock })).status).toBe("not-found");
  });
});
