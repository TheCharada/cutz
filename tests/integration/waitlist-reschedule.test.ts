import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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
  waitlistEntries,
  waitlistOffers,
  workingHours,
} from "@/infrastructure/db/schema";
import { FixedClock } from "@/shared/clock";
import { hashOpaqueToken } from "@/shared/tokens";
import { rescheduleAppointmentByCapability } from "@/workflows/appointment-capability";

const db = getDb();
const now = new FixedClock(new Date("2026-09-06T10:00:00.000Z"));
const oldStartsAt = new Date("2026-09-07T12:00:00.000Z");
const oldEndsAt = new Date("2026-09-07T13:00:00.000Z");
const newStartsAt = new Date("2026-09-07T12:30:00.000Z");

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createFixture() {
  const suffix = randomUUID().slice(0, 8);
  const [tenant] = await db
    .insert(barbershops)
    .values({
      name: `Reschedule waitlist ${suffix}`,
      slug: `reschedule-waitlist-${suffix}`,
      timezone: "America/Sao_Paulo",
      bookingIntervalMinutes: 30,
      customerVerificationMode: "NONE",
      waitlistOfferTtlMinutes: 10,
      reminderOffsetMinutes: 1440,
    })
    .returning();
  const [appointmentCustomer] = await db
    .insert(customers)
    .values({
      barbershopId: tenant.id,
      name: "Appointment customer",
      phoneE164: `+551499${Date.now()}`,
    })
    .returning();
  const [waitlistCustomer] = await db
    .insert(customers)
    .values({
      barbershopId: tenant.id,
      name: "Waitlist customer",
      phoneE164: `+551399${Date.now()}`,
    })
    .returning();
  const [appointmentService] = await db
    .insert(services)
    .values({ barbershopId: tenant.id, name: "Long service", durationMinutes: 60 })
    .returning();
  const [waitlistService] = await db
    .insert(services)
    .values({ barbershopId: tenant.id, name: "Short service", durationMinutes: 30 })
    .returning();
  const [staff] = await db
    .insert(staffMembers)
    .values({ barbershopId: tenant.id, name: "Barber" })
    .returning();
  await db.insert(staffServices).values([
    { staffId: staff.id, serviceId: appointmentService.id },
    { staffId: staff.id, serviceId: waitlistService.id },
  ]);
  await db.insert(workingHours).values({
    staffId: staff.id,
    weekday: 1,
    startsAt: "08:00",
    endsAt: "12:00",
  });

  const managementToken = `appointment-${randomUUID()}`;
  const [appointment] = await db
    .insert(appointments)
    .values({
      barbershopId: tenant.id,
      customerId: appointmentCustomer.id,
      staffId: staff.id,
      serviceId: appointmentService.id,
      startsAt: oldStartsAt,
      endsAt: oldEndsAt,
      managementTokenHash: hashOpaqueToken(managementToken),
    })
    .returning();
  const [entry] = await db
    .insert(waitlistEntries)
    .values({
      barbershopId: tenant.id,
      customerId: waitlistCustomer.id,
      serviceId: waitlistService.id,
      staffId: staff.id,
      desiredDate: "2026-09-07",
      earliestTime: "09:00",
      latestTime: "10:00",
      managementTokenHash: hashOpaqueToken(`entry-${randomUUID()}`),
      createdAt: new Date("2026-09-04T12:00:00.000Z"),
    })
    .returning();

  return {
    tenant,
    appointmentCustomer,
    waitlistCustomer,
    appointmentService,
    waitlistService,
    staff,
    appointment,
    entry,
    managementToken,
  };
}

async function cleanFixture(fixture: Fixture) {
  await db.delete(notificationJobs).where(eq(notificationJobs.barbershopId, fixture.tenant.id));
  await db.delete(waitlistOffers).where(eq(waitlistOffers.barbershopId, fixture.tenant.id));
  await db.delete(waitlistEntries).where(eq(waitlistEntries.barbershopId, fixture.tenant.id));
  await db.delete(appointments).where(eq(appointments.barbershopId, fixture.tenant.id));
  await db.delete(workingHours).where(eq(workingHours.staffId, fixture.staff.id));
  await db.delete(staffServices).where(eq(staffServices.staffId, fixture.staff.id));
  await db.delete(customers).where(eq(customers.barbershopId, fixture.tenant.id));
  await db.delete(staffMembers).where(eq(staffMembers.id, fixture.staff.id));
  await db.delete(services).where(eq(services.barbershopId, fixture.tenant.id));
  await db.delete(barbershops).where(eq(barbershops.id, fixture.tenant.id));
}

describe("waitlist released by reschedule", () => {
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

  it("offers only the capacity actually released by a partially overlapping reschedule", async () => {
    const result = await rescheduleAppointmentByCapability(
      {
        token: fixture.managementToken,
        staffId: fixture.staff.id,
        startsAt: newStartsAt,
      },
      {
        database: db,
        clock: now,
        appOrigin: "http://localhost:3000",
        createManagementToken: () => "rescheduled-appointment-token",
      },
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected successful reschedule");
    expect(result.waitlist.status).toBe("offered");
    if (result.waitlist.status !== "offered") throw new Error("expected waitlist offer");

    expect(result.waitlist.offer).toMatchObject({
      waitlistEntryId: fixture.entry.id,
      staffId: fixture.staff.id,
      status: "PENDING",
    });
    expect(result.waitlist.offer.opportunityStartsAt.toISOString()).toBe(oldStartsAt.toISOString());
    expect(result.waitlist.offer.opportunityEndsAt.toISOString()).toBe(newStartsAt.toISOString());
    expect(result.waitlist.offer.startsAt.toISOString()).toBe(oldStartsAt.toISOString());
    expect(result.waitlist.offer.endsAt.toISOString()).toBe(newStartsAt.toISOString());

    const [oldAppointment] = await db
      .select()
      .from(appointments)
      .where(eq(appointments.id, fixture.appointment.id));
    expect(oldAppointment).toMatchObject({ status: "CANCELLED", cancellationKind: "RESCHEDULED" });

    const offers = await db
      .select()
      .from(waitlistOffers)
      .where(eq(waitlistOffers.barbershopId, fixture.tenant.id));
    expect(offers).toHaveLength(1);
  });
});
