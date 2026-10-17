import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, getPool } from "@/infrastructure/db/client";
import {
  barbershops,
  customerSessions,
  customers,
  services,
  staffMembers,
  waitlistEntries,
  waitlistOffers,
} from "@/infrastructure/db/schema";
import { FixedClock } from "@/shared/clock";
import { hashOpaqueToken } from "@/shared/tokens";
import { createPublicWaitlistEntry } from "@/workflows/public-waitlist";
import { processExpiredWaitlistEntries } from "@/workflows/waitlist-entry-expiration";

const db = getDb();
const now = new Date("2026-09-07T14:00:00.000Z");
const clock = new FixedClock(now);

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createFixture() {
  const suffix = randomUUID().slice(0, 8);
  const [tenant] = await db
    .insert(barbershops)
    .values({
      name: `Entry sweep ${suffix}`,
      slug: `entry-sweep-${suffix}`,
      timezone: "America/Sao_Paulo",
      bookingIntervalMinutes: 30,
      customerVerificationMode: "NONE",
      waitlistOfferTtlMinutes: 10,
      reminderOffsetMinutes: 1440,
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
  const createdCustomers = await db
    .insert(customers)
    .values([
      { barbershopId: tenant.id, name: "Expired", phoneE164: `+551410${Date.now()}` },
      { barbershopId: tenant.id, name: "Held", phoneE164: `+551411${Date.now()}` },
      { barbershopId: tenant.id, name: "Future", phoneE164: `+551412${Date.now()}` },
    ])
    .returning();
  const sessionToken = `session-${randomUUID()}`;
  await db.insert(customerSessions).values({
    barbershopId: tenant.id,
    customerId: createdCustomers[0].id,
    tokenHash: hashOpaqueToken(sessionToken),
    verificationLevel: "UNVERIFIED",
    expiresAt: new Date("2026-09-08T14:00:00.000Z"),
  });

  const [expiredEntry, heldEntry, futureEntry] = await db
    .insert(waitlistEntries)
    .values([
      {
        barbershopId: tenant.id,
        customerId: createdCustomers[0].id,
        serviceId: service.id,
        desiredDate: "2026-09-07",
        earliestTime: "08:00",
        latestTime: "10:00",
        managementTokenHash: hashOpaqueToken(`expired-${randomUUID()}`),
      },
      {
        barbershopId: tenant.id,
        customerId: createdCustomers[1].id,
        serviceId: service.id,
        desiredDate: "2026-09-07",
        earliestTime: "08:00",
        latestTime: "10:00",
        managementTokenHash: hashOpaqueToken(`held-${randomUUID()}`),
      },
      {
        barbershopId: tenant.id,
        customerId: createdCustomers[2].id,
        serviceId: service.id,
        desiredDate: "2026-09-07",
        earliestTime: "11:00",
        latestTime: "12:00",
        managementTokenHash: hashOpaqueToken(`future-${randomUUID()}`),
      },
    ])
    .returning();

  await db.insert(waitlistOffers).values({
    barbershopId: tenant.id,
    waitlistEntryId: heldEntry.id,
    staffId: staff.id,
    startsAt: new Date("2026-09-07T12:00:00.000Z"),
    endsAt: new Date("2026-09-07T12:30:00.000Z"),
    status: "PENDING",
    expiresAt: new Date("2026-09-07T13:00:00.000Z"),
    actionTokenHash: hashOpaqueToken(`offer-${randomUUID()}`),
    opportunityId: randomUUID(),
    opportunityStartsAt: new Date("2026-09-07T12:00:00.000Z"),
    opportunityEndsAt: new Date("2026-09-07T12:30:00.000Z"),
    createdAt: new Date("2026-09-07T12:50:00.000Z"),
  });

  return {
    tenant,
    service,
    staff,
    customers: createdCustomers,
    sessionToken,
    expiredEntry,
    heldEntry,
    futureEntry,
  };
}

async function cleanFixture(fixture: Fixture) {
  await db.delete(waitlistOffers).where(eq(waitlistOffers.barbershopId, fixture.tenant.id));
  await db.delete(waitlistEntries).where(eq(waitlistEntries.barbershopId, fixture.tenant.id));
  await db.delete(customerSessions).where(eq(customerSessions.barbershopId, fixture.tenant.id));
  await db.delete(customers).where(eq(customers.barbershopId, fixture.tenant.id));
  await db.delete(staffMembers).where(eq(staffMembers.id, fixture.staff.id));
  await db.delete(services).where(eq(services.id, fixture.service.id));
  await db.delete(barbershops).where(eq(barbershops.id, fixture.tenant.id));
}

describe("waitlist entry expiration", () => {
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

  it("expires a same-day entry after its local window but preserves entries with PENDING offers", async () => {
    const result = await processExpiredWaitlistEntries({ database: db, clock });
    expect(result).toEqual({ scanned: 2, processed: 1 });

    const rows = await db
      .select({ id: waitlistEntries.id, status: waitlistEntries.status })
      .from(waitlistEntries)
      .where(eq(waitlistEntries.barbershopId, fixture.tenant.id));
    const statuses = new Map(rows.map((row) => [row.id, row.status]));
    expect(statuses.get(fixture.expiredEntry.id)).toBe("EXPIRED");
    expect(statuses.get(fixture.heldEntry.id)).toBe("ACTIVE");
    expect(statuses.get(fixture.futureEntry.id)).toBe("ACTIVE");
  });

  it("does not create an already-ended same-day window as ACTIVE", async () => {
    const before = await db
      .select({ id: waitlistEntries.id })
      .from(waitlistEntries)
      .where(eq(waitlistEntries.barbershopId, fixture.tenant.id));

    const result = await createPublicWaitlistEntry(
      {
        slug: fixture.tenant.slug,
        sessionToken: fixture.sessionToken,
        serviceId: fixture.service.id,
        desiredDate: "2026-09-07",
        earliestTime: "08:00",
        latestTime: "10:00",
      },
      { database: db, clock, appOrigin: "http://localhost:3000" },
    );

    expect(result).toEqual({ status: "invalid-window" });
    const after = await db
      .select({ id: waitlistEntries.id })
      .from(waitlistEntries)
      .where(eq(waitlistEntries.barbershopId, fixture.tenant.id));
    expect(after).toHaveLength(before.length);
  });
});
