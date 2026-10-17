import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, getPool } from "@/infrastructure/db/client";
import { appointments, barbershops, customers, services, staffMembers } from "@/infrastructure/db/schema";
import type { BarbershopContext } from "@/modules/barbershops";
import { FixedClock } from "@/shared/clock";
import { hashOpaqueToken } from "@/shared/tokens";
import { completeAdminAppointment } from "@/workflows/admin-appointment-completion";

const db = getDb();

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createFixture() {
  const suffix = randomUUID().slice(0, 8);
  const [tenant] = await db.insert(barbershops).values({
    name: `Early completion ${suffix}`,
    slug: `early-completion-${suffix}`,
    timezone: "America/Sao_Paulo",
    bookingIntervalMinutes: 30,
    customerVerificationMode: "NONE",
    waitlistOfferTtlMinutes: 10,
    reminderOffsetMinutes: 60,
  }).returning();
  const [customer] = await db.insert(customers).values({
    barbershopId: tenant.id,
    name: "Cliente",
    phoneE164: `+55149${Math.floor(10000000 + Math.random() * 89999999)}`,
  }).returning();
  const [service] = await db.insert(services).values({
    barbershopId: tenant.id,
    name: "Corte",
    durationMinutes: 30,
  }).returning();
  const [staff] = await db.insert(staffMembers).values({
    barbershopId: tenant.id,
    name: "Profissional",
  }).returning();

  const barbershop: BarbershopContext = {
    id: tenant.id,
    slug: tenant.slug,
    timezone: tenant.timezone,
    bookingIntervalMinutes: tenant.bookingIntervalMinutes,
    customerVerificationMode: tenant.customerVerificationMode,
    waitlistOfferTtlMinutes: tenant.waitlistOfferTtlMinutes,
    reminderOffsetMinutes: tenant.reminderOffsetMinutes,
  };

  return { tenant, customer, service, staff, barbershop };
}

async function createAppointment(fixture: Fixture, startsAt: string) {
  const start = new Date(startsAt);
  const [appointment] = await db.insert(appointments).values({
    barbershopId: fixture.tenant.id,
    customerId: fixture.customer.id,
    staffId: fixture.staff.id,
    serviceId: fixture.service.id,
    startsAt: start,
    endsAt: new Date(start.getTime() + 30 * 60_000),
    managementTokenHash: hashOpaqueToken(`early-${randomUUID()}`),
  }).returning();
  return appointment;
}

async function cleanFixture(fixture: Fixture) {
  await db.delete(appointments).where(eq(appointments.barbershopId, fixture.tenant.id));
  await db.delete(customers).where(eq(customers.barbershopId, fixture.tenant.id));
  await db.delete(staffMembers).where(eq(staffMembers.barbershopId, fixture.tenant.id));
  await db.delete(services).where(eq(services.barbershopId, fixture.tenant.id));
  await db.delete(barbershops).where(eq(barbershops.id, fixture.tenant.id));
}

describe("early admin completion", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await createFixture();
  });

  afterEach(async () => {
    await cleanFixture(fixture);
  });

  afterAll(async () => {
    await getPool().end();
  });

  it("allows COMPLETED before startsAt when both instants are on the same tenant-local day", async () => {
    const appointment = await createAppointment(fixture, "2026-09-10T18:30:00.000Z");
    const now = new Date("2026-09-10T17:00:00.000Z");
    const result = await completeAdminAppointment(
      { barbershop: fixture.barbershop, appointmentId: appointment.id },
      { database: db, clock: new FixedClock(now) },
    );

    expect(result).toMatchObject({
      status: "ok",
      appointment: { status: "COMPLETED" },
    });
    const [stored] = await db
      .select({ status: appointments.status, updatedAt: appointments.updatedAt })
      .from(appointments)
      .where(eq(appointments.id, appointment.id));
    expect(stored).toEqual({ status: "COMPLETED", updatedAt: now });
  });

  it("does not allow completing an appointment from a future tenant-local day", async () => {
    const appointment = await createAppointment(fixture, "2026-09-11T12:00:00.000Z");
    const result = await completeAdminAppointment(
      { barbershop: fixture.barbershop, appointmentId: appointment.id },
      { database: db, clock: new FixedClock(new Date("2026-09-10T20:00:00.000Z")) },
    );

    expect(result.status).toBe("appointment-conflict");
  });

  it("keeps terminal appointments terminal", async () => {
    const appointment = await createAppointment(fixture, "2026-09-10T18:30:00.000Z");
    const clock = new FixedClock(new Date("2026-09-10T17:00:00.000Z"));
    const first = await completeAdminAppointment(
      { barbershop: fixture.barbershop, appointmentId: appointment.id },
      { database: db, clock },
    );
    expect(first.status).toBe("ok");

    const retry = await completeAdminAppointment(
      { barbershop: fixture.barbershop, appointmentId: appointment.id },
      { database: db, clock },
    );
    expect(retry.status).toBe("appointment-conflict");
  });
});
