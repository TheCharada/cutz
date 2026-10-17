import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, getPool } from "@/infrastructure/db/client";
import {
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
import { lockStaffMembersForUpdate } from "@/modules/catalog";
import { lockWaitlistEntryById } from "@/modules/waitlist";
import { FixedClock } from "@/shared/clock";
import { hashOpaqueToken } from "@/shared/tokens";
import {
  cancelWaitlistEntryByCapability,
  rejectWaitlistOfferByCapability,
} from "@/workflows/waitlist-capability";

const db = getDb();
const clock = new FixedClock(new Date("2026-09-06T10:00:00.000Z"));
const appOrigin = "http://localhost:3000";

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createFixture() {
  const suffix = randomUUID().slice(0, 8);
  const [tenant] = await db
    .insert(barbershops)
    .values({
      name: `Capability race ${suffix}`,
      slug: `capability-race-${suffix}`,
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
      name: "Cliente",
      phoneE164: `+551499${Date.now()}`,
    })
    .returning();
  const [service] = await db
    .insert(services)
    .values({ barbershopId: tenant.id, name: "Corte", durationMinutes: 30 })
    .returning();
  const [staff] = await db
    .insert(staffMembers)
    .values({ barbershopId: tenant.id, name: "Barbeiro" })
    .returning();
  await db.insert(staffServices).values({ staffId: staff.id, serviceId: service.id });
  await db.insert(workingHours).values({
    staffId: staff.id,
    weekday: 1,
    startsAt: "08:00",
    endsAt: "12:00",
  });

  const managementToken = `entry-${randomUUID()}`;
  const [entry] = await db
    .insert(waitlistEntries)
    .values({
      barbershopId: tenant.id,
      customerId: customer.id,
      serviceId: service.id,
      staffId: staff.id,
      desiredDate: "2026-09-07",
      earliestTime: "09:00",
      latestTime: "10:00",
      managementTokenHash: hashOpaqueToken(managementToken),
    })
    .returning();

  return { tenant, customer, service, staff, entry, managementToken };
}

async function cleanFixture(fixture: Fixture) {
  await db.delete(notificationJobs).where(eq(notificationJobs.barbershopId, fixture.tenant.id));
  await db.delete(waitlistOffers).where(eq(waitlistOffers.barbershopId, fixture.tenant.id));
  await db.delete(waitlistEntries).where(eq(waitlistEntries.barbershopId, fixture.tenant.id));
  await db.delete(workingHours).where(eq(workingHours.staffId, fixture.staff.id));
  await db.delete(staffServices).where(eq(staffServices.staffId, fixture.staff.id));
  await db.delete(customers).where(eq(customers.barbershopId, fixture.tenant.id));
  await db.delete(staffMembers).where(eq(staffMembers.id, fixture.staff.id));
  await db.delete(services).where(eq(services.id, fixture.service.id));
  await db.delete(barbershops).where(eq(barbershops.id, fixture.tenant.id));
}

function offerValues(fixture: Fixture, actionToken: string) {
  return {
    barbershopId: fixture.tenant.id,
    waitlistEntryId: fixture.entry.id,
    staffId: fixture.staff.id,
    startsAt: new Date("2026-09-07T12:00:00.000Z"),
    endsAt: new Date("2026-09-07T12:30:00.000Z"),
    expiresAt: new Date("2026-09-06T10:10:00.000Z"),
    actionTokenHash: hashOpaqueToken(actionToken),
    opportunityId: randomUUID(),
    opportunityStartsAt: new Date("2026-09-07T12:00:00.000Z"),
    opportunityEndsAt: new Date("2026-09-07T13:00:00.000Z"),
    createdAt: new Date("2026-09-06T10:00:00.000Z"),
  };
}

describe("waitlist capability concurrency", () => {
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

  it("does not leave a PENDING offer when one appears while entry cancellation is acquiring its lock", async () => {
    let releaseOffer!: () => void;
    let entryLocked!: () => void;
    const allowOffer = new Promise<void>((resolve) => {
      releaseOffer = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      entryLocked = resolve;
    });

    const actionToken = `offer-${randomUUID()}`;
    const creator = db.transaction(async (tx) => {
      await lockStaffMembersForUpdate(tx, fixture.tenant.id, [fixture.staff.id]);
      await lockWaitlistEntryById(tx, fixture.entry.id);
      entryLocked();
      await allowOffer;
      await tx.insert(waitlistOffers).values(offerValues(fixture, actionToken));
    });

    await locked;
    const cancellation = cancelWaitlistEntryByCapability(fixture.managementToken, {
      database: db,
      clock,
      appOrigin,
    });

    await new Promise((resolve) => setTimeout(resolve, 75));
    releaseOffer();
    await creator;
    const result = await cancellation;

    expect(result).toMatchObject({ status: "ok", changed: true });
    const [entry] = await db
      .select({ status: waitlistEntries.status })
      .from(waitlistEntries)
      .where(eq(waitlistEntries.id, fixture.entry.id));
    expect(entry.status).toBe("CANCELLED");

    const offers = await db
      .select({ status: waitlistOffers.status })
      .from(waitlistOffers)
      .where(eq(waitlistOffers.waitlistEntryId, fixture.entry.id));
    expect(offers).toEqual([{ status: "REJECTED" }]);
  });

  it("makes repeated rejection idempotent without creating another chain", async () => {
    const actionToken = `offer-${randomUUID()}`;
    await db.insert(waitlistOffers).values(offerValues(fixture, actionToken));

    const first = await rejectWaitlistOfferByCapability(actionToken, { database: db, clock, appOrigin });
    expect(first.status).toBe("ok");

    const second = await rejectWaitlistOfferByCapability(actionToken, { database: db, clock, appOrigin });
    expect(second.status).toBe("already-rejected");

    const offers = await db
      .select({ status: waitlistOffers.status })
      .from(waitlistOffers)
      .where(eq(waitlistOffers.waitlistEntryId, fixture.entry.id));
    expect(offers).toEqual([{ status: "REJECTED" }]);
  });
});
