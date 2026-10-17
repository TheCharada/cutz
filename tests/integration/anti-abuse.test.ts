import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, getPool } from "@/infrastructure/db/client";
import {
  appointments,
  barbershops,
  customers,
  customerSessions,
  notificationJobs,
  services,
  staffMembers,
  staffServices,
  waitlistEntries,
  waitlistOffers,
  workingHours,
} from "@/infrastructure/db/schema";
import { FixedClock } from "@/shared/clock";
import { createPublicAppointment } from "@/workflows/public-appointment";
import { startPublicCustomerSession } from "@/workflows/customer-session";
import { createPublicWaitlistEntry } from "@/workflows/public-waitlist";

const db = getDb();
const appOrigin = "http://localhost:3000";
const clock = new FixedClock(new Date("2026-09-07T10:00:00.000Z"));

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createFixture() {
  const suffix = randomUUID().slice(0, 8);
  const [barbershop] = await db
    .insert(barbershops)
    .values({
      name: `Anti abuse ${suffix}`,
      slug: `anti-abuse-${suffix}`,
      timezone: "America/Sao_Paulo",
      bookingIntervalMinutes: 30,
      customerVerificationMode: "NONE",
      waitlistOfferTtlMinutes: 10,
      reminderOffsetMinutes: 1440,
    })
    .returning();
  const [service] = await db
    .insert(services)
    .values({ barbershopId: barbershop.id, name: "Corte", durationMinutes: 30 })
    .returning();
  const [staff] = await db
    .insert(staffMembers)
    .values({ barbershopId: barbershop.id, name: "Barbeiro" })
    .returning();
  await db.insert(staffServices).values({ staffId: staff.id, serviceId: service.id });
  await db.insert(workingHours).values({
    staffId: staff.id,
    weekday: 1,
    startsAt: "08:00",
    endsAt: "12:00",
  });

  const sessionResult = await startPublicCustomerSession(
    { slug: barbershop.slug, name: "Cliente", phone: "+5514999995555" },
    { database: db, clock, defaultPhoneCountry: "BR" },
  );
  if (sessionResult.status !== "ok") throw new Error(`unexpected session status ${sessionResult.status}`);

  return { barbershop, service, staff, session: sessionResult.session };
}

async function cleanup(fixture: Fixture) {
  await db.delete(notificationJobs).where(eq(notificationJobs.barbershopId, fixture.barbershop.id));
  await db.delete(waitlistOffers).where(eq(waitlistOffers.barbershopId, fixture.barbershop.id));
  await db.delete(waitlistEntries).where(eq(waitlistEntries.barbershopId, fixture.barbershop.id));
  await db.delete(appointments).where(eq(appointments.barbershopId, fixture.barbershop.id));
  await db.delete(customerSessions).where(eq(customerSessions.barbershopId, fixture.barbershop.id));
  await db.delete(customers).where(eq(customers.barbershopId, fixture.barbershop.id));
  await db.delete(workingHours).where(eq(workingHours.staffId, fixture.staff.id));
  await db.delete(staffServices).where(eq(staffServices.staffId, fixture.staff.id));
  await db.delete(staffMembers).where(eq(staffMembers.id, fixture.staff.id));
  await db.delete(services).where(eq(services.id, fixture.service.id));
  await db.delete(barbershops).where(eq(barbershops.id, fixture.barbershop.id));
}

describe("MVP anti-abuse domain limits", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await createFixture();
  });

  afterEach(async () => {
    await cleanup(fixture);
  });

  afterAll(async () => {
    await getPool().end();
  });

  it("serializes concurrent appointment creation and enforces the future appointment limit", async () => {
    const makeAppointment = (startsAt: string) =>
      createPublicAppointment(
        {
          slug: fixture.barbershop.slug,
          sessionToken: fixture.session.token,
          serviceId: fixture.service.id,
          staffId: fixture.staff.id,
          startsAt: new Date(startsAt),
        },
        { database: db, clock, appOrigin, maxFutureAppointments: 1 },
      );

    const [first, second] = await Promise.all([
      makeAppointment("2026-09-07T11:00:00.000Z"),
      makeAppointment("2026-09-07T11:30:00.000Z"),
    ]);

    expect([first.status, second.status].sort()).toEqual(["future-appointment-limit", "ok"]);
    const rows = await db
      .select({ id: appointments.id })
      .from(appointments)
      .where(eq(appointments.barbershopId, fixture.barbershop.id));
    expect(rows).toHaveLength(1);
  });

  it("serializes concurrent waitlist creation and enforces the active-entry limit", async () => {
    const makeEntry = (earliestTime: string, latestTime: string) =>
      createPublicWaitlistEntry(
        {
          slug: fixture.barbershop.slug,
          sessionToken: fixture.session.token,
          serviceId: fixture.service.id,
          desiredDate: "2026-09-08",
          earliestTime,
          latestTime,
        },
        { database: db, clock, appOrigin, maxActiveWaitlistEntries: 1 },
      );

    const [first, second] = await Promise.all([
      makeEntry("08:00", "10:00"),
      makeEntry("10:00", "12:00"),
    ]);

    expect([first.status, second.status].sort()).toEqual(["active-waitlist-limit", "ok"]);
    const rows = await db
      .select({ id: waitlistEntries.id })
      .from(waitlistEntries)
      .where(eq(waitlistEntries.barbershopId, fixture.barbershop.id));
    expect(rows).toHaveLength(1);
  });

  it("counts limits independently across tenants", async () => {
    const other = await createFixture();
    try {
      const [first, second] = await Promise.all([
        createPublicWaitlistEntry(
          {
            slug: fixture.barbershop.slug,
            sessionToken: fixture.session.token,
            serviceId: fixture.service.id,
            desiredDate: "2026-09-08",
            earliestTime: "08:00",
            latestTime: "10:00",
          },
          { database: db, clock, appOrigin, maxActiveWaitlistEntries: 1 },
        ),
        createPublicWaitlistEntry(
          {
            slug: other.barbershop.slug,
            sessionToken: other.session.token,
            serviceId: other.service.id,
            desiredDate: "2026-09-08",
            earliestTime: "08:00",
            latestTime: "10:00",
          },
          { database: db, clock, appOrigin, maxActiveWaitlistEntries: 1 },
        ),
      ]);
      expect(first.status).toBe("ok");
      expect(second.status).toBe("ok");
    } finally {
      await cleanup(other);
    }
  });
});
