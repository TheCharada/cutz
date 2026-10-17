import * as argon2 from "argon2";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getOverviewRoute } from "@/app/api/admin/b/[slug]/analytics/overview/route";
import { getDb, getPool } from "@/infrastructure/db/client";
import {
  appointments,
  barbershopMemberships,
  barbershops,
  customers,
  services,
  staffMembers,
  userSessions,
  users,
  waitlistEntries,
  waitlistOffers,
} from "@/infrastructure/db/schema";
import { authenticateAdminUser, issueAdminSession } from "@/modules/identity";
import { hashOpaqueToken } from "@/shared/tokens";
import {
  getAdminAnalyticsOverview,
  getAdminCancellationAnalytics,
  getAdminNoShowAnalytics,
  getAdminWaitlistAnalytics,
} from "@/workflows/admin-analytics";

const db = getDb();
const appOrigin = process.env.APP_ORIGIN ?? "http://127.0.0.1:3000";
process.env.APP_ORIGIN = appOrigin;

type Fixture = Awaited<ReturnType<typeof createFixture>>;

function token(prefix: string) {
  return hashOpaqueToken(`${prefix}-${randomUUID()}`);
}

async function createFixture() {
  const suffix = randomUUID().slice(0, 8);
  const [tenantA, tenantB] = await db
    .insert(barbershops)
    .values([
      {
        name: `Analytics A ${suffix}`,
        slug: `analytics-a-${suffix}`,
        timezone: "America/Sao_Paulo",
        bookingIntervalMinutes: 15,
        customerVerificationMode: "NONE",
        waitlistOfferTtlMinutes: 10,
        reminderOffsetMinutes: 60,
      },
      {
        name: `Analytics B ${suffix}`,
        slug: `analytics-b-${suffix}`,
        timezone: "America/Sao_Paulo",
        bookingIntervalMinutes: 15,
        customerVerificationMode: "NONE",
        waitlistOfferTtlMinutes: 10,
        reminderOffsetMinutes: 60,
      },
    ])
    .returning();

  const [customerA, customerB] = await db
    .insert(customers)
    .values([
      { barbershopId: tenantA.id, name: "Cliente A", phoneE164: `+55117${Date.now().toString().slice(-8)}` },
      { barbershopId: tenantB.id, name: "Cliente B", phoneE164: `+55116${Date.now().toString().slice(-8)}` },
    ])
    .returning();
  const [serviceA, serviceB] = await db
    .insert(services)
    .values([
      { barbershopId: tenantA.id, name: "Corte A", durationMinutes: 30 },
      { barbershopId: tenantB.id, name: "Corte B", durationMinutes: 30 },
    ])
    .returning();
  const [staffA, staffB] = await db
    .insert(staffMembers)
    .values([
      { barbershopId: tenantA.id, name: "Profissional A" },
      { barbershopId: tenantB.id, name: "Profissional B" },
    ])
    .returning();

  const appointmentValues = [
    { startsAt: "2026-09-01T12:00:00.000Z", status: "COMPLETED" as const },
    { startsAt: "2026-09-01T13:00:00.000Z", status: "NO_SHOW" as const },
    {
      startsAt: "2026-09-01T14:00:00.000Z",
      status: "CANCELLED" as const,
      cancellationKind: "CANCELLATION" as const,
    },
    {
      startsAt: "2026-09-01T15:00:00.000Z",
      status: "CANCELLED" as const,
      cancellationKind: "RESCHEDULED" as const,
    },
    { startsAt: "2026-09-03T02:30:00.000Z", status: "NO_SHOW" as const },
    { startsAt: "2026-09-03T03:00:00.000Z", status: "NO_SHOW" as const },
    { startsAt: "2026-09-01T16:00:00.000Z", status: "SCHEDULED" as const },
  ];

  for (const item of appointmentValues) {
    const startsAt = new Date(item.startsAt);
    await db.insert(appointments).values({
      barbershopId: tenantA.id,
      customerId: customerA.id,
      staffId: staffA.id,
      serviceId: serviceA.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60_000),
      status: item.status,
      managementTokenHash: token("appointment-a"),
      ...(item.status === "CANCELLED"
        ? {
            cancelledAt: new Date(startsAt.getTime() - 60 * 60_000),
            cancelledBy: "STAFF" as const,
            cancellationKind: item.cancellationKind,
          }
        : {}),
    });
  }

  const foreignStart = new Date("2026-09-01T13:30:00.000Z");
  await db.insert(appointments).values({
    barbershopId: tenantB.id,
    customerId: customerB.id,
    staffId: staffB.id,
    serviceId: serviceB.id,
    startsAt: foreignStart,
    endsAt: new Date(foreignStart.getTime() + 30 * 60_000),
    status: "NO_SHOW",
    managementTokenHash: token("appointment-b"),
  });

  const entries = await db
    .insert(waitlistEntries)
    .values([
      {
        barbershopId: tenantA.id,
        customerId: customerA.id,
        serviceId: serviceA.id,
        staffId: staffA.id,
        desiredDate: "2026-09-01",
        earliestTime: "09:00",
        latestTime: "18:00",
        managementTokenHash: token("entry-a1"),
      },
      {
        barbershopId: tenantA.id,
        customerId: customerA.id,
        serviceId: serviceA.id,
        staffId: staffA.id,
        desiredDate: "2026-09-01",
        earliestTime: "09:00",
        latestTime: "18:00",
        managementTokenHash: token("entry-a2"),
      },
      {
        barbershopId: tenantA.id,
        customerId: customerA.id,
        serviceId: serviceA.id,
        staffId: staffA.id,
        desiredDate: "2026-09-02",
        earliestTime: "09:00",
        latestTime: "18:00",
        managementTokenHash: token("entry-a3"),
      },
      {
        barbershopId: tenantA.id,
        customerId: customerA.id,
        serviceId: serviceA.id,
        staffId: staffA.id,
        desiredDate: "2026-09-03",
        earliestTime: "00:00",
        latestTime: "23:59",
        managementTokenHash: token("entry-outside"),
      },
      {
        barbershopId: tenantB.id,
        customerId: customerB.id,
        serviceId: serviceB.id,
        staffId: staffB.id,
        desiredDate: "2026-09-01",
        earliestTime: "09:00",
        latestTime: "18:00",
        managementTokenHash: token("entry-b"),
      },
    ])
    .returning();

  const opportunity1 = randomUUID();
  const opportunity2 = randomUUID();
  const opportunityOutside = randomUUID();
  const foreignOpportunity = randomUUID();

  async function insertOffer(params: {
    barbershopId: string;
    entryId: string;
    staffId: string;
    opportunityId: string;
    startsAt: string;
    status: "ACCEPTED" | "REJECTED" | "EXPIRED";
  }) {
    const startsAt = new Date(params.startsAt);
    const createdAt = new Date(startsAt.getTime() - 60 * 60_000);
    await db.insert(waitlistOffers).values({
      barbershopId: params.barbershopId,
      waitlistEntryId: params.entryId,
      staffId: params.staffId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60_000),
      status: params.status,
      expiresAt: new Date(createdAt.getTime() + 10 * 60_000),
      actionTokenHash: token("offer"),
      opportunityId: params.opportunityId,
      opportunityStartsAt: startsAt,
      opportunityEndsAt: new Date(startsAt.getTime() + 30 * 60_000),
      createdAt,
      respondedAt: new Date(createdAt.getTime() + 5 * 60_000),
    });
  }

  await insertOffer({ barbershopId: tenantA.id, entryId: entries[0].id, staffId: staffA.id, opportunityId: opportunity1, startsAt: "2026-09-01T16:00:00.000Z", status: "REJECTED" });
  await insertOffer({ barbershopId: tenantA.id, entryId: entries[1].id, staffId: staffA.id, opportunityId: opportunity1, startsAt: "2026-09-01T16:00:00.000Z", status: "ACCEPTED" });
  await insertOffer({ barbershopId: tenantA.id, entryId: entries[2].id, staffId: staffA.id, opportunityId: opportunity2, startsAt: "2026-09-02T15:00:00.000Z", status: "EXPIRED" });
  await insertOffer({ barbershopId: tenantA.id, entryId: entries[3].id, staffId: staffA.id, opportunityId: opportunityOutside, startsAt: "2026-09-03T03:00:00.000Z", status: "ACCEPTED" });
  await insertOffer({ barbershopId: tenantB.id, entryId: entries[4].id, staffId: staffB.id, opportunityId: foreignOpportunity, startsAt: "2026-09-01T16:00:00.000Z", status: "ACCEPTED" });

  const ownerPassword = `owner-${suffix}-password`;
  const staffPassword = `staff-${suffix}-password`;
  const [owner, staffUser] = await db
    .insert(users)
    .values([
      { email: `owner-${suffix}@example.test`, passwordHash: await argon2.hash(ownerPassword, { type: argon2.argon2id }) },
      { email: `staff-${suffix}@example.test`, passwordHash: await argon2.hash(staffPassword, { type: argon2.argon2id }) },
    ])
    .returning();
  await db.insert(barbershopMemberships).values([
    { userId: owner.id, barbershopId: tenantA.id, role: "OWNER" },
    { userId: staffUser.id, barbershopId: tenantA.id, role: "STAFF" },
  ]);

  return {
    tenantA,
    tenantB,
    owner,
    staffUser,
    ownerPassword,
    staffPassword,
    barbershopA: {
      id: tenantA.id,
      slug: tenantA.slug,
      timezone: tenantA.timezone,
      bookingIntervalMinutes: tenantA.bookingIntervalMinutes,
      customerVerificationMode: tenantA.customerVerificationMode,
      waitlistOfferTtlMinutes: tenantA.waitlistOfferTtlMinutes,
      reminderOffsetMinutes: tenantA.reminderOffsetMinutes,
    },
  };
}

async function cleanFixture(fixture: Fixture) {
  const tenantIds = [fixture.tenantA.id, fixture.tenantB.id];
  const userIds = [fixture.owner.id, fixture.staffUser.id];
  await db.delete(waitlistOffers).where(inArray(waitlistOffers.barbershopId, tenantIds));
  await db.delete(waitlistEntries).where(inArray(waitlistEntries.barbershopId, tenantIds));
  await db.delete(appointments).where(inArray(appointments.barbershopId, tenantIds));
  await db.delete(userSessions).where(inArray(userSessions.userId, userIds));
  await db.delete(barbershopMemberships).where(inArray(barbershopMemberships.userId, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
  await db.delete(customers).where(inArray(customers.barbershopId, tenantIds));
  await db.delete(staffMembers).where(inArray(staffMembers.barbershopId, tenantIds));
  await db.delete(services).where(inArray(services.barbershopId, tenantIds));
  await db.delete(barbershops).where(inArray(barbershops.id, tenantIds));
}

function request(path: string, init: RequestInit = {}) {
  return new Request(`${appOrigin}${path}`, init);
}

async function sessionFor(email: string, password: string) {
  const principal = await authenticateAdminUser(db, email, password);
  if (!principal) throw new Error("expected authenticated fixture user");
  return issueAdminSession(db, principal, new Date());
}

function cookieFor(tokenValue: string) {
  return `cutz_admin_session=${tokenValue}`;
}

describe("admin analytics", () => {
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

  it("derives the frozen Slice 7 metrics from a known tenant dataset", async () => {
    const params = { barbershop: fixture.barbershopA, from: "2026-09-01", to: "2026-09-02" };
    const options = { database: db };

    const overview = await getAdminAnalyticsOverview(params, options);
    expect(overview).toMatchObject({
      cancellations: 1,
      noShows: 2,
      completed: 1,
      waitlist: {
        offersCreated: 3,
        offersAccepted: 1,
        opportunities: 2,
        opportunitiesRecovered: 1,
        recoveryRate: 0.5,
      },
    });
    expect(overview.noShowRate).toBeCloseTo(2 / 3);

    const cancellations = await getAdminCancellationAnalytics(params, options);
    expect(cancellations.total).toBe(1);
    expect(cancellations.items.find((item) => item.hour === 11)?.count).toBe(1);

    const noShows = await getAdminNoShowAnalytics(params, options);
    expect(noShows.total).toBe(2);
    expect(noShows.completed).toBe(1);
    expect(noShows.noShowRate).toBeCloseTo(2 / 3);
    expect(noShows.items.find((item) => item.weekday === "TUESDAY")?.count).toBe(1);
    expect(noShows.items.find((item) => item.weekday === "WEDNESDAY")?.count).toBe(1);

    const waitlist = await getAdminWaitlistAnalytics(params, options);
    expect(waitlist).toMatchObject({
      offersCreated: 3,
      offersAccepted: 1,
      opportunities: 2,
      opportunitiesRecovered: 1,
      recoveryRate: 0.5,
    });
  });

  it("uses local-day boundaries and never leaks another tenant", async () => {
    const overview = await getAdminAnalyticsOverview(
      { barbershop: fixture.barbershopA, from: "2026-09-02", to: "2026-09-02" },
      { database: db },
    );
    expect(overview.noShows).toBe(1);
    expect(overview.waitlist).toMatchObject({ offersCreated: 1, opportunities: 1, opportunitiesRecovered: 0 });
  });

  it("keeps analytics OWNER-only, returns 404 without membership, and validates ranges", async () => {
    const ownerSession = await sessionFor(fixture.owner.email, fixture.ownerPassword);
    const staffSession = await sessionFor(fixture.staffUser.email, fixture.staffPassword);
    const path = `/api/admin/b/${fixture.tenantA.slug}/analytics/overview?from=2026-09-01&to=2026-09-02`;

    const ownerResponse = await getOverviewRoute(
      request(path, { headers: { cookie: cookieFor(ownerSession.token) } }),
      { params: Promise.resolve({ slug: fixture.tenantA.slug }) },
    );
    expect(ownerResponse.status).toBe(200);

    const staffResponse = await getOverviewRoute(
      request(path, { headers: { cookie: cookieFor(staffSession.token) } }),
      { params: Promise.resolve({ slug: fixture.tenantA.slug }) },
    );
    expect(staffResponse.status).toBe(403);

    const foreignResponse = await getOverviewRoute(
      request(`/api/admin/b/${fixture.tenantB.slug}/analytics/overview?from=2026-09-01&to=2026-09-02`, {
        headers: { cookie: cookieFor(ownerSession.token) },
      }),
      { params: Promise.resolve({ slug: fixture.tenantB.slug }) },
    );
    expect(foreignResponse.status).toBe(404);

    const invalidResponse = await getOverviewRoute(
      request(`/api/admin/b/${fixture.tenantA.slug}/analytics/overview?from=2026-09-03&to=2026-09-01`, {
        headers: { cookie: cookieFor(ownerSession.token) },
      }),
      { params: Promise.resolve({ slug: fixture.tenantA.slug }) },
    );
    expect(invalidResponse.status).toBe(400);
  });
});
