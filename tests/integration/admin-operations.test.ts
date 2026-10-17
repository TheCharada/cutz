import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
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
import type { BarbershopContext } from "@/modules/barbershops";
import { FixedClock } from "@/shared/clock";
import { hashOpaqueToken } from "@/shared/tokens";
import {
  cancelAdminAppointment,
  createAdminAppointment,
  finishAdminAppointment,
  rescheduleAdminAppointment,
} from "@/workflows/admin-appointments";
import {
  createTimeOffForAdmin,
  deleteTimeOffForAdmin,
  getStaffAdminConfiguration,
  replaceWorkingHoursForAdmin,
} from "@/workflows/admin-catalog";
import {
  cancelAdminWaitlistEntry,
  createAdminWaitlistEntry,
  listAdminWaitlist,
} from "@/workflows/admin-waitlist";

const db = getDb();
const appOrigin = "http://127.0.0.1:3000";
const date = "2026-09-07";
const earlyClock = new FixedClock(new Date("2026-09-07T10:00:00.000Z"));

type Fixture = Awaited<ReturnType<typeof createFixture>>;

function contextFor(row: typeof barbershops.$inferSelect): BarbershopContext {
  return {
    id: row.id,
    slug: row.slug,
    timezone: row.timezone,
    bookingIntervalMinutes: row.bookingIntervalMinutes,
    customerVerificationMode: row.customerVerificationMode,
    waitlistOfferTtlMinutes: row.waitlistOfferTtlMinutes,
    reminderOffsetMinutes: row.reminderOffsetMinutes,
  };
}

async function createFixture() {
  const suffix = randomUUID().slice(0, 8);
  const [tenantA] = await db
    .insert(barbershops)
    .values({
      name: `Admin Ops A ${suffix}`,
      slug: `admin-ops-a-${suffix}`,
      timezone: "America/Sao_Paulo",
      bookingIntervalMinutes: 30,
      customerVerificationMode: "NONE",
      waitlistOfferTtlMinutes: 10,
      reminderOffsetMinutes: 60,
    })
    .returning();
  const [tenantB] = await db
    .insert(barbershops)
    .values({
      name: `Admin Ops B ${suffix}`,
      slug: `admin-ops-b-${suffix}`,
      timezone: "America/Sao_Paulo",
      bookingIntervalMinutes: 30,
      customerVerificationMode: "NONE",
      waitlistOfferTtlMinutes: 10,
      reminderOffsetMinutes: 60,
    })
    .returning();

  const [customerA] = await db
    .insert(customers)
    .values({ barbershopId: tenantA.id, name: "Cliente A", phoneE164: `+55119${Math.floor(10000000 + Math.random() * 89999999)}` })
    .returning();
  const [customerB] = await db
    .insert(customers)
    .values({ barbershopId: tenantB.id, name: "Cliente B", phoneE164: `+55118${Math.floor(10000000 + Math.random() * 89999999)}` })
    .returning();
  const [serviceA] = await db
    .insert(services)
    .values({ barbershopId: tenantA.id, name: "Corte", durationMinutes: 30 })
    .returning();
  const [serviceB] = await db
    .insert(services)
    .values({ barbershopId: tenantB.id, name: "Corte B", durationMinutes: 30 })
    .returning();
  const [staffA] = await db
    .insert(staffMembers)
    .values({ barbershopId: tenantA.id, name: "Profissional A" })
    .returning();
  const [staffB] = await db
    .insert(staffMembers)
    .values({ barbershopId: tenantA.id, name: "Profissional B" })
    .returning();
  const [staffForeign] = await db
    .insert(staffMembers)
    .values({ barbershopId: tenantB.id, name: "Profissional estrangeiro" })
    .returning();

  await db.insert(staffServices).values([
    { staffId: staffA.id, serviceId: serviceA.id },
    { staffId: staffB.id, serviceId: serviceA.id },
    { staffId: staffForeign.id, serviceId: serviceB.id },
  ]);
  await db.insert(workingHours).values([
    { staffId: staffA.id, weekday: 1, startsAt: "09:00", endsAt: "18:00" },
    { staffId: staffB.id, weekday: 1, startsAt: "09:00", endsAt: "18:00" },
    { staffId: staffForeign.id, weekday: 1, startsAt: "09:00", endsAt: "18:00" },
  ]);

  return {
    tenantA,
    tenantB,
    barbershopA: contextFor(tenantA),
    barbershopB: contextFor(tenantB),
    customerA,
    customerB,
    serviceA,
    serviceB,
    staffA,
    staffB,
    staffForeign,
  };
}

async function cleanFixture(fixture: Fixture) {
  const tenantIds = [fixture.tenantA.id, fixture.tenantB.id];
  const staffIds = [fixture.staffA.id, fixture.staffB.id, fixture.staffForeign.id];
  await db.delete(notificationJobs).where(inArray(notificationJobs.barbershopId, tenantIds));
  await db.delete(waitlistOffers).where(inArray(waitlistOffers.barbershopId, tenantIds));
  await db.delete(waitlistEntries).where(inArray(waitlistEntries.barbershopId, tenantIds));
  await db.delete(appointments).where(inArray(appointments.barbershopId, tenantIds));
  await db.delete(timeOff).where(inArray(timeOff.staffId, staffIds));
  await db.delete(workingHours).where(inArray(workingHours.staffId, staffIds));
  await db.delete(staffServices).where(inArray(staffServices.staffId, staffIds));
  await db.delete(customers).where(inArray(customers.barbershopId, tenantIds));
  await db.delete(staffMembers).where(inArray(staffMembers.id, staffIds));
  await db.delete(services).where(inArray(services.barbershopId, tenantIds));
  await db.delete(barbershops).where(inArray(barbershops.id, tenantIds));
}

async function directAppointment(
  fixture: Fixture,
  startsAt: string,
  params: { staffId?: string; status?: "SCHEDULED" | "COMPLETED" | "NO_SHOW" } = {},
) {
  const start = new Date(startsAt);
  const [row] = await db
    .insert(appointments)
    .values({
      barbershopId: fixture.tenantA.id,
      customerId: fixture.customerA.id,
      staffId: params.staffId ?? fixture.staffA.id,
      serviceId: fixture.serviceA.id,
      startsAt: start,
      endsAt: new Date(start.getTime() + 30 * 60_000),
      status: params.status ?? "SCHEDULED",
      managementTokenHash: hashOpaqueToken(`appointment-${randomUUID()}`),
    })
    .returning();
  return row;
}

async function directWaitlistEntry(
  fixture: Fixture,
  params: { createdAt?: Date; customerId?: string; staffId?: string | null } = {},
) {
  const [row] = await db
    .insert(waitlistEntries)
    .values({
      barbershopId: fixture.tenantA.id,
      customerId: params.customerId ?? fixture.customerA.id,
      serviceId: fixture.serviceA.id,
      staffId: params.staffId === undefined ? fixture.staffA.id : params.staffId,
      desiredDate: date,
      earliestTime: "09:00",
      latestTime: "18:00",
      managementTokenHash: hashOpaqueToken(`waitlist-${randomUUID()}`),
      ...(params.createdAt ? { createdAt: params.createdAt, updatedAt: params.createdAt } : {}),
    })
    .returning();
  return row;
}

describe("admin appointment, catalog and waitlist operations", () => {
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

  it("creates a tenant-scoped admin appointment and enqueues domain notifications atomically", async () => {
    const token = `admin-create-${randomUUID()}`;
    const result = await createAdminAppointment(
      {
        barbershop: fixture.barbershopA,
        customerId: fixture.customerA.id,
        serviceId: fixture.serviceA.id,
        staffId: fixture.staffA.id,
        startsAt: new Date("2026-09-07T12:00:00.000Z"),
      },
      { database: db, clock: earlyClock, appOrigin, createManagementToken: () => token },
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected admin appointment creation");
    const [stored] = await db.select().from(appointments).where(eq(appointments.id, result.appointment.id));
    expect(stored.managementTokenHash).toBe(hashOpaqueToken(token));
    expect(stored.barbershopId).toBe(fixture.tenantA.id);

    const jobs = await db
      .select({ type: notificationJobs.type, status: notificationJobs.status })
      .from(notificationJobs)
      .where(eq(notificationJobs.appointmentId, result.appointment.id));
    expect(jobs).toEqual(expect.arrayContaining([
      { type: "APPOINTMENT_CREATED", status: "PENDING" },
      { type: "APPOINTMENT_REMINDER", status: "PENDING" },
    ]));

    const foreign = await createAdminAppointment(
      {
        barbershop: fixture.barbershopB,
        customerId: fixture.customerA.id,
        serviceId: fixture.serviceB.id,
        staffId: fixture.staffForeign.id,
        startsAt: new Date("2026-09-07T12:00:00.000Z"),
      },
      { database: db, clock: earlyClock, appOrigin },
    );
    expect(foreign.status).toBe("customer-not-found");
  });

  it("allows complete/no-show only after startsAt and keeps terminal states terminal", async () => {
    const completed = await directAppointment(fixture, "2026-09-07T12:00:00.000Z");
    const tooEarly = await finishAdminAppointment(
      { barbershop: fixture.barbershopA, appointmentId: completed.id, status: "COMPLETED" },
      { database: db, clock: new FixedClock(new Date("2026-09-07T11:59:59.999Z")) },
    );
    expect(tooEarly.status).toBe("appointment-conflict");

    const completedResult = await finishAdminAppointment(
      { barbershop: fixture.barbershopA, appointmentId: completed.id, status: "COMPLETED" },
      { database: db, clock: new FixedClock(new Date("2026-09-07T12:00:00.000Z")) },
    );
    expect(completedResult).toMatchObject({ status: "ok", appointment: { status: "COMPLETED" } });
    const terminalRetry = await finishAdminAppointment(
      { barbershop: fixture.barbershopA, appointmentId: completed.id, status: "NO_SHOW" },
      { database: db, clock: new FixedClock(new Date("2026-09-07T12:30:00.000Z")) },
    );
    expect(terminalRetry.status).toBe("appointment-conflict");

    const noShow = await directAppointment(fixture, "2026-09-07T13:00:00.000Z");
    const noShowResult = await finishAdminAppointment(
      { barbershop: fixture.barbershopA, appointmentId: noShow.id, status: "NO_SHOW" },
      { database: db, clock: new FixedClock(new Date("2026-09-07T13:00:00.000Z")) },
    );
    expect(noShowResult).toMatchObject({ status: "ok", appointment: { status: "NO_SHOW" } });
  });

  it("cancels as STAFF and feeds the released capacity into Waitlist", async () => {
    const appointment = await directAppointment(fixture, "2026-09-07T14:00:00.000Z");
    const entry = await directWaitlistEntry(fixture);
    const result = await cancelAdminAppointment(
      { barbershop: fixture.barbershopA, appointmentId: appointment.id, reason: "Operação administrativa" },
      { database: db, clock: new FixedClock(new Date("2026-09-07T13:00:00.000Z")), appOrigin },
    );

    expect(result).toMatchObject({ status: "ok", changed: true });
    const [stored] = await db.select().from(appointments).where(eq(appointments.id, appointment.id));
    expect(stored).toMatchObject({
      status: "CANCELLED",
      cancelledBy: "STAFF",
      cancellationKind: "CANCELLATION",
      cancellationReason: "Operação administrativa",
    });
    const [offer] = await db.select().from(waitlistOffers).where(eq(waitlistOffers.waitlistEntryId, entry.id));
    expect(offer).toMatchObject({ status: "PENDING", barbershopId: fixture.tenantA.id, staffId: fixture.staffA.id });
    const jobs = await db.select({ type: notificationJobs.type }).from(notificationJobs).where(eq(notificationJobs.barbershopId, fixture.tenantA.id));
    expect(jobs.map((job) => job.type)).toEqual(expect.arrayContaining(["APPOINTMENT_CANCELLED", "WAITLIST_OFFER"]));
  });

  it("reschedules by creating a new appointment, preserving history, notifications and released Waitlist capacity", async () => {
    const old = await directAppointment(fixture, "2026-09-07T15:00:00.000Z");
    const entry = await directWaitlistEntry(fixture);
    const token = `rescheduled-${randomUUID()}`;
    const result = await rescheduleAdminAppointment(
      {
        barbershop: fixture.barbershopA,
        appointmentId: old.id,
        staffId: fixture.staffA.id,
        startsAt: new Date("2026-09-07T16:00:00.000Z"),
      },
      {
        database: db,
        clock: new FixedClock(new Date("2026-09-07T13:00:00.000Z")),
        appOrigin,
        createManagementToken: () => token,
      },
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected admin reschedule");
    const [storedOld] = await db.select().from(appointments).where(eq(appointments.id, old.id));
    const [storedNew] = await db.select().from(appointments).where(eq(appointments.id, result.appointment.id));
    expect(storedOld).toMatchObject({ status: "CANCELLED", cancelledBy: "STAFF", cancellationKind: "RESCHEDULED" });
    expect(storedNew).toMatchObject({ status: "SCHEDULED", rescheduledFromId: old.id, managementTokenHash: hashOpaqueToken(token) });
    const [offer] = await db.select().from(waitlistOffers).where(eq(waitlistOffers.waitlistEntryId, entry.id));
    expect(offer?.status).toBe("PENDING");
    const jobs = await db.select({ type: notificationJobs.type }).from(notificationJobs).where(eq(notificationJobs.barbershopId, fixture.tenantA.id));
    expect(jobs.map((job) => job.type)).toEqual(expect.arrayContaining(["APPOINTMENT_RESCHEDULED", "APPOINTMENT_REMINDER", "WAITLIST_OFFER"]));
  });

  it("supports multiple WorkingHours intervals, rejects overlaps, and preserves future scheduled appointments", async () => {
    const validHours = [
      { weekday: 1, startsAt: "09:00", endsAt: "12:00" },
      { weekday: 1, startsAt: "13:00", endsAt: "17:00" },
    ];
    const valid = await replaceWorkingHoursForAdmin(
      { barbershopId: fixture.tenantA.id, staffId: fixture.staffA.id, timezone: fixture.tenantA.timezone, hours: validHours },
      { database: db, clock: earlyClock },
    );
    expect(valid.status).toBe("ok");
    if (valid.status !== "ok") throw new Error("expected valid working hours");
    expect(valid.hours).toHaveLength(2);

    const overlap = await replaceWorkingHoursForAdmin(
      {
        barbershopId: fixture.tenantA.id,
        staffId: fixture.staffA.id,
        timezone: fixture.tenantA.timezone,
        hours: [
          { weekday: 1, startsAt: "09:00", endsAt: "12:00" },
          { weekday: 1, startsAt: "11:30", endsAt: "14:00" },
        ],
      },
      { database: db, clock: earlyClock },
    );
    expect(overlap.status).toBe("validation-error");

    await directAppointment(fixture, "2026-09-07T16:00:00.000Z");
    const invalidating = await replaceWorkingHoursForAdmin(
      {
        barbershopId: fixture.tenantA.id,
        staffId: fixture.staffA.id,
        timezone: fixture.tenantA.timezone,
        hours: [{ weekday: 1, startsAt: "09:00", endsAt: "12:00" }],
      },
      { database: db, clock: earlyClock },
    );
    expect(invalidating.status).toBe("appointment-conflict");
    const configuration = await getStaffAdminConfiguration(
      { barbershopId: fixture.tenantA.id, staffId: fixture.staffA.id },
      { database: db },
    );
    expect(configuration?.hours.map((row) => ({ weekday: row.weekday, startsAt: row.startsAt, endsAt: row.endsAt }))).toEqual(validHours);
  });

  it("creates TimeOff only inside the tenant and refuses conflicts with SCHEDULED appointments", async () => {
    const valid = await createTimeOffForAdmin(
      {
        barbershopId: fixture.tenantA.id,
        staffId: fixture.staffA.id,
        startsAt: new Date("2026-09-08T12:00:00.000Z"),
        endsAt: new Date("2026-09-08T13:00:00.000Z"),
        reason: "Folga",
      },
      { database: db },
    );
    expect(valid.status).toBe("ok");
    if (valid.status !== "ok") throw new Error("expected time off creation");

    const appointment = await directAppointment(fixture, "2026-09-07T14:00:00.000Z");
    const conflict = await createTimeOffForAdmin(
      {
        barbershopId: fixture.tenantA.id,
        staffId: fixture.staffA.id,
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
      },
      { database: db },
    );
    expect(conflict.status).toBe("appointment-conflict");

    const foreignCreate = await createTimeOffForAdmin(
      {
        barbershopId: fixture.tenantB.id,
        staffId: fixture.staffA.id,
        startsAt: new Date("2026-09-08T15:00:00.000Z"),
        endsAt: new Date("2026-09-08T16:00:00.000Z"),
      },
      { database: db },
    );
    expect(foreignCreate.status).toBe("not-found");
    const foreignDelete = await deleteTimeOffForAdmin(
      { barbershopId: fixture.tenantB.id, staffId: fixture.staffA.id, timeOffId: valid.timeOff.id },
      { database: db },
    );
    expect(foreignDelete.status).toBe("not-found");
    expect(await deleteTimeOffForAdmin(
      { barbershopId: fixture.tenantA.id, staffId: fixture.staffA.id, timeOffId: valid.timeOff.id },
      { database: db },
    )).toEqual({ status: "ok" });
  });

  it("creates admin Waitlist entries with hashed capabilities and isolates reads by tenant", async () => {
    const result = await createAdminWaitlistEntry(
      {
        barbershop: fixture.barbershopA,
        customerId: fixture.customerA.id,
        serviceId: fixture.serviceA.id,
        staffId: fixture.staffA.id,
        desiredDate: date,
        earliestTime: "09:00",
        latestTime: "18:00",
      },
      { database: db, clock: earlyClock, appOrigin },
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected waitlist creation");

    const token = result.managementUrl.split("/").at(-1);
    if (!token) throw new Error("expected waitlist management token");
    const [stored] = await db.select().from(waitlistEntries).where(eq(waitlistEntries.id, result.entry.id));
    expect(stored.managementTokenHash).toBe(hashOpaqueToken(token));
    expect(stored.managementTokenHash).not.toBe(token);
    expect(await listAdminWaitlist(fixture.tenantA.id, { database: db })).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: result.entry.id, customerName: fixture.customerA.name })]),
    );
    expect(await listAdminWaitlist(fixture.tenantB.id, { database: db })).toHaveLength(0);

    const foreign = await createAdminWaitlistEntry(
      {
        barbershop: fixture.barbershopA,
        customerId: fixture.customerB.id,
        serviceId: fixture.serviceA.id,
        staffId: fixture.staffA.id,
        desiredDate: date,
        earliestTime: "09:00",
        latestTime: "18:00",
      },
      { database: db, clock: earlyClock, appOrigin },
    );
    expect(foreign.status).toBe("customer-not-found");
    const [createdNotification] = await db
      .select()
      .from(notificationJobs)
      .where(and(eq(notificationJobs.waitlistEntryId, result.entry.id), eq(notificationJobs.type, "WAITLIST_ENTRY_CREATED")));
    expect(createdNotification?.status).toBe("PENDING");
  });

  it("cancels an admin Waitlist entry with a pending offer and advances the same opportunity", async () => {
    const first = await directWaitlistEntry(fixture, { createdAt: new Date("2026-09-05T10:00:00.000Z") });
    const second = await directWaitlistEntry(fixture, { createdAt: new Date("2026-09-05T10:01:00.000Z") });
    const appointment = await directAppointment(fixture, "2026-09-07T17:00:00.000Z");

    const cancellation = await cancelAdminAppointment(
      { barbershop: fixture.barbershopA, appointmentId: appointment.id },
      { database: db, clock: new FixedClock(new Date("2026-09-07T16:00:00.000Z")), appOrigin },
    );
    expect(cancellation.status).toBe("ok");
    const [firstOffer] = await db.select().from(waitlistOffers).where(eq(waitlistOffers.waitlistEntryId, first.id));
    expect(firstOffer?.status).toBe("PENDING");

    const cancelled = await cancelAdminWaitlistEntry(
      { barbershop: fixture.barbershopA, entryId: first.id },
      { database: db, clock: new FixedClock(new Date("2026-09-07T16:01:00.000Z")), appOrigin },
    );
    expect(cancelled).toMatchObject({ status: "ok", changed: true, entry: { status: "CANCELLED" } });

    const [rejected] = await db.select().from(waitlistOffers).where(eq(waitlistOffers.id, firstOffer.id));
    const [nextOffer] = await db.select().from(waitlistOffers).where(eq(waitlistOffers.waitlistEntryId, second.id));
    expect(rejected.status).toBe("REJECTED");
    expect(nextOffer).toMatchObject({ status: "PENDING", opportunityId: firstOffer.opportunityId });

    const foreign = await cancelAdminWaitlistEntry(
      { barbershop: fixture.barbershopB, entryId: second.id },
      { database: db, clock: new FixedClock(new Date("2026-09-07T16:02:00.000Z")), appOrigin },
    );
    expect(foreign.status).toBe("not-found");
  });
});
