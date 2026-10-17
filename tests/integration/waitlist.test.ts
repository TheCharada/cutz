import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, getPool } from "@/infrastructure/db/client";
import {
  appointments,
  barbershops,
  customerSessions,
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
import { cancelAppointmentByCapability } from "@/workflows/appointment-capability";
import { getPublicAvailabilityForBarbershop } from "@/workflows/public-catalog";
import { createPublicWaitlistEntry } from "@/workflows/public-waitlist";
import {
  acceptWaitlistOfferByCapability,
  cancelWaitlistEntryByCapability,
  rejectWaitlistOfferByCapability,
} from "@/workflows/waitlist-capability";
import { processExpiredWaitlistOffers } from "@/workflows/waitlist-expiration";

const db = getDb();
const appOrigin = "http://localhost:3000";
const desiredDate = "2026-09-07";
const releasedStartsAt = new Date("2026-09-07T12:00:00.000Z");
const releasedEndsAt = new Date("2026-09-07T13:00:00.000Z");
const releaseClock = new FixedClock(new Date("2026-09-06T10:00:00.000Z"));
const expiredClock = new FixedClock(new Date("2026-09-06T10:11:00.000Z"));

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createFixture() {
  const suffix = randomUUID().slice(0, 8);
  const [tenant] = await db
    .insert(barbershops)
    .values({
      name: `Waitlist ${suffix}`,
      slug: `waitlist-${suffix}`,
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
      name: "Waitlist Customer",
      phoneE164: `+5514${Math.floor(100000000 + Math.random() * 899999999)}`,
    })
    .returning();
  const [secondCustomer] = await db
    .insert(customers)
    .values({
      barbershopId: tenant.id,
      name: "Second Customer",
      phoneE164: `+5513${Math.floor(100000000 + Math.random() * 899999999)}`,
    })
    .returning();

  const [releasedService] = await db
    .insert(services)
    .values({ barbershopId: tenant.id, name: "Long service", durationMinutes: 60 })
    .returning();
  const [waitlistService] = await db
    .insert(services)
    .values({ barbershopId: tenant.id, name: "Short service", durationMinutes: 30 })
    .returning();
  const [tooLongService] = await db
    .insert(services)
    .values({ barbershopId: tenant.id, name: "Too long service", durationMinutes: 90 })
    .returning();
  const [staff] = await db
    .insert(staffMembers)
    .values({ barbershopId: tenant.id, name: "Waitlist Barber" })
    .returning();

  await db.insert(staffServices).values([
    { staffId: staff.id, serviceId: releasedService.id },
    { staffId: staff.id, serviceId: waitlistService.id },
    { staffId: staff.id, serviceId: tooLongService.id },
  ]);
  await db.insert(workingHours).values({
    staffId: staff.id,
    weekday: 1,
    startsAt: "08:00",
    endsAt: "12:00",
  });

  const sessionToken = `session-${randomUUID()}`;
  await db.insert(customerSessions).values({
    barbershopId: tenant.id,
    customerId: customer.id,
    tokenHash: hashOpaqueToken(sessionToken),
    verificationLevel: "UNVERIFIED",
    expiresAt: new Date("2026-09-08T10:00:00.000Z"),
  });

  return {
    tenant,
    customer,
    secondCustomer,
    releasedService,
    waitlistService,
    tooLongService,
    staff,
    sessionToken,
  };
}

async function cleanFixture(fixture: Fixture) {
  await db.delete(notificationJobs).where(eq(notificationJobs.barbershopId, fixture.tenant.id));
  await db.delete(waitlistOffers).where(eq(waitlistOffers.barbershopId, fixture.tenant.id));
  await db.delete(waitlistEntries).where(eq(waitlistEntries.barbershopId, fixture.tenant.id));
  await db.delete(appointments).where(eq(appointments.barbershopId, fixture.tenant.id));
  await db.delete(customerSessions).where(eq(customerSessions.barbershopId, fixture.tenant.id));
  await db.delete(workingHours).where(eq(workingHours.staffId, fixture.staff.id));
  await db.delete(staffServices).where(eq(staffServices.staffId, fixture.staff.id));
  await db.delete(customers).where(eq(customers.barbershopId, fixture.tenant.id));
  await db.delete(staffMembers).where(eq(staffMembers.id, fixture.staff.id));
  await db.delete(services).where(eq(services.barbershopId, fixture.tenant.id));
  await db.delete(barbershops).where(eq(barbershops.id, fixture.tenant.id));
}

async function createReleasedAppointment(fixture: Fixture, token: string) {
  const [appointment] = await db
    .insert(appointments)
    .values({
      barbershopId: fixture.tenant.id,
      customerId: fixture.customer.id,
      staffId: fixture.staff.id,
      serviceId: fixture.releasedService.id,
      startsAt: releasedStartsAt,
      endsAt: releasedEndsAt,
      managementTokenHash: hashOpaqueToken(token),
    })
    .returning();
  return appointment;
}

async function createEntry(
  fixture: Fixture,
  params: {
    customerId: string;
    token: string;
    createdAt: Date;
    id?: string;
    staffId?: string | null;
    serviceId?: string;
    status?: "ACTIVE" | "FULFILLED" | "CANCELLED" | "EXPIRED";
  },
) {
  const [entry] = await db
    .insert(waitlistEntries)
    .values({
      ...(params.id ? { id: params.id } : {}),
      barbershopId: fixture.tenant.id,
      customerId: params.customerId,
      serviceId: params.serviceId ?? fixture.waitlistService.id,
      staffId: params.staffId === undefined ? null : params.staffId,
      desiredDate,
      earliestTime: "08:30",
      latestTime: "10:30",
      status: params.status ?? "ACTIVE",
      managementTokenHash: hashOpaqueToken(params.token),
      createdAt: params.createdAt,
      updatedAt: params.createdAt,
    })
    .returning();
  return entry;
}

async function getOfferActionToken(offerId: string) {
  const [job] = await db
    .select({ payload: notificationJobs.payload })
    .from(notificationJobs)
    .where(
      and(
        eq(notificationJobs.type, "WAITLIST_OFFER"),
        eq(notificationJobs.waitlistOfferId, offerId),
      ),
    )
    .limit(1);
  if (!job) throw new Error("missing WAITLIST_OFFER notification job");
  const actionUrl = (job.payload as { actionUrl?: unknown }).actionUrl;
  if (typeof actionUrl !== "string") throw new Error("missing actionUrl in offer payload");
  const token = new URL(actionUrl).pathname.split("/").filter(Boolean).at(-1);
  if (!token) throw new Error("missing action token in offer URL");
  return token;
}

async function getScheduledAppointments(fixture: Fixture) {
  return db
    .select()
    .from(appointments)
    .where(
      and(
        eq(appointments.barbershopId, fixture.tenant.id),
        eq(appointments.status, "SCHEDULED"),
      ),
    );
}

async function expectReleasedStartBlocked(fixture: Fixture, clock: FixedClock) {
  const availability = await getPublicAvailabilityForBarbershop(
    {
      slug: fixture.tenant.slug,
      serviceId: fixture.waitlistService.id,
      staffId: fixture.staff.id,
      date: desiredDate,
    },
    { executor: db, clock },
  );
  expect(availability.status).toBe("ok");
  if (availability.status !== "ok") throw new Error("expected public availability");
  expect(availability.slots.some((slot) => slot.startsAt === releasedStartsAt.toISOString())).toBe(
    false,
  );
}

async function expectReleasedStartAvailable(fixture: Fixture, clock: FixedClock) {
  const availability = await getPublicAvailabilityForBarbershop(
    {
      slug: fixture.tenant.slug,
      serviceId: fixture.waitlistService.id,
      staffId: fixture.staff.id,
      date: desiredDate,
    },
    { executor: db, clock },
  );
  expect(availability.status).toBe("ok");
  if (availability.status !== "ok") throw new Error("expected public availability");
  expect(availability.slots.some((slot) => slot.startsAt === releasedStartsAt.toISOString())).toBe(
    true,
  );
}

describe("waitlist", () => {
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

  it("creates an ACTIVE public entry with a hashed management capability and notification job", async () => {
    const result = await createPublicWaitlistEntry(
      {
        slug: fixture.tenant.slug,
        sessionToken: fixture.sessionToken,
        serviceId: fixture.waitlistService.id,
        desiredDate,
        earliestTime: "08:30",
        latestTime: "10:30",
      },
      { database: db, clock: releaseClock, appOrigin },
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected waitlist entry creation");
    expect(result.entry).toMatchObject({ status: "ACTIVE", staffId: null });

    const managementToken = new URL(result.managementUrl).pathname.split("/").filter(Boolean).at(-1);
    expect(managementToken).toBeTruthy();
    const [stored] = await db
      .select({ managementTokenHash: waitlistEntries.managementTokenHash })
      .from(waitlistEntries)
      .where(eq(waitlistEntries.id, result.entry.id));
    expect(stored.managementTokenHash).toBe(hashOpaqueToken(managementToken!));
    expect(stored.managementTokenHash).not.toBe(managementToken);

    const jobs = await db
      .select({ type: notificationJobs.type, dedupeKey: notificationJobs.dedupeKey })
      .from(notificationJobs)
      .where(eq(notificationJobs.waitlistEntryId, result.entry.id));
    expect(jobs).toEqual([
      {
        type: "WAITLIST_ENTRY_CREATED",
        dedupeKey: `waitlist-entry:${result.entry.id}:created`,
      },
    ]);
  });

  it("orders FIFO by created_at,id, chains the same opportunity, and keeps expired PENDING holds blocking", async () => {
    const createdAt = new Date("2026-09-04T12:00:00.000Z");
    const first = await createEntry(fixture, {
      id: "00000000-0000-4000-8000-000000000101",
      customerId: fixture.customer.id,
      token: `entry-first-${randomUUID()}`,
      createdAt,
    });
    const second = await createEntry(fixture, {
      id: "00000000-0000-4000-8000-000000000102",
      customerId: fixture.secondCustomer.id,
      token: `entry-second-${randomUUID()}`,
      createdAt,
      staffId: fixture.staff.id,
    });
    const appointmentToken = `cancel-${randomUUID()}`;
    const released = await createReleasedAppointment(fixture, appointmentToken);

    const cancellation = await cancelAppointmentByCapability(
      { token: appointmentToken },
      { database: db, clock: releaseClock, appOrigin },
    );
    expect(cancellation.status).toBe("ok");
    if (cancellation.status !== "ok" || cancellation.waitlist.status !== "offered") {
      throw new Error("expected first waitlist offer");
    }

    const firstOffer = cancellation.waitlist.offer;
    expect(firstOffer).toMatchObject({
      waitlistEntryId: first.id,
      staffId: fixture.staff.id,
      status: "PENDING",
    });
    expect(firstOffer.endsAt.toISOString()).toBe("2026-09-07T12:30:00.000Z");

    const [storedReleased] = await db
      .select({ status: appointments.status })
      .from(appointments)
      .where(eq(appointments.id, released.id));
    expect(storedReleased.status).toBe("CANCELLED");
    const cancellationJobs = await db
      .select({ type: notificationJobs.type })
      .from(notificationJobs)
      .where(eq(notificationJobs.barbershopId, fixture.tenant.id));
    expect(cancellationJobs).toEqual(
      expect.arrayContaining([
        { type: "APPOINTMENT_CANCELLED" },
        { type: "WAITLIST_OFFER" },
      ]),
    );
    await expectReleasedStartBlocked(fixture, releaseClock);

    const expiredAcceptance = await acceptWaitlistOfferByCapability(
      await getOfferActionToken(firstOffer.id),
      { database: db, clock: expiredClock, appOrigin },
    );
    expect(expiredAcceptance).toMatchObject({ status: "offer-expired" });
    const [stillPending] = await db
      .select({ status: waitlistOffers.status })
      .from(waitlistOffers)
      .where(eq(waitlistOffers.id, firstOffer.id));
    expect(stillPending.status).toBe("PENDING");
    await expectReleasedStartBlocked(fixture, expiredClock);

    const processed = await processExpiredWaitlistOffers({ database: db, clock: expiredClock, appOrigin });
    expect(processed).toEqual({ scanned: 1, processed: 1 });

    const offers = await db
      .select()
      .from(waitlistOffers)
      .where(eq(waitlistOffers.opportunityId, firstOffer.opportunityId));
    expect(offers).toHaveLength(2);
    const expired = offers.find((offer) => offer.id === firstOffer.id)!;
    const next = offers.find((offer) => offer.id !== firstOffer.id)!;
    expect(expired.status).toBe("EXPIRED");
    expect(next).toMatchObject({ waitlistEntryId: second.id, status: "PENDING" });
    expect(next.opportunityId).toBe(firstOffer.opportunityId);

    const rejection = await rejectWaitlistOfferByCapability(await getOfferActionToken(next.id), {
      database: db,
      clock: expiredClock,
      appOrigin,
    });
    expect(rejection.status).toBe("ok");
    if (rejection.status !== "ok") throw new Error("expected rejection");
    expect(rejection.next.status).toBe("no-candidate");
    await expectReleasedStartAvailable(fixture, expiredClock);
  });

  it("skips inactive entries and services larger than the released opportunity", async () => {
    const createdAt = new Date("2026-09-04T12:00:00.000Z");
    await createEntry(fixture, {
      customerId: fixture.customer.id,
      token: `inactive-${randomUUID()}`,
      createdAt,
      status: "CANCELLED",
    });
    await createEntry(fixture, {
      customerId: fixture.customer.id,
      token: `too-long-${randomUUID()}`,
      createdAt: new Date(createdAt.getTime() + 1),
      serviceId: fixture.tooLongService.id,
    });
    const valid = await createEntry(fixture, {
      customerId: fixture.secondCustomer.id,
      token: `valid-${randomUUID()}`,
      createdAt: new Date(createdAt.getTime() + 2),
    });
    const appointmentToken = `cancel-${randomUUID()}`;
    await createReleasedAppointment(fixture, appointmentToken);

    const cancellation = await cancelAppointmentByCapability(
      { token: appointmentToken },
      { database: db, clock: releaseClock, appOrigin },
    );

    expect(cancellation.status).toBe("ok");
    if (cancellation.status !== "ok" || cancellation.waitlist.status !== "offered") {
      throw new Error("expected compatible candidate");
    }
    expect(cancellation.waitlist.offer.waitlistEntryId).toBe(valid.id);
  });

  it("creates exactly one appointment on double accept and makes later retries idempotent", async () => {
    const entry = await createEntry(fixture, {
      customerId: fixture.secondCustomer.id,
      token: `entry-${randomUUID()}`,
      createdAt: new Date("2026-09-04T12:00:00.000Z"),
    });
    const appointmentToken = `cancel-${randomUUID()}`;
    await createReleasedAppointment(fixture, appointmentToken);
    const cancellation = await cancelAppointmentByCapability(
      { token: appointmentToken },
      { database: db, clock: releaseClock, appOrigin },
    );
    if (cancellation.status !== "ok" || cancellation.waitlist.status !== "offered") {
      throw new Error("expected waitlist offer");
    }
    const offer = cancellation.waitlist.offer;
    const actionToken = await getOfferActionToken(offer.id);
    const acceptClock = new FixedClock(new Date("2026-09-06T10:05:00.000Z"));

    const results = await Promise.all([
      acceptWaitlistOfferByCapability(actionToken, {
        database: db,
        clock: acceptClock,
        appOrigin,
        createManagementToken: () => `winner-a-${randomUUID()}`,
      }),
      acceptWaitlistOfferByCapability(actionToken, {
        database: db,
        clock: acceptClock,
        appOrigin,
        createManagementToken: () => `winner-b-${randomUUID()}`,
      }),
    ]);

    expect(results.filter((result) => result.status === "ok")).toHaveLength(1);
    expect(results.filter((result) => result.status === "already-accepted")).toHaveLength(1);
    const accepted = results.find((result) => result.status === "ok");
    if (!accepted || accepted.status !== "ok") throw new Error("expected one accepted offer");

    const retry = await acceptWaitlistOfferByCapability(actionToken, {
      database: db,
      clock: acceptClock,
      appOrigin,
    });
    expect(retry).toEqual({ status: "already-accepted", appointmentId: accepted.appointment.id });

    const [storedOffer] = await db.select().from(waitlistOffers).where(eq(waitlistOffers.id, offer.id));
    const [storedEntry] = await db.select().from(waitlistEntries).where(eq(waitlistEntries.id, entry.id));
    expect(storedOffer).toMatchObject({ status: "ACCEPTED", appointmentId: accepted.appointment.id });
    expect(storedEntry.status).toBe("FULFILLED");

    const scheduled = await getScheduledAppointments(fixture);
    expect(scheduled).toHaveLength(1);
    const acceptedManagementToken = new URL(accepted.managementUrl).pathname
      .split("/")
      .filter(Boolean)
      .at(-1);
    expect(acceptedManagementToken).toBeTruthy();
    expect(scheduled[0]).toMatchObject({
      id: accepted.appointment.id,
      serviceId: fixture.waitlistService.id,
      staffId: fixture.staff.id,
      managementTokenHash: hashOpaqueToken(acceptedManagementToken!),
    });

    const appointmentJobs = await db
      .select({ type: notificationJobs.type })
      .from(notificationJobs)
      .where(eq(notificationJobs.appointmentId, accepted.appointment.id));
    expect(appointmentJobs.filter((job) => job.type === "APPOINTMENT_CREATED")).toHaveLength(1);
  });

  it("cancels an ACTIVE entry with a pending offer and advances the next candidate in the same opportunity", async () => {
    const firstToken = `entry-first-${randomUUID()}`;
    const first = await createEntry(fixture, {
      customerId: fixture.customer.id,
      token: firstToken,
      createdAt: new Date("2026-09-04T12:00:00.000Z"),
    });
    const second = await createEntry(fixture, {
      customerId: fixture.secondCustomer.id,
      token: `entry-second-${randomUUID()}`,
      createdAt: new Date("2026-09-04T12:01:00.000Z"),
    });
    const appointmentToken = `cancel-${randomUUID()}`;
    await createReleasedAppointment(fixture, appointmentToken);
    const cancellation = await cancelAppointmentByCapability(
      { token: appointmentToken },
      { database: db, clock: releaseClock, appOrigin },
    );
    if (cancellation.status !== "ok" || cancellation.waitlist.status !== "offered") {
      throw new Error("expected first waitlist offer");
    }
    const firstOffer = cancellation.waitlist.offer;
    expect(firstOffer.waitlistEntryId).toBe(first.id);

    const cancelled = await cancelWaitlistEntryByCapability(firstToken, {
      database: db,
      clock: releaseClock,
      appOrigin,
    });
    expect(cancelled).toMatchObject({ status: "ok", changed: true });

    const offers = await db
      .select()
      .from(waitlistOffers)
      .where(eq(waitlistOffers.opportunityId, firstOffer.opportunityId));
    expect(offers).toHaveLength(2);
    expect(offers.find((offer) => offer.id === firstOffer.id)?.status).toBe("REJECTED");
    expect(offers.find((offer) => offer.id !== firstOffer.id)).toMatchObject({
      waitlistEntryId: second.id,
      status: "PENDING",
      opportunityId: firstOffer.opportunityId,
    });
  });

  it("processes one expired offer only once when two processors race", async () => {
    await createEntry(fixture, {
      customerId: fixture.customer.id,
      token: `entry-first-${randomUUID()}`,
      createdAt: new Date("2026-09-04T12:00:00.000Z"),
    });
    await createEntry(fixture, {
      customerId: fixture.secondCustomer.id,
      token: `entry-second-${randomUUID()}`,
      createdAt: new Date("2026-09-04T12:01:00.000Z"),
    });
    const appointmentToken = `cancel-${randomUUID()}`;
    await createReleasedAppointment(fixture, appointmentToken);
    const cancellation = await cancelAppointmentByCapability(
      { token: appointmentToken },
      { database: db, clock: releaseClock, appOrigin },
    );
    if (cancellation.status !== "ok" || cancellation.waitlist.status !== "offered") {
      throw new Error("expected first waitlist offer");
    }

    const results = await Promise.all([
      processExpiredWaitlistOffers({ database: db, clock: expiredClock, appOrigin }),
      processExpiredWaitlistOffers({ database: db, clock: expiredClock, appOrigin }),
    ]);
    expect(results.reduce((sum, result) => sum + result.processed, 0)).toBe(1);

    const offers = await db
      .select()
      .from(waitlistOffers)
      .where(eq(waitlistOffers.opportunityId, cancellation.waitlist.offer.opportunityId));
    expect(offers.filter((offer) => offer.status === "EXPIRED")).toHaveLength(1);
    expect(offers.filter((offer) => offer.status === "PENDING")).toHaveLength(1);
  });

  it("serializes expire versus accept so the offer has one terminal outcome and never duplicates appointments", async () => {
    await createEntry(fixture, {
      customerId: fixture.secondCustomer.id,
      token: `entry-${randomUUID()}`,
      createdAt: new Date("2026-09-04T12:00:00.000Z"),
    });
    const appointmentToken = `cancel-${randomUUID()}`;
    await createReleasedAppointment(fixture, appointmentToken);
    const cancellation = await cancelAppointmentByCapability(
      { token: appointmentToken },
      { database: db, clock: releaseClock, appOrigin },
    );
    if (cancellation.status !== "ok" || cancellation.waitlist.status !== "offered") {
      throw new Error("expected waitlist offer");
    }
    const offer = cancellation.waitlist.offer;
    const actionToken = await getOfferActionToken(offer.id);

    const [acceptance, expiration] = await Promise.all([
      acceptWaitlistOfferByCapability(actionToken, {
        database: db,
        clock: new FixedClock(new Date("2026-09-06T10:09:59.000Z")),
        appOrigin,
        createManagementToken: () => `race-${randomUUID()}`,
      }),
      processExpiredWaitlistOffers({ database: db, clock: expiredClock, appOrigin }),
    ]);

    const [storedOffer] = await db.select().from(waitlistOffers).where(eq(waitlistOffers.id, offer.id));
    const scheduled = await getScheduledAppointments(fixture);
    expect(["ACCEPTED", "EXPIRED"]).toContain(storedOffer.status);
    expect(scheduled.length).toBeLessThanOrEqual(1);

    if (storedOffer.status === "ACCEPTED") {
      expect(acceptance.status).toBe("ok");
      expect(expiration.processed).toBe(0);
      expect(scheduled).toHaveLength(1);
    } else {
      expect(acceptance.status).toBe("offer-expired");
      expect(expiration.processed).toBe(1);
      expect(scheduled).toHaveLength(0);
    }
  });
});
