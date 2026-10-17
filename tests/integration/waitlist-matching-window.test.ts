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
import { hashOpaqueToken } from "@/shared/tokens";
import { reserveNextWaitlistOfferForOpportunity } from "@/workflows/waitlist-opportunity";

const db = getDb();
const opportunityStartsAt = new Date("2026-09-07T12:00:00.000Z");
const opportunityEndsAt = new Date("2026-09-07T13:00:00.000Z");

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createFixture() {
  const suffix = randomUUID().slice(0, 8);
  const [tenant] = await db
    .insert(barbershops)
    .values({
      name: `Matching ${suffix}`,
      slug: `matching-${suffix}`,
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
    .values({ barbershopId: tenant.id, name: "Corte curto", durationMinutes: 30 })
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
  const [entry] = await db
    .insert(waitlistEntries)
    .values({
      barbershopId: tenant.id,
      customerId: customer.id,
      serviceId: service.id,
      desiredDate: "2026-09-07",
      earliestTime: "09:30",
      latestTime: "10:00",
      managementTokenHash: hashOpaqueToken(`entry-${randomUUID()}`),
      createdAt: new Date("2026-09-04T12:00:00.000Z"),
    })
    .returning();
  return { tenant, customer, service, staff, entry };
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

async function reserve(fixture: Fixture, now: Date, token: string) {
  return db.transaction(async (tx) => {
    await lockStaffMembersForUpdate(tx, fixture.tenant.id, [fixture.staff.id]);
    return reserveNextWaitlistOfferForOpportunity(tx, {
      barbershop: fixture.tenant,
      staffId: fixture.staff.id,
      opportunityId: randomUUID(),
      opportunityStartsAt,
      opportunityEndsAt,
      now,
      appOrigin: "http://localhost:3000",
      createActionToken: () => token,
    });
  });
}

describe("waitlist opportunity matching", () => {
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

  it("offers the first compatible grid slot inside the released opportunity and customer window", async () => {
    const result = await reserve(fixture, new Date("2026-09-06T10:00:00.000Z"), "fixed-offer-token");

    expect(result.status).toBe("offered");
    if (result.status !== "offered") throw new Error("expected a waitlist offer");
    expect(result.offer.waitlistEntryId).toBe(fixture.entry.id);
    expect(result.offer.startsAt.toISOString()).toBe("2026-09-07T12:30:00.000Z");
    expect(result.offer.endsAt.toISOString()).toBe("2026-09-07T13:00:00.000Z");
    expect(result.offer.opportunityStartsAt.toISOString()).toBe(opportunityStartsAt.toISOString());
    expect(result.offer.opportunityEndsAt.toISOString()).toBe(opportunityEndsAt.toISOString());
    expect(result.actionUrl).toBe("http://localhost:3000/o/fixed-offer-token");
  });

  it("clamps offer expiry to the offered start when TTL would run past it", async () => {
    const result = await reserve(fixture, new Date("2026-09-07T12:25:00.000Z"), "near-start-token");

    expect(result.status).toBe("offered");
    if (result.status !== "offered") throw new Error("expected a waitlist offer");
    expect(result.offer.startsAt.toISOString()).toBe("2026-09-07T12:30:00.000Z");
    expect(result.offer.expiresAt.toISOString()).toBe("2026-09-07T12:30:00.000Z");
  });

  it("does not create an offer whose slot starts at or before now", async () => {
    const result = await reserve(fixture, new Date("2026-09-07T12:30:00.000Z"), "too-late-token");
    expect(result).toEqual({ status: "no-candidate" });
  });
});
