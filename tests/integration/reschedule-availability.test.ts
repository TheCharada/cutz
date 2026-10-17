import { createHash, randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, getPool } from "@/infrastructure/db/client";
import {
  appointments,
  barbershops,
  customers,
  notificationJobs,
  services,
  staffMembers,
  staffServices,
  timeOff,
  waitlistEntries,
  waitlistOffers,
  workingHours,
} from "@/infrastructure/db/schema";
import { FixedClock } from "@/shared/clock";
import {
  getRescheduleAvailabilityByCapability,
  rescheduleAppointmentByCapability,
} from "@/workflows/appointment-capability";

const db = getDb();
const appOrigin = "http://localhost:3000";
const clock = new FixedClock(new Date("2026-09-06T10:00:00.000Z"));

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createFixture() {
  const suffix = randomUUID().slice(0, 8);
  const [tenant] = await db
    .insert(barbershops)
    .values({
      name: `Reschedule ${suffix}`,
      slug: `reschedule-${suffix}`,
      timezone: "America/Sao_Paulo",
      bookingIntervalMinutes: 30,
      customerVerificationMode: "NONE",
      waitlistOfferTtlMinutes: 10,
      reminderOffsetMinutes: 1440,
    })
    .returning();
  const [customer] = await db
    .insert(customers)
    .values({
      barbershopId: tenant.id,
      name: "Reschedule Customer",
      phoneE164: `+5514${Math.floor(100000000 + Math.random() * 899999999)}`,
    })
    .returning();
  const [service] = await db
    .insert(services)
    .values({ barbershopId: tenant.id, name: "Long cut", durationMinutes: 60 })
    .returning();
  const [staffA] = await db
    .insert(staffMembers)
    .values({ barbershopId: tenant.id, name: "Barber A" })
    .returning();
  const [staffB] = await db
    .insert(staffMembers)
    .values({ barbershopId: tenant.id, name: "Barber B" })
    .returning();

  await db.insert(staffServices).values([
    { staffId: staffA.id, serviceId: service.id },
    { staffId: staffB.id, serviceId: service.id },
  ]);
  await db.insert(workingHours).values([
    { staffId: staffA.id, weekday: 1, startsAt: "08:00", endsAt: "12:00" },
    { staffId: staffB.id, weekday: 1, startsAt: "08:00", endsAt: "12:00" },
  ]);

  return { tenant, customer, service, staffA, staffB };
}

async function cleanFixture(fixture: Fixture) {
  await db.delete(notificationJobs).where(eq(notificationJobs.barbershopId, fixture.tenant.id));
  await db.delete(waitlistOffers).where(eq(waitlistOffers.barbershopId, fixture.tenant.id));
  await db.delete(waitlistEntries).where(eq(waitlistEntries.barbershopId, fixture.tenant.id));
  await db.delete(appointments).where(eq(appointments.barbershopId, fixture.tenant.id));
  await db
    .delete(timeOff)
    .where(inArray(timeOff.staffId, [fixture.staffA.id, fixture.staffB.id]));
  await db
    .delete(workingHours)
    .where(inArray(workingHours.staffId, [fixture.staffA.id, fixture.staffB.id]));
  await db
    .delete(staffServices)
    .where(inArray(staffServices.staffId, [fixture.staffA.id, fixture.staffB.id]));
  await db.delete(customers).where(eq(customers.barbershopId, fixture.tenant.id));
  await db
    .delete(staffMembers)
    .where(inArray(staffMembers.id, [fixture.staffA.id, fixture.staffB.id]));
  await db.delete(services).where(eq(services.barbershopId, fixture.tenant.id));
  await db.delete(barbershops).where(eq(barbershops.id, fixture.tenant.id));
}

async function createAppointment(
  fixture: Fixture,
  params: {
    token: string;
    staffId?: string;
    startsAt?: Date;
    status?: "SCHEDULED" | "COMPLETED" | "NO_SHOW";
  },
) {
  const startsAt = params.startsAt ?? new Date("2026-09-07T11:00:00.000Z");
  const [appointment] = await db
    .insert(appointments)
    .values({
      barbershopId: fixture.tenant.id,
      customerId: fixture.customer.id,
      staffId: params.staffId ?? fixture.staffA.id,
      serviceId: fixture.service.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + fixture.service.durationMinutes * 60_000),
      status: params.status ?? "SCHEDULED",
      managementTokenHash: createHash("sha256").update(params.token).digest("hex"),
    })
    .returning();

  return appointment;
}

describe("reschedule availability capability", () => {
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

  it("excludes only the current Appointment and lets POST accept a partially overlapping slot returned by GET", async () => {
    const oldToken = `partial-${randomUUID()}`;
    const oldAppointment = await createAppointment(fixture, { token: oldToken });

    const availability = await getRescheduleAvailabilityByCapability(
      {
        token: oldToken,
        staffId: fixture.staffA.id,
        date: "2026-09-07",
      },
      { database: db, clock },
    );

    expect(availability.status).toBe("ok");
    if (availability.status !== "ok") {
      throw new Error("expected reschedule availability");
    }
    const partialSlot = availability.slots.find(
      (slot) => slot.startsAt === "2026-09-07T11:30:00.000Z",
    );
    expect(partialSlot).toEqual({
      staffId: fixture.staffA.id,
      startsAt: "2026-09-07T11:30:00.000Z",
      endsAt: "2026-09-07T12:30:00.000Z",
    });

    const result = await rescheduleAppointmentByCapability(
      {
        token: oldToken,
        staffId: fixture.staffA.id,
        startsAt: new Date(partialSlot!.startsAt),
      },
      {
        database: db,
        clock,
        appOrigin,
        createManagementToken: () => `replacement-${randomUUID()}`,
      },
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("expected successful reschedule");
    }
    expect(result.appointment).toMatchObject({
      staffId: fixture.staffA.id,
      serviceId: fixture.service.id,
      customerId: fixture.customer.id,
      rescheduledFromId: oldAppointment.id,
    });
    expect(result.appointment.startsAt.toISOString()).toBe(partialSlot!.startsAt);
    expect(result.appointment.endsAt.toISOString()).toBe(partialSlot!.endsAt);

    const [storedOld] = await db
      .select({ status: appointments.status, cancellationKind: appointments.cancellationKind })
      .from(appointments)
      .where(eq(appointments.id, oldAppointment.id));
    expect(storedOld).toEqual({ status: "CANCELLED", cancellationKind: "RESCHEDULED" });
  });

  it("keeps other Appointments, TimeOff and PENDING waitlist offers as blockers", async () => {
    const token = `blocked-${randomUUID()}`;
    await createAppointment(fixture, { token });
    await createAppointment(fixture, {
      token: `other-${randomUUID()}`,
      startsAt: new Date("2026-09-07T12:30:00.000Z"),
    });
    await db.insert(timeOff).values({
      staffId: fixture.staffA.id,
      startsAt: new Date("2026-09-07T13:30:00.000Z"),
      endsAt: new Date("2026-09-07T14:00:00.000Z"),
    });
    const [entry] = await db
      .insert(waitlistEntries)
      .values({
        barbershopId: fixture.tenant.id,
        customerId: fixture.customer.id,
        serviceId: fixture.service.id,
        staffId: fixture.staffA.id,
        desiredDate: "2026-09-07",
        earliestTime: "11:00",
        latestTime: "12:00",
        managementTokenHash: randomUUID(),
      })
      .returning();
    await db.insert(waitlistOffers).values({
      barbershopId: fixture.tenant.id,
      waitlistEntryId: entry.id,
      staffId: fixture.staffA.id,
      startsAt: new Date("2026-09-07T14:00:00.000Z"),
      endsAt: new Date("2026-09-07T15:00:00.000Z"),
      expiresAt: new Date("2026-09-07T14:30:00.000Z"),
      actionTokenHash: randomUUID(),
      opportunityId: randomUUID(),
      opportunityStartsAt: new Date("2026-09-07T14:00:00.000Z"),
      opportunityEndsAt: new Date("2026-09-07T15:00:00.000Z"),
      createdAt: new Date("2026-09-06T12:00:00.000Z"),
    });

    const availability = await getRescheduleAvailabilityByCapability(
      { token, staffId: fixture.staffA.id, date: "2026-09-07" },
      { database: db, clock },
    );

    expect(availability.status).toBe("ok");
    if (availability.status !== "ok") {
      throw new Error("expected reschedule availability");
    }
    const starts = availability.slots.map((slot) => slot.startsAt);
    expect(starts).toContain("2026-09-07T11:30:00.000Z");
    expect(starts).not.toContain("2026-09-07T12:00:00.000Z");
    expect(starts).not.toContain("2026-09-07T12:30:00.000Z");
    expect(starts).not.toContain("2026-09-07T13:30:00.000Z");
    expect(starts).not.toContain("2026-09-07T14:00:00.000Z");
  });

  it("returns not-found for an invalid capability and conflict for a non-scheduled Appointment", async () => {
    await expect(
      getRescheduleAvailabilityByCapability(
        { token: `missing-${randomUUID()}`, staffId: fixture.staffA.id, date: "2026-09-07" },
        { database: db, clock },
      ),
    ).resolves.toEqual({ status: "not-found" });

    const terminalToken = `terminal-${randomUUID()}`;
    await createAppointment(fixture, { token: terminalToken, status: "COMPLETED" });
    await expect(
      getRescheduleAvailabilityByCapability(
        { token: terminalToken, staffId: fixture.staffA.id, date: "2026-09-07" },
        { database: db, clock },
      ),
    ).resolves.toEqual({ status: "terminal-conflict" });
  });
});
