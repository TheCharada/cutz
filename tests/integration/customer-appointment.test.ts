import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, getPool } from "@/infrastructure/db/client";
import {
  appointments,
  appointmentServices,
  barbershops,
  customers,
  customerSessions,
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
import { getPublicAvailabilityForBarbershop } from "@/workflows/public-catalog";
import { getAppointmentCapability } from "@/workflows/appointment-capability";
import { createPublicAppointment } from "@/workflows/public-appointment";
import { startPublicCustomerSession } from "@/workflows/customer-session";

const db = getDb();
const appOrigin = "http://localhost:3000";
const beforeOpening = new FixedClock(new Date("2026-09-07T10:00:00.000Z"));

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createFixture() {
  const suffix = randomUUID().slice(0, 8);
  const [tenant] = await db
    .insert(barbershops)
    .values({
      name: `Tenant ${suffix}`,
      slug: `tenant-${suffix}`,
      timezone: "America/Sao_Paulo",
      bookingIntervalMinutes: 30,
      customerVerificationMode: "NONE",
      waitlistOfferTtlMinutes: 10,
      reminderOffsetMinutes: 1440,
    })
    .returning();
  const [otherTenant] = await db
    .insert(barbershops)
    .values({
      name: `Other ${suffix}`,
      slug: `other-${suffix}`,
      timezone: "America/Sao_Paulo",
      bookingIntervalMinutes: 30,
      customerVerificationMode: "NONE",
      waitlistOfferTtlMinutes: 10,
      reminderOffsetMinutes: 1440,
    })
    .returning();

  const [service] = await db
    .insert(services)
    .values({ barbershopId: tenant.id, name: "Cut", durationMinutes: 30 })
    .returning();
  const [inactiveService] = await db
    .insert(services)
    .values({
      barbershopId: tenant.id,
      name: "Inactive",
      durationMinutes: 30,
      active: false,
    })
    .returning();
  const [otherService] = await db
    .insert(services)
    .values({ barbershopId: otherTenant.id, name: "Other", durationMinutes: 30 })
    .returning();

  const [staff] = await db
    .insert(staffMembers)
    .values({ barbershopId: tenant.id, name: "Barber" })
    .returning();
  const [inactiveStaff] = await db
    .insert(staffMembers)
    .values({ barbershopId: tenant.id, name: "Inactive", active: false })
    .returning();
  const [unmappedStaff] = await db
    .insert(staffMembers)
    .values({ barbershopId: tenant.id, name: "Unmapped" })
    .returning();
  const [otherStaff] = await db
    .insert(staffMembers)
    .values({ barbershopId: otherTenant.id, name: "Other barber" })
    .returning();

  await db.insert(staffServices).values([
    { staffId: staff.id, serviceId: service.id },
    { staffId: otherStaff.id, serviceId: otherService.id },
  ]);
  await db.insert(workingHours).values([
    { staffId: staff.id, weekday: 1, startsAt: "08:00", endsAt: "10:00" },
    { staffId: inactiveStaff.id, weekday: 1, startsAt: "08:00", endsAt: "10:00" },
    { staffId: unmappedStaff.id, weekday: 1, startsAt: "08:00", endsAt: "10:00" },
    { staffId: otherStaff.id, weekday: 1, startsAt: "08:00", endsAt: "10:00" },
  ]);

  return {
    tenant,
    otherTenant,
    service,
    inactiveService,
    otherService,
    staff,
    inactiveStaff,
    unmappedStaff,
    otherStaff,
  };
}

async function cleanFixture(fixture: Fixture) {
  const tenantIds = [fixture.tenant.id, fixture.otherTenant.id];
  const staffIds = [
    fixture.staff.id,
    fixture.inactiveStaff.id,
    fixture.unmappedStaff.id,
    fixture.otherStaff.id,
  ];

  await db.delete(notificationJobs).where(inArray(notificationJobs.barbershopId, tenantIds));
  await db.delete(waitlistOffers).where(inArray(waitlistOffers.barbershopId, tenantIds));
  await db.delete(waitlistEntries).where(inArray(waitlistEntries.barbershopId, tenantIds));
  await db.delete(appointments).where(inArray(appointments.barbershopId, tenantIds));
  await db.delete(customerSessions).where(inArray(customerSessions.barbershopId, tenantIds));
  await db.delete(timeOff).where(inArray(timeOff.staffId, staffIds));
  await db.delete(workingHours).where(inArray(workingHours.staffId, staffIds));
  await db.delete(staffServices).where(inArray(staffServices.staffId, staffIds));
  await db.delete(customers).where(inArray(customers.barbershopId, tenantIds));
  await db.delete(staffMembers).where(inArray(staffMembers.id, staffIds));
  await db.delete(services).where(inArray(services.barbershopId, tenantIds));
  await db.delete(barbershops).where(inArray(barbershops.id, tenantIds));
}

async function startSession(
  slug: string,
  phone = "(14) 99999-0001",
  name = "Original name",
  clock: FixedClock = beforeOpening,
) {
  const result = await startPublicCustomerSession(
    { slug, phone, name },
    { database: db, clock, defaultPhoneCountry: "BR" },
  );
  expect(result.status).toBe("ok");
  if (result.status !== "ok") {
    throw new Error(`expected customer session, got ${result.status}`);
  }
  return result.session;
}

async function book(
  fixture: Fixture,
  sessionToken: string,
  overrides: Partial<{
    serviceId: string;
    staffId: string;
    startsAt: Date;
    clock: FixedClock;
    expectedPriceCents: number | null;
  }> = {},
) {
  return createPublicAppointment(
    {
      slug: fixture.tenant.slug,
      sessionToken,
      serviceId: overrides.serviceId ?? fixture.service.id,
      staffId: overrides.staffId ?? fixture.staff.id,
      startsAt: overrides.startsAt ?? new Date("2026-09-07T11:00:00.000Z"),
      expectedPriceCents: overrides.expectedPriceCents,
    },
    {
      database: db,
      clock: overrides.clock ?? beforeOpening,
      appOrigin,
    },
  );
}

describe("customer sessions and public appointments", () => {
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

  it("normalizes phone numbers and reuses a Customer without overwriting its unverified name", async () => {
    const first = await startSession(fixture.tenant.slug, "(14) 99999-0001", "Original name");
    const second = await startSession(fixture.tenant.slug, "+55 14 99999-0001", "Changed name");

    expect(second.principal.id).toBe(first.principal.id);
    expect(second.principal.name).toBe("Original name");
    expect(second.principal.phoneE164).toBe("+5514999990001");

    const rows = await db
      .select()
      .from(customers)
      .where(eq(customers.barbershopId, fixture.tenant.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Original name");
  });

  it("isolates identical phone numbers between tenants", async () => {
    const first = await startSession(fixture.tenant.slug);
    const second = await startSession(fixture.otherTenant.slug);

    expect(first.principal.id).not.toBe(second.principal.id);
    expect(first.principal.phoneE164).toBe(second.principal.phoneE164);

    const [count] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(customers)
      .where(eq(customers.phoneE164, first.principal.phoneE164));
    expect(count.count).toBe(2);
  });

  it("persists only the hash of the customer-session token", async () => {
    const session = await startSession(fixture.tenant.slug);
    const [row] = await db
      .select({ tokenHash: customerSessions.tokenHash })
      .from(customerSessions)
      .where(eq(customerSessions.customerId, session.principal.id));

    expect(row.tokenHash).not.toBe(session.token);
    expect(row.tokenHash).toBe(createHash("sha256").update(session.token).digest("hex"));
  });

  it("refuses a stale price without creating the booking, then preserves the confirmed value", async () => {
    const session = await startSession(fixture.tenant.slug);
    await db.update(services).set({ priceCents: 3500 }).where(eq(services.id, fixture.service.id));

    const changed = await book(fixture, session.token, { expectedPriceCents: 2500 });
    expect(changed.status).toBe("service-price-changed");
    const stored = await db.select().from(appointments)
      .where(eq(appointments.barbershopId, fixture.tenant.id));
    expect(stored).toHaveLength(0);

    const created = await book(fixture, session.token, { expectedPriceCents: 3500 });
    expect(created.status).toBe("ok");
    if (created.status !== "ok") throw new Error("Expected a confirmed appointment");
    expect(created.bookedService.priceCents).toBe(3500);

    await db.update(services).set({ priceCents: 4200 }).where(eq(services.id, fixture.service.id));
    const [record] = await db.select().from(appointmentServices)
      .where(eq(appointmentServices.appointmentId, created.appointment.id));
    expect(record.unitPriceCents).toBe(3500);

    const token = created.managementUrl.split("/a/")[1];
    const management = await getAppointmentCapability(token, { database: db });
    expect(management.status).toBe("ok");
    if (management.status !== "ok") throw new Error("Missing appointment capability");
    expect(management.service.bookedPriceCents).toBe(3500);
  });

  it("distinguishes an unspecified price from a free service when booking", async () => {
    const session = await startSession(fixture.tenant.slug);
    const unspecified = await book(fixture, session.token, { expectedPriceCents: null });
    expect(unspecified.status).toBe("ok");
    if (unspecified.status !== "ok") throw new Error("Expected booking");
    expect(unspecified.bookedService.priceCents).toBeNull();

    await db.update(services).set({ priceCents: 0 }).where(eq(services.id, fixture.service.id));
    const free = await book(fixture, session.token, {
      startsAt: new Date("2026-09-07T11:30:00.000Z"),
      expectedPriceCents: 0,
    });
    expect(free.status).toBe("ok");
    if (free.status !== "ok") throw new Error("Expected booking");
    expect(free.bookedService.priceCents).toBe(0);
  });

  it("validates service, staff, StaffService and the working schedule", async () => {
    const session = await startSession(fixture.tenant.slug);

    await expect(
      book(fixture, session.token, { serviceId: fixture.inactiveService.id }),
    ).resolves.toMatchObject({ status: "service-not-found" });
    await expect(
      book(fixture, session.token, { serviceId: fixture.otherService.id }),
    ).resolves.toMatchObject({ status: "service-not-found" });
    await expect(
      book(fixture, session.token, { staffId: fixture.inactiveStaff.id }),
    ).resolves.toMatchObject({ status: "staff-not-found" });
    await expect(
      book(fixture, session.token, { staffId: fixture.otherStaff.id }),
    ).resolves.toMatchObject({ status: "staff-not-found" });
    await expect(
      book(fixture, session.token, { staffId: fixture.unmappedStaff.id }),
    ).resolves.toMatchObject({ status: "schedule-conflict" });
    await expect(
      book(fixture, session.token, { startsAt: new Date("2026-09-07T10:30:00.000Z") }),
    ).resolves.toMatchObject({ status: "schedule-conflict" });
  });

  it("rejects TimeOff as a schedule conflict", async () => {
    const session = await startSession(fixture.tenant.slug);
    await db.insert(timeOff).values({
      staffId: fixture.staff.id,
      startsAt: new Date("2026-09-07T11:00:00.000Z"),
      endsAt: new Date("2026-09-07T11:30:00.000Z"),
    });

    await expect(book(fixture, session.token)).resolves.toMatchObject({
      status: "schedule-conflict",
    });
  });

  it("keeps an expired-but-unprocessed PENDING waitlist offer as a public and booking hold", async () => {
    const session = await startSession(fixture.tenant.slug);
    const [entry] = await db
      .insert(waitlistEntries)
      .values({
        barbershopId: fixture.tenant.id,
        customerId: session.principal.id,
        serviceId: fixture.service.id,
        staffId: fixture.staff.id,
        desiredDate: "2026-09-07",
        earliestTime: "08:00",
        latestTime: "10:00",
        managementTokenHash: randomUUID(),
      })
      .returning();
    await db.insert(waitlistOffers).values({
      barbershopId: fixture.tenant.id,
      waitlistEntryId: entry.id,
      staffId: fixture.staff.id,
      startsAt: new Date("2026-09-07T11:00:00.000Z"),
      endsAt: new Date("2026-09-07T11:30:00.000Z"),
      expiresAt: new Date("2026-09-07T10:30:00.000Z"),
      actionTokenHash: randomUUID(),
      opportunityId: randomUUID(),
      opportunityStartsAt: new Date("2026-09-07T11:00:00.000Z"),
      opportunityEndsAt: new Date("2026-09-07T11:30:00.000Z"),
      createdAt: new Date("2026-09-07T09:00:00.000Z"),
    });

    const clock = new FixedClock(new Date("2026-09-07T10:45:00.000Z"));
    const availability = await getPublicAvailabilityForBarbershop(
      {
        slug: fixture.tenant.slug,
        serviceId: fixture.service.id,
        staffId: fixture.staff.id,
        date: "2026-09-07",
      },
      { executor: db, clock },
    );
    expect(availability.status).toBe("ok");
    if (availability.status !== "ok") {
      throw new Error("expected availability");
    }
    expect(availability.slots.map((slot) => slot.startsAt)).not.toContain(
      "2026-09-07T11:00:00.000Z",
    );

    const result = await book(fixture, session.token, { clock });
    expect(result.status).toBe("appointment-conflict");
  });

  it("returns only one Appointment for two concurrent attempts at the same staff and time", async () => {
    const session = await startSession(fixture.tenant.slug);
    const [first, second] = await Promise.all([
      book(fixture, session.token),
      book(fixture, session.token),
    ]);

    expect([first.status, second.status].sort()).toEqual(["appointment-conflict", "ok"]);

    const [count] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(appointments)
      .where(
        and(
          eq(appointments.barbershopId, fixture.tenant.id),
          eq(appointments.staffId, fixture.staff.id),
          eq(appointments.startsAt, new Date("2026-09-07T11:00:00.000Z")),
        ),
      );
    expect(count.count).toBe(1);
  });

  it("enforces the PostgreSQL exclusion constraint independently from application validation", async () => {
    const session = await startSession(fixture.tenant.slug);
    await db.insert(appointments).values({
      barbershopId: fixture.tenant.id,
      customerId: session.principal.id,
      staffId: fixture.staff.id,
      serviceId: fixture.service.id,
      startsAt: new Date("2026-09-07T11:00:00.000Z"),
      endsAt: new Date("2026-09-07T11:30:00.000Z"),
      managementTokenHash: randomUUID(),
    });

    await expect(
      db.insert(appointments).values({
        barbershopId: fixture.tenant.id,
        customerId: session.principal.id,
        staffId: fixture.staff.id,
        serviceId: fixture.service.id,
        startsAt: new Date("2026-09-07T11:15:00.000Z"),
        endsAt: new Date("2026-09-07T11:45:00.000Z"),
        managementTokenHash: randomUUID(),
      }),
    ).rejects.toMatchObject({
      cause: { code: "23P01", constraint: "appointments_no_scheduled_overlap" },
    });
  });

  it("stores only the capability hash and atomically creates created/reminder jobs", async () => {
    const clock = new FixedClock(new Date("2026-09-06T10:00:00.000Z"));
    const session = await startSession(fixture.tenant.slug, undefined, undefined, clock);
    const result = await book(fixture, session.token, { clock });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("expected appointment");
    }

    const token = result.managementUrl.split("/").at(-1)!;
    const [appointment] = await db
      .select({ managementTokenHash: appointments.managementTokenHash })
      .from(appointments)
      .where(eq(appointments.id, result.appointment.id));
    expect(appointment.managementTokenHash).not.toBe(token);
    expect(appointment.managementTokenHash).toBe(
      createHash("sha256").update(token).digest("hex"),
    );

    const jobs = await db
      .select({
        type: notificationJobs.type,
        phoneE164: notificationJobs.phoneE164,
        dedupeKey: notificationJobs.dedupeKey,
        scheduledAt: notificationJobs.scheduledAt,
        payload: notificationJobs.payload,
      })
      .from(notificationJobs)
      .where(eq(notificationJobs.appointmentId, result.appointment.id));

    expect(jobs).toHaveLength(2);
    expect(jobs.map((job) => job.type).sort()).toEqual([
      "APPOINTMENT_CREATED",
      "APPOINTMENT_REMINDER",
    ]);
    expect(jobs.every((job) => job.phoneE164 === session.principal.phoneE164)).toBe(true);
    expect(jobs.map((job) => job.dedupeKey).sort()).toEqual([
      `appointment:${result.appointment.id}:created`,
      `appointment:${result.appointment.id}:reminder`,
    ]);
    const reminder = jobs.find((job) => job.type === "APPOINTMENT_REMINDER")!;
    expect(reminder.scheduledAt.toISOString()).toBe("2026-09-06T11:00:00.000Z");
    expect(reminder.payload).not.toHaveProperty("managementUrl");
  });

  it("rolls back the Appointment when notification payload creation fails", async () => {
    const session = await startSession(fixture.tenant.slug);

    await expect(
      createPublicAppointment(
        {
          slug: fixture.tenant.slug,
          sessionToken: session.token,
          serviceId: fixture.service.id,
          staffId: fixture.staff.id,
          startsAt: new Date("2026-09-07T11:00:00.000Z"),
        },
        { database: db, clock: beforeOpening, appOrigin: "not-a-url" },
      ),
    ).rejects.toThrow();

    const [appointmentCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(appointments)
      .where(eq(appointments.barbershopId, fixture.tenant.id));
    const [jobCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notificationJobs)
      .where(eq(notificationJobs.barbershopId, fixture.tenant.id));

    expect(appointmentCount.count).toBe(0);
    expect(jobCount.count).toBe(0);
  });

  it("does not create a reminder when its theoretical window already passed", async () => {
    const session = await startSession(fixture.tenant.slug);
    const result = await book(fixture, session.token);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("expected appointment");
    }

    const jobs = await db
      .select({ type: notificationJobs.type })
      .from(notificationJobs)
      .where(eq(notificationJobs.appointmentId, result.appointment.id));
    expect(jobs).toEqual([{ type: "APPOINTMENT_CREATED" }]);
  });
});
