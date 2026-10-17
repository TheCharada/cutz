import * as argon2 from "argon2";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getAdminAgenda } from "@/app/api/admin/b/[slug]/appointments/route";
import {
  GET as getAdminSettingsRoute,
  PATCH as patchAdminSettingsRoute,
} from "@/app/api/admin/b/[slug]/settings/route";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as logoutRoute } from "@/app/api/auth/logout/route";
import { GET as sessionRoute } from "@/app/api/auth/session/route";
import { getDb, getPool } from "@/infrastructure/db/client";
import {
  barbershopMemberships,
  barbershops,
  users,
  userSessions,
} from "@/infrastructure/db/schema";
import {
  authenticateAdminUser,
  issueAdminSession,
  resolveAdminPrincipal,
  revokeAdminSession,
} from "@/modules/identity";
import { FixedClock } from "@/shared/clock";
import { hashOpaqueToken } from "@/shared/tokens";
import { resolveAdminAccess } from "@/workflows/admin-auth";

const db = getDb();
const appOrigin = process.env.APP_ORIGIN ?? "http://127.0.0.1:3000";
process.env.APP_ORIGIN = appOrigin;

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createFixture() {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [tenantA] = await db
    .insert(barbershops)
    .values({
      name: `Identity A ${suffix}`,
      slug: `identity-a-${suffix}`,
      timezone: "America/Sao_Paulo",
      bookingIntervalMinutes: 15,
      customerVerificationMode: "NONE",
      waitlistOfferTtlMinutes: 10,
      reminderOffsetMinutes: 60,
    })
    .returning();
  const [tenantB] = await db
    .insert(barbershops)
    .values({
      name: `Identity B ${suffix}`,
      slug: `identity-b-${suffix}`,
      timezone: "America/Sao_Paulo",
      bookingIntervalMinutes: 15,
      customerVerificationMode: "NONE",
      waitlistOfferTtlMinutes: 10,
      reminderOffsetMinutes: 60,
    })
    .returning();

  const ownerPassword = `owner-${suffix}-password`;
  const staffPassword = `staff-${suffix}-password`;
  const [owner] = await db
    .insert(users)
    .values({
      email: `owner-${suffix}@example.test`,
      passwordHash: await argon2.hash(ownerPassword, { type: argon2.argon2id }),
    })
    .returning();
  const [staff] = await db
    .insert(users)
    .values({
      email: `staff-${suffix}@example.test`,
      passwordHash: await argon2.hash(staffPassword, { type: argon2.argon2id }),
    })
    .returning();

  await db.insert(barbershopMemberships).values([
    { userId: owner.id, barbershopId: tenantA.id, role: "OWNER" },
    { userId: staff.id, barbershopId: tenantA.id, role: "STAFF" },
  ]);

  return { tenantA, tenantB, owner, staff, ownerPassword, staffPassword };
}

async function cleanFixture(fixture: Fixture) {
  await db.delete(users).where(eq(users.id, fixture.owner.id));
  await db.delete(users).where(eq(users.id, fixture.staff.id));
  await db.delete(barbershops).where(eq(barbershops.id, fixture.tenantA.id));
  await db.delete(barbershops).where(eq(barbershops.id, fixture.tenantB.id));
}

function cookieFor(token: string) {
  return `cutz_admin_session=${token}`;
}

function request(path: string, init: RequestInit = {}) {
  return new Request(`${appOrigin}${path}`, init);
}

async function sessionFor(email: string, password: string) {
  const principal = await authenticateAdminUser(db, email, password);
  if (!principal) throw new Error("expected authenticated fixture user");
  return issueAdminSession(db, principal, new Date());
}

describe("admin identity and authorization", () => {
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

  it("authenticates Argon2id credentials and keeps invalid login responses generic", async () => {
    expect(fixture.owner.passwordHash.startsWith("$argon2id$")).toBe(true);

    const correct = await loginRoute(
      request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", origin: appOrigin },
        body: JSON.stringify({ email: fixture.owner.email, password: fixture.ownerPassword }),
      }),
    );
    expect(correct.status).toBe(200);
    const correctBody = (await correct.json()) as { user: { email: string }; memberships: Array<{ role: string }> };
    expect(correctBody.user.email).toBe(fixture.owner.email);
    expect(correctBody.memberships).toContainEqual(expect.objectContaining({ role: "OWNER" }));
    expect(correct.headers.get("set-cookie")).toContain("HttpOnly");
    expect(correct.headers.get("set-cookie")).toContain("SameSite=Lax");

    const wrongPassword = await loginRoute(
      request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", origin: appOrigin },
        body: JSON.stringify({ email: fixture.owner.email, password: "definitely-wrong" }),
      }),
    );
    const unknownUser = await loginRoute(
      request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", origin: appOrigin },
        body: JSON.stringify({ email: `missing-${crypto.randomUUID()}@example.test`, password: "definitely-wrong" }),
      }),
    );

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(await wrongPassword.json()).toEqual(await unknownUser.json());
    expect(await loginRoute(
      request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://invalid.example" },
        body: JSON.stringify({ email: fixture.owner.email, password: fixture.ownerPassword }),
      }),
    )).toMatchObject({ status: 403 });
  });

  it("stores only the SHA-256 session token, expires after seven days, and revokes on logout", async () => {
    const principal = await authenticateAdminUser(db, fixture.owner.email, fixture.ownerPassword);
    if (!principal) throw new Error("expected owner principal");
    const now = new Date("2026-09-05T12:00:00.000Z");
    const issued = await issueAdminSession(db, principal, now);

    const [stored] = await db.select().from(userSessions).where(eq(userSessions.userId, fixture.owner.id));
    expect(stored.tokenHash).toBe(hashOpaqueToken(issued.token));
    expect(stored.tokenHash).not.toBe(issued.token);
    expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.expiresAt.toISOString()).toBe("2026-09-12T12:00:00.000Z");

    expect(await resolveAdminPrincipal(db, issued.token, new Date("2026-09-12T11:59:59.999Z"))).not.toBeNull();
    expect(await resolveAdminPrincipal(db, issued.token, new Date("2026-09-12T12:00:00.000Z"))).toBeNull();

    const fresh = await issueAdminSession(db, principal, new Date());
    expect(await resolveAdminPrincipal(db, fresh.token, new Date())).not.toBeNull();
    await revokeAdminSession(db, fresh.token);
    expect(await resolveAdminPrincipal(db, fresh.token, new Date())).toBeNull();
  });

  it("serves session state and invalidates the same cookie on HTTP logout", async () => {
    const issued = await sessionFor(fixture.owner.email, fixture.ownerPassword);
    const headers = { cookie: cookieFor(issued.token) };

    const before = await sessionRoute(request("/api/auth/session", { headers }));
    expect(before.status).toBe(200);

    const logout = await logoutRoute(
      request("/api/auth/logout", {
        method: "POST",
        headers: { ...headers, origin: appOrigin },
      }),
    );
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");

    const after = await sessionRoute(request("/api/auth/session", { headers }));
    expect(after.status).toBe(401);
    const invalid = await sessionRoute(request("/api/auth/session", { headers: { cookie: cookieFor("invalid") } }));
    expect(invalid.status).toBe(401);
  });

  it("enforces tenant membership and the STAFF/OWNER role matrix", async () => {
    const ownerSession = await sessionFor(fixture.owner.email, fixture.ownerPassword);
    const staffSession = await sessionFor(fixture.staff.email, fixture.staffPassword);
    const ownerClock = new FixedClock(new Date());

    expect(await resolveAdminAccess(
      { sessionToken: ownerSession.token, slug: fixture.tenantA.slug, requiredRole: "OWNER" },
      { database: db, clock: ownerClock },
    )).toMatchObject({ status: "ok", membership: { role: "OWNER" } });
    expect(await resolveAdminAccess(
      { sessionToken: staffSession.token, slug: fixture.tenantA.slug, requiredRole: "STAFF" },
      { database: db, clock: ownerClock },
    )).toMatchObject({ status: "ok", membership: { role: "STAFF" } });
    expect(await resolveAdminAccess(
      { sessionToken: staffSession.token, slug: fixture.tenantA.slug, requiredRole: "OWNER" },
      { database: db, clock: ownerClock },
    )).toEqual({ status: "forbidden" });
    expect(await resolveAdminAccess(
      { sessionToken: ownerSession.token, slug: fixture.tenantB.slug, requiredRole: "STAFF" },
      { database: db, clock: ownerClock },
    )).toEqual({ status: "not-found" });

    const staffAgenda = await getAdminAgenda(
      request(`/api/admin/b/${fixture.tenantA.slug}/appointments`, {
        headers: { cookie: cookieFor(staffSession.token) },
      }),
      { params: Promise.resolve({ slug: fixture.tenantA.slug }) },
    );
    expect(staffAgenda.status).toBe(200);

    const staffSettings = await getAdminSettingsRoute(
      request(`/api/admin/b/${fixture.tenantA.slug}/settings`, {
        headers: { cookie: cookieFor(staffSession.token) },
      }),
      { params: Promise.resolve({ slug: fixture.tenantA.slug }) },
    );
    expect(staffSettings.status).toBe(403);

    const ownerSettings = await getAdminSettingsRoute(
      request(`/api/admin/b/${fixture.tenantA.slug}/settings`, {
        headers: { cookie: cookieFor(ownerSession.token) },
      }),
      { params: Promise.resolve({ slug: fixture.tenantA.slug }) },
    );
    expect(ownerSettings.status).toBe(200);

    const foreignAgenda = await getAdminAgenda(
      request(`/api/admin/b/${fixture.tenantB.slug}/appointments`, {
        headers: { cookie: cookieFor(ownerSession.token) },
      }),
      { params: Promise.resolve({ slug: fixture.tenantB.slug }) },
    );
    expect(foreignAgenda.status).toBe(404);
  });

  it("keeps settings OWNER-only, strict, and does not accept timezone or tenant in the body", async () => {
    const ownerSession = await sessionFor(fixture.owner.email, fixture.ownerPassword);
    const headers = {
      cookie: cookieFor(ownerSession.token),
      origin: appOrigin,
      "content-type": "application/json",
    };

    const timezoneAttempt = await patchAdminSettingsRoute(
      request(`/api/admin/b/${fixture.tenantA.slug}/settings`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ timezone: "UTC" }),
      }),
      { params: Promise.resolve({ slug: fixture.tenantA.slug }) },
    );
    expect(timezoneAttempt.status).toBe(400);

    const tenantAttempt = await patchAdminSettingsRoute(
      request(`/api/admin/b/${fixture.tenantA.slug}/settings`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ name: "Changed", barbershopId: fixture.tenantB.id }),
      }),
      { params: Promise.resolve({ slug: fixture.tenantA.slug }) },
    );
    expect(tenantAttempt.status).toBe(400);

    const changed = await patchAdminSettingsRoute(
      request(`/api/admin/b/${fixture.tenantA.slug}/settings`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          name: "Identity A updated",
          bookingIntervalMinutes: 20,
          waitlistOfferTtlMinutes: 12,
          reminderOffsetMinutes: 30,
        }),
      }),
      { params: Promise.resolve({ slug: fixture.tenantA.slug }) },
    );
    expect(changed.status).toBe(200);
    const body = (await changed.json()) as { settings: { name: string; timezone: string; bookingIntervalMinutes: number } };
    expect(body.settings).toMatchObject({
      name: "Identity A updated",
      timezone: "America/Sao_Paulo",
      bookingIntervalMinutes: 20,
    });
  });
});
