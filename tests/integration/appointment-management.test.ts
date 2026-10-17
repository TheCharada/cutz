import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
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
  workingHours,
} from "@/infrastructure/db/schema";
import { FixedClock } from "@/shared/clock";
import {
  cancelAppointmentByCapability,
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
      name: `Management ${suffix}`,
      slug: `management-${suffix}`,
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
      name: "Capability Customer",
      phoneE164: `+5514${Math.floor(100000000 + Math.random() * 899999999)}`,
    })
    .returning();
  const [service] = await db
    .insert(services)
    .values({ barbershopId: tenant.id, name: "Cut", durationMinutes: 30 })
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
  await db.delete(appointments).where(eq(appointments.barbershopId, fixture.tenant.id));
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
      endsAt: new Date(startsAt.getTime() + 30 * 60_000),
      status: params.status ?? "SCHEDULED",
      managementTokenHash: createHash("sha256").update(params.token).digest("hex"),
    })
    .returning();

  return appointment;
}

async function createReminder(fixture: Fixture, appointmentId: string) {
  await db.insert(notificationJobs).values({
    barbershopId: fixture.tenant.id,
    type: "APPOINTMENT_REMINDER",
    phoneE164: fixture.customer.phoneE164,
    payload: { type: "APPOINTMENT_REMINDER", appointmentId },
    appointmentId,
    dedupeKey: `appointment:${appointmentId}:reminder`,
    scheduledAt: new Date("2026-09-06T11:00:00.000Z"),
  });
}

describe("appointment management capability", () => {
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

  it("cancels a scheduled appointment idempotently and cancels its pending reminder", async () => {
    const token = `cancel-${randomUUID()}`;
    const appointment = await createAppointment(fixture, { token });
    await createReminder(fixture, appointment.id);

    const first = await cancelAppointmentByCapability(
      { token, reason: "Não poderei comparecer" },
      { database: db, clock },
    );
    const second = await cancelAppointmentByCapability({ token }, { database: db, clock });

    expect(first).toMatchObject({ status: "ok", changed: true });
    expect(second).toMatchObject({ status: "ok", changed: false });

    const [stored] = await db.select().from(appointments).where(eq(appointments.id, appointment.id));
    expect(stored).toMatchObject({
      status: "CANCELLED",
      cancelledBy: "CUSTOMER",
      cancellationKind: "CANCELLATION",
      cancellationReason: "Não poderei comparecer",
    });
    expect(stored.cancelledAt?.toISOString()).toBe(clock.now().toISOString());

    const jobs = await db
      .select({ type: notificationJobs.type, status: notificationJobs.status, dedupeKey: notificationJobs.dedupeKey })
      .from(notificationJobs)
      .where(eq(notificationJobs.appointmentId, appointment.id));
    expect(jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "APPOINTMENT_REMINDER", status: "CANCELLED" }),
        expect.objectContaining({
          type: "APPOINTMENT_CANCELLED",
          status: "PENDING",
          dedupeKey: `appointment:${appointment.id}:cancelled`,
        }),
      ]),
    );
    expect(jobs.filter((job) => job.type === "APPOINTMENT_CANCELLED")).toHaveLength(1);
  });

  it.each(["COMPLETED", "NO_SHOW"] as const)(
    "does not move terminal state %s back into a schedulable transition",
    async (status) => {
      const cancelToken = `cancel-${status}-${randomUUID()}`;
      const rescheduleToken = `reschedule-${status}-${randomUUID()}`;
      const cancelAppointment = await createAppointment(fixture, {
        token: cancelToken,
        status,
        startsAt: new Date("2026-09-07T11:00:00.000Z"),
      });
      const rescheduleAppointment = await createAppointment(fixture, {
        token: rescheduleToken,
        staffId: fixture.staffB.id,
        status,
        startsAt: new Date("2026-09-07T12:00:00.000Z"),
      });

      await expect(
        cancelAppointmentByCapability({ token: cancelToken }, { database: db, clock }),
      ).resolves.toMatchObject({ status: "terminal-conflict" });
      await expect(
        rescheduleAppointmentByCapability(
          {
            token: rescheduleToken,
            staffId: fixture.staffA.id,
            startsAt: new Date("2026-09-07T13:00:00.000Z"),
          },
          { database: db, clock, appOrigin },
        ),
      ).resolves.toMatchObject({ status: "terminal-conflict" });

      const rows = await db
        .select({ id: appointments.id, status: appointments.status })
        .from(appointments)
        .where(inArray(appointments.id, [cancelAppointment.id, rescheduleAppointment.id]));
      expect(rows.every((row) => row.status === status)).toBe(true);
    },
  );

  it("reschedules with the same Customer and Service, a new token, and rescheduled_from_id", async () => {
    const oldToken = `old-${randomUUID()}`;
    const newToken = `new-${randomUUID()}`;
    const oldAppointment = await createAppointment(fixture, { token: oldToken });
    await createReminder(fixture, oldAppointment.id);

    const result = await rescheduleAppointmentByCapability(
      {
        token: oldToken,
        staffId: fixture.staffB.id,
        startsAt: new Date("2026-09-07T13:00:00.000Z"),
      },
      {
        database: db,
        clock,
        appOrigin,
        createManagementToken: () => newToken,
      },
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("expected successful reschedule");
    }

    const [oldStored] = await db
      .select()
      .from(appointments)
      .where(eq(appointments.id, oldAppointment.id));
    expect(oldStored).toMatchObject({
      status: "CANCELLED",
      cancelledBy: "CUSTOMER",
      cancellationKind: "RESCHEDULED",
    });

    const [newStored] = await db
      .select()
      .from(appointments)
      .where(eq(appointments.id, result.appointment.id));
    expect(newStored).toMatchObject({
      status: "SCHEDULED",
      customerId: oldAppointment.customerId,
      serviceId: oldAppointment.serviceId,
      staffId: fixture.staffB.id,
      rescheduledFromId: oldAppointment.id,
    });
    expect(newStored.managementTokenHash).toBe(
      createHash("sha256").update(newToken).digest("hex"),
    );
    expect(newStored.managementTokenHash).not.toBe(newToken);
    expect(result.managementUrl).toBe(`${appOrigin}/a/${newToken}`);

    const oldReminder = await db
      .select({ status: notificationJobs.status })
      .from(notificationJobs)
      .where(
        and(
          eq(notificationJobs.appointmentId, oldAppointment.id),
          eq(notificationJobs.type, "APPOINTMENT_REMINDER"),
        ),
      );
    expect(oldReminder).toEqual([{ status: "CANCELLED" }]);

    const newJobs = await db
      .select({ type: notificationJobs.type, payload: notificationJobs.payload })
      .from(notificationJobs)
      .where(eq(notificationJobs.appointmentId, result.appointment.id));
    expect(newJobs.map((job) => job.type).sort()).toEqual([
      "APPOINTMENT_REMINDER",
      "APPOINTMENT_RESCHEDULED",
    ]);
    const rescheduled = newJobs.find((job) => job.type === "APPOINTMENT_RESCHEDULED")!;
    const reminder = newJobs.find((job) => job.type === "APPOINTMENT_REMINDER")!;
    expect(rescheduled.payload).toMatchObject({ managementUrl: `${appOrigin}/a/${newToken}` });
    expect(reminder.payload).not.toHaveProperty("managementUrl");
  });

  it("rolls back old cancellation and reminder changes if the new booking fails", async () => {
    const oldToken = `rollback-${randomUUID()}`;
    const collisionToken = `collision-${randomUUID()}`;
    const oldAppointment = await createAppointment(fixture, { token: oldToken });
    await createReminder(fixture, oldAppointment.id);
    await createAppointment(fixture, {
      token: collisionToken,
      staffId: fixture.staffB.id,
      startsAt: new Date("2026-09-14T11:00:00.000Z"),
    });

    await expect(
      rescheduleAppointmentByCapability(
        {
          token: oldToken,
          staffId: fixture.staffB.id,
          startsAt: new Date("2026-09-07T13:00:00.000Z"),
        },
        {
          database: db,
          clock,
          appOrigin,
          createManagementToken: () => collisionToken,
        },
      ),
    ).rejects.toBeTruthy();

    const [oldStored] = await db
      .select()
      .from(appointments)
      .where(eq(appointments.id, oldAppointment.id));
    expect(oldStored).toMatchObject({
      status: "SCHEDULED",
      cancelledAt: null,
      cancelledBy: null,
      cancellationKind: null,
      cancellationReason: null,
    });

    const [reminder] = await db
      .select({ status: notificationJobs.status })
      .from(notificationJobs)
      .where(
        and(
          eq(notificationJobs.appointmentId, oldAppointment.id),
          eq(notificationJobs.type, "APPOINTMENT_REMINDER"),
        ),
      );
    expect(reminder.status).toBe("PENDING");

    const [replacementCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(appointments)
      .where(eq(appointments.rescheduledFromId, oldAppointment.id));
    expect(replacementCount.count).toBe(0);
  });

  it("uses deterministic staff locking so opposite staff changes complete without a deadlock", async () => {
    const firstToken = `first-${randomUUID()}`;
    const secondToken = `second-${randomUUID()}`;
    const first = await createAppointment(fixture, {
      token: firstToken,
      staffId: fixture.staffA.id,
      startsAt: new Date("2026-09-07T11:00:00.000Z"),
    });
    const second = await createAppointment(fixture, {
      token: secondToken,
      staffId: fixture.staffB.id,
      startsAt: new Date("2026-09-07T11:30:00.000Z"),
    });

    const [firstResult, secondResult] = await Promise.all([
      rescheduleAppointmentByCapability(
        {
          token: firstToken,
          staffId: fixture.staffB.id,
          startsAt: new Date("2026-09-07T13:00:00.000Z"),
        },
        {
          database: db,
          clock,
          appOrigin,
          createManagementToken: () => `first-new-${randomUUID()}`,
        },
      ),
      rescheduleAppointmentByCapability(
        {
          token: secondToken,
          staffId: fixture.staffA.id,
          startsAt: new Date("2026-09-07T13:30:00.000Z"),
        },
        {
          database: db,
          clock,
          appOrigin,
          createManagementToken: () => `second-new-${randomUUID()}`,
        },
      ),
    ]);

    expect(firstResult.status).toBe("ok");
    expect(secondResult.status).toBe("ok");

    const originals = await db
      .select({ id: appointments.id, status: appointments.status, cancellationKind: appointments.cancellationKind })
      .from(appointments)
      .where(inArray(appointments.id, [first.id, second.id]));
    expect(originals).toHaveLength(2);
    expect(originals.every((row) => row.status === "CANCELLED")).toBe(true);
    expect(originals.every((row) => row.cancellationKind === "RESCHEDULED")).toBe(true);
  });
});
