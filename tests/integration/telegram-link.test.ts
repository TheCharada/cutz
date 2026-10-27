import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, getPool } from "@/infrastructure/db/client";
import {
  appointments,
  barbershops,
  customers,
  services,
  staffMembers,
  telegramChatLinks,
  telegramContactChallenges,
  telegramCustomerLinks,
  telegramLinkTokens,
  waitlistEntries,
} from "@/infrastructure/db/schema";
import { createOpaqueToken, hashOpaqueToken } from "@/shared/tokens";
import {
  disableTelegramChat,
  issueTelegramLink,
  redeemTelegramLink,
  verifyTelegramContact,
} from "@/workflows/telegram-link";

const db = getDb();
const now = new Date("2026-10-24T15:00:00.000Z");
type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createFixture() {
  const unique = randomUUID().slice(0, 8);
  const [tenant] = await db.insert(barbershops).values({
    name: `Telegram ${unique}`,
    slug: `telegram-${unique}`,
    timezone: "America/Sao_Paulo",
    bookingIntervalMinutes: 15,
    customerVerificationMode: "NONE",
    waitlistOfferTtlMinutes: 10,
    reminderOffsetMinutes: 60,
  }).returning();
  const [customer] = await db.insert(customers).values({
    barbershopId: tenant.id, name: "Test", phoneE164: "+5511999990001",
  }).returning();
  const [staff] = await db.insert(staffMembers).values({
    barbershopId: tenant.id, name: "Test",
  }).returning();
  const [service] = await db.insert(services).values({
    barbershopId: tenant.id, name: "Test", durationMinutes: 30,
  }).returning();

  const appointmentToken = createOpaqueToken();
  const [appointment] = await db.insert(appointments).values({
    barbershopId: tenant.id,
    customerId: customer.id,
    serviceId: service.id,
    staffId: staff.id,
    startsAt: new Date("2026-11-01T12:00:00.000Z"),
    endsAt: new Date("2026-11-01T12:30:00.000Z"),
    managementTokenHash: hashOpaqueToken(appointmentToken),
  }).returning();

  const waitlistToken = createOpaqueToken();
  const [entry] = await db.insert(waitlistEntries).values({
    barbershopId: tenant.id,
    customerId: customer.id,
    serviceId: service.id,
    desiredDate: "2026-11-02",
    earliestTime: "09:00",
    latestTime: "17:00",
    managementTokenHash: hashOpaqueToken(waitlistToken),
  }).returning();

  return { tenant, customer, staff, service, appointment, appointmentToken, entry, waitlistToken };
}

async function cleanup(fixture: Fixture) {
  await db.delete(telegramContactChallenges).where(eq(telegramContactChallenges.barbershopId, fixture.tenant.id));
  await db.delete(telegramCustomerLinks).where(eq(telegramCustomerLinks.barbershopId, fixture.tenant.id));
  await db.delete(telegramLinkTokens).where(eq(telegramLinkTokens.barbershopId, fixture.tenant.id));
  await db.delete(telegramChatLinks).where(eq(telegramChatLinks.barbershopId, fixture.tenant.id));
  await db.delete(waitlistEntries).where(eq(waitlistEntries.barbershopId, fixture.tenant.id));
  await db.delete(appointments).where(eq(appointments.barbershopId, fixture.tenant.id));
  await db.delete(customers).where(eq(customers.barbershopId, fixture.tenant.id));
  await db.delete(staffMembers).where(eq(staffMembers.id, fixture.staff.id));
  await db.delete(services).where(eq(services.id, fixture.service.id));
  await db.delete(barbershops).where(eq(barbershops.id, fixture.tenant.id));
}

describe("Telegram scoped links", () => {
  let fixture: Fixture;
  beforeEach(async () => { fixture = await createFixture(); });
  afterEach(async () => { await cleanup(fixture); });
  afterAll(async () => { await getPool().end(); });

  function issue(token: string, scope: "appointment" | "waitlist" = "appointment") {
    return issueTelegramLink({ scope, capabilityToken: token }, {
      database: db, now, botUsername: "CutzExampleBot",
    });
  }

  it("issues a short-lived opaque link from a valid appointment capability", async () => {
    const result = await issue(fixture.appointmentToken);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("Unable to issue link");
    const token = new URL(result.url).searchParams.get("start");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.expiresAt).toBe(new Date(now.getTime() + 600000).toISOString());

    const [persisted] = await db.select().from(telegramLinkTokens);
    expect(persisted.tokenHash).toBe(hashOpaqueToken(token!));
    expect(persisted.tokenHash).not.toBe(token);
    expect(persisted.appointmentId).toBe(fixture.appointment.id);
    expect(persisted.waitlistEntryId).toBeNull();
  });

  it("rejects absent capabilities, expired tokens and replay", async () => {
    expect((await issue(createOpaqueToken())).status).toBe("not-found");
    const link = await issue(fixture.appointmentToken);
    if (link.status !== "ok") throw new Error("issue failed");
    const token = new URL(link.url).searchParams.get("start")!;
    expect(await redeemTelegramLink({ token, chatId: "12345" }, {
      database: db, now: new Date(now.getTime() + 600001),
    })).toBe("invalid");
    expect(await redeemTelegramLink({ token, chatId: "12345" }, { database: db, now }))
      .toBe("linked");
    expect(await redeemTelegramLink({ token, chatId: "54321" }, { database: db, now }))
      .toBe("invalid");
  });

  it("allows only one concurrent redemption and links a single appointment", async () => {
    const issued = await issue(fixture.appointmentToken);
    if (issued.status !== "ok") throw new Error("issue failed");
    const token = new URL(issued.url).searchParams.get("start")!;
    const attempts = await Promise.all([
      redeemTelegramLink({ token, chatId: "111" }, { database: db, now }),
      redeemTelegramLink({ token, chatId: "222" }, { database: db, now }),
    ]);
    expect(attempts.sort()).toEqual(["invalid", "linked"]);
    const links = await db.select().from(telegramChatLinks);
    expect(links).toHaveLength(1);
    expect(links[0].appointmentId).toBe(fixture.appointment.id);
  });

  it("isolates bindings by resource and supports revocation", async () => {
    const appointment = await issue(fixture.appointmentToken);
    const waitlist = await issue(fixture.waitlistToken, "waitlist");
    if (appointment.status !== "ok" || waitlist.status !== "ok") throw new Error("issue failed");
    const firstToken = new URL(appointment.url).searchParams.get("start")!;
    const secondToken = new URL(waitlist.url).searchParams.get("start")!;
    expect(await redeemTelegramLink({ token: firstToken, chatId: "123" }, { database: db, now }))
      .toBe("linked");
    expect(await redeemTelegramLink({ token: secondToken, chatId: "123" }, { database: db, now }))
      .toBe("linked");
    expect(await disableTelegramChat("123", { database: db, now })).toBe(2);
    expect(await disableTelegramChat("123", { database: db, now })).toBe(0);
    const links = await db.select().from(telegramChatLinks);
    expect(links).toHaveLength(2);
    expect(links.every(link => link.revokedAt !== null)).toBe(true);
  });


  it("verifies the customer's own Telegram contact before subscribing the tenant", async () => {
    const issued = await issue(fixture.appointmentToken);
    if (issued.status !== "ok") throw new Error("issue failed");
    const token = new URL(issued.url).searchParams.get("start")!;
    expect(await redeemTelegramLink({ token, chatId: "123456" }, { database: db, now }))
      .toBe("linked");

    expect(await verifyTelegramContact({
      chatId: "123456", telegramUserId: "123456",
      contactUserId: "999", phoneNumber: "+5511999990001",
    }, { database: db, now })).toBe("invalid");
    expect(await verifyTelegramContact({
      chatId: "123456", telegramUserId: "123456",
      contactUserId: "123456", phoneNumber: "+5511999999876",
    }, { database: db, now })).toBe("mismatch");
    expect(await db.select().from(telegramCustomerLinks)).toHaveLength(0);

    expect(await verifyTelegramContact({
      chatId: "123456", telegramUserId: "123456",
      contactUserId: "123456", phoneNumber: "+5511999990001",
    }, { database: db, now })).toBe("verified");
    const links = await db.select().from(telegramCustomerLinks);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      barbershopId: fixture.tenant.id,
      customerId: fixture.customer.id,
      chatId: "123456",
      revokedAt: null,
    });
    expect(await verifyTelegramContact({
      chatId: "123456", telegramUserId: "123456",
      contactUserId: "123456", phoneNumber: "+5511999990001",
    }, { database: db, now })).toBe("invalid");
    expect(await disableTelegramChat("123456", { database: db, now })).toBe(2);
    const [revoked] = await db.select().from(telegramCustomerLinks);
    expect(revoked.revokedAt).not.toBeNull();
  });

  it("expires the pending phone verification and isolates establishments", async () => {
    const other = await createFixture();
    try {
      const issued = await issue(fixture.appointmentToken);
      if (issued.status !== "ok") throw new Error("issue failed");
      const token = new URL(issued.url).searchParams.get("start")!;
      await redeemTelegramLink({ token, chatId: "456789" }, { database: db, now });
      expect(await verifyTelegramContact({
        chatId: "456789", telegramUserId: "456789",
        contactUserId: "456789", phoneNumber: "+5511999990001",
      }, { database: db, now: new Date(now.getTime() + 600001) })).toBe("invalid");
      expect(await verifyTelegramContact({
        chatId: "456789", telegramUserId: "456789",
        contactUserId: "456789", phoneNumber: "+5511999990001",
      }, { database: db, now })).toBe("verified");
      const [link] = await db.select().from(telegramCustomerLinks);
      expect(link.barbershopId).toBe(fixture.tenant.id);
      expect(link.customerId).not.toBe(other.customer.id);
    } finally {
      await cleanup(other);
    }
  });

  it("does not grant other resources access just because the phone is the same", async () => {
    const second = await createFixture();
    try {
      expect(second.customer.phoneE164).toBe(fixture.customer.phoneE164);
      const issued = await issue(fixture.appointmentToken);
      if (issued.status !== "ok") throw new Error("issue failed");
      const token = new URL(issued.url).searchParams.get("start")!;
      expect(await redeemTelegramLink({ token, chatId: "321" }, { database: db, now })).toBe("linked");
      const links = await db.select().from(telegramChatLinks);
      expect(links).toHaveLength(1);
      expect(links[0].barbershopId).toBe(fixture.tenant.id);
      expect(links[0].appointmentId).toBe(fixture.appointment.id);
      expect(links[0].appointmentId).not.toBe(second.appointment.id);
    } finally {
      await cleanup(second);
    }
  });
});
