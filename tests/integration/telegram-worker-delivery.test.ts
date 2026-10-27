import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, getPool } from "@/infrastructure/db/client";
import {
  appointments,
  barbershops,
  customers,
  notificationJobs,
  services,
  staffMembers,
  telegramChatLinks,
  telegramContactChallenges,
  telegramCustomerLinks,
} from "@/infrastructure/db/schema";
import { TelegramJobMessagingProvider } from "@/infrastructure/messaging/telegram-job-provider";
import { MessagingProviderError } from "@/modules/notifications";
import { processNotificationBatch } from "@/workflows/notification-processing";

const database = getDb();
const now = new Date("2026-10-24T12:00:00.000Z");
const clock = { now: () => new Date(now) };
const start = new Date("2026-11-02T13:00:00.000Z");

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createFixture() {
  const suffix = randomUUID().slice(0, 8);
  const [tenant] = await database.insert(barbershops).values({
    name: `Telegram delivery ${suffix}`,
    slug: `telegram-delivery-${suffix}`,
    timezone: "America/Sao_Paulo",
    bookingIntervalMinutes: 15,
    customerVerificationMode: "NONE",
    reminderOffsetMinutes: 60,
    waitlistOfferTtlMinutes: 10,
  }).returning();
  const [customer] = await database.insert(customers).values({
    barbershopId: tenant.id,
    name: "Cliente teste",
    phoneE164: "+5511999999999",
  }).returning();
  const [staff] = await database.insert(staffMembers).values({
    barbershopId: tenant.id, name: "Profissional teste",
  }).returning();
  const [service] = await database.insert(services).values({
    barbershopId: tenant.id, name: "Corte", durationMinutes: 30,
  }).returning();
  const [appointment] = await database.insert(appointments).values({
    barbershopId: tenant.id,
    customerId: customer.id,
    staffId: staff.id,
    serviceId: service.id,
    startsAt: start,
    endsAt: new Date(start.getTime() + 30 * 60000),
    managementTokenHash: `telegram-integration-${randomUUID()}`,
  }).returning();
  return { tenant, customer, staff, service, appointment };
}

async function cleanup(f: Fixture) {
  await database.delete(notificationJobs).where(eq(notificationJobs.barbershopId, f.tenant.id));
  await database.delete(telegramContactChallenges).where(eq(telegramContactChallenges.barbershopId, f.tenant.id));
  await database.delete(telegramCustomerLinks).where(eq(telegramCustomerLinks.barbershopId, f.tenant.id));
  await database.delete(telegramChatLinks).where(eq(telegramChatLinks.barbershopId, f.tenant.id));
  await database.delete(appointments).where(eq(appointments.barbershopId, f.tenant.id));
  await database.delete(customers).where(eq(customers.barbershopId, f.tenant.id));
  await database.delete(staffMembers).where(eq(staffMembers.id, f.staff.id));
  await database.delete(services).where(eq(services.id, f.service.id));
  await database.delete(barbershops).where(eq(barbershops.id, f.tenant.id));
}

async function enqueue(f: Fixture, type: "APPOINTMENT_CREATED" | "CUSTOMER_OTP" = "APPOINTMENT_CREATED") {
  const payload = type === "CUSTOMER_OTP" ? {
    type,
    otpChallengeId: randomUUID(),
    code: "123456",
    expiresAt: new Date(now.getTime() + 600000).toISOString(),
  } : {
    type,
    appointmentId: f.appointment.id,
    customerName: f.customer.name,
    serviceName: f.service.name,
    staffName: f.staff.name,
    startsAt: f.appointment.startsAt.toISOString(),
    managementUrl: "https://app.example.test/a/secret-capability",
  };
  const [row] = await database.insert(notificationJobs).values({
    barbershopId: f.tenant.id,
    type,
    phoneE164: f.customer.phoneE164,
    appointmentId: type === "APPOINTMENT_CREATED" ? f.appointment.id : null,
    otpChallengeId: null,
    scheduledAt: now,
    payload,
    dedupeKey: `telegram-delivery:${randomUUID()}`,
  }).returning();
  return row;
}

async function link(f: Fixture, chatId: string, revokedAt?: Date) {
  await database.insert(telegramChatLinks).values({
    barbershopId: f.tenant.id,
    appointmentId: f.appointment.id,
    chatId,
    revokedAt: revokedAt ?? null,
  });
}

async function jobStatus(id: string) {
  const [row] = await database.select().from(notificationJobs).where(eq(notificationJobs.id, id));
  return row;
}

describe("Telegram scoped worker delivery", () => {
  let f: Fixture;
  beforeEach(async () => { f = await createFixture(); });
  afterEach(async () => { await cleanup(f); });
  afterAll(async () => { await getPool().end(); });

  it("sends only to the linked resource and persists API acceptance", async () => {
    await link(f, "123456789");
    const job = await enqueue(f);
    const send = vi.fn().mockResolvedValue({ providerMessageId: "telegram:123456789:88" });
    const provider = new TelegramJobMessagingProvider(database, { send });
    const result = await processNotificationBatch({ database, provider, clock });
    expect(result.results).toEqual([{ status: "sent" }]);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toMatchObject({
      chatId: "123456789",
      timeZone: "America/Sao_Paulo",
      payload: { type: "APPOINTMENT_CREATED" },
    });
    const completed = await jobStatus(job.id);
    expect(completed.status).toBe("SENT");
    expect(completed.deliveryStatus).toBe("ACCEPTED");
    expect(completed.providerMessageId).toBe("telegram:123456789:88");
    expect(JSON.stringify(completed.payload)).not.toContain("secret-capability");
  });


  it("automatically sends a customer's future booking to their verified Telegram chat", async () => {
    await database.insert(telegramCustomerLinks).values({
      barbershopId: f.tenant.id, customerId: f.customer.id,
      chatId: "654321", verifiedAt: now,
    });
    const [nextBooking] = await database.insert(appointments).values({
      barbershopId: f.tenant.id, customerId: f.customer.id,
      staffId: f.staff.id, serviceId: f.service.id,
      startsAt: new Date(start.getTime() + 86400000),
      endsAt: new Date(start.getTime() + 86400000 + 1800000),
      managementTokenHash: `next-telegram-${randomUUID()}`,
    }).returning();
    const [job] = await database.insert(notificationJobs).values({
      barbershopId: f.tenant.id, phoneE164: f.customer.phoneE164,
      appointmentId: nextBooking.id, type: "APPOINTMENT_CREATED",
      dedupeKey: `telegram-subscription:${randomUUID()}`, scheduledAt: now,
      payload: {
        type: "APPOINTMENT_CREATED", appointmentId: nextBooking.id,
        customerName: f.customer.name, serviceName: f.service.name, staffName: f.staff.name,
        startsAt: nextBooking.startsAt.toISOString(),
        managementUrl: "https://app.example.test/a/next-booking-secret",
      },
    }).returning();
    const send = vi.fn().mockResolvedValue({ providerMessageId: "telegram:654321:99" });
    const result = await processNotificationBatch({
      database, clock, provider: new TelegramJobMessagingProvider(database, { send }),
    });
    expect(result.results).toEqual([{ status: "sent" }]);
    expect(send.mock.calls[0][0].chatId).toBe("654321");
    expect((await jobStatus(job.id)).status).toBe("SENT");
  });

  it("prefers a verified subscription, then falls back to an existing scoped link", async () => {
    await link(f, "111");
    await database.insert(telegramCustomerLinks).values({
      barbershopId: f.tenant.id, customerId: f.customer.id,
      chatId: "222", verifiedAt: now,
    });
    const send = vi.fn()
      .mockResolvedValueOnce({ providerMessageId: "telegram:222:12" })
      .mockResolvedValueOnce({ providerMessageId: "telegram:111:13" });
    await enqueue(f);
    await processNotificationBatch({
      database, clock, provider: new TelegramJobMessagingProvider(database, { send }),
    });
    expect(send.mock.calls[0][0].chatId).toBe("222");
    await database.update(telegramCustomerLinks).set({ revokedAt: now })
      .where(eq(telegramCustomerLinks.barbershopId, f.tenant.id));
    await enqueue(f);
    await processNotificationBatch({
      database, clock, provider: new TelegramJobMessagingProvider(database, { send }),
    });
    expect(send.mock.calls[1][0].chatId).toBe("111");
  });

  it("cancels unlinked recipients without retrying or disclosing capabilities", async () => {
    const job = await enqueue(f);
    const send = vi.fn();
    const result = await processNotificationBatch({
      database, provider: new TelegramJobMessagingProvider(database, { send }), clock,
    });
    expect(result.results).toEqual([{ status: "cancelled" }]);
    expect(send).not.toHaveBeenCalled();
    const updated = await jobStatus(job.id);
    expect(updated.status).toBe("CANCELLED");
    expect(updated.attempts).toBe(0);
    expect(updated.lastError).toBe("NO_AUTHORIZED_MESSAGING_RECIPIENT");
    expect(JSON.stringify(updated.payload)).not.toContain("secret-capability");
  });

  it("never resolves recipients by matching phone numbers or other tenant links", async () => {
    const other = await createFixture();
    try {
      expect(other.customer.phoneE164).toBe(f.customer.phoneE164);
      await link(other, "222");
      const job = await enqueue(f);
      const send = vi.fn();
      await processNotificationBatch({
        database, provider: new TelegramJobMessagingProvider(database, { send }), clock,
      });
      expect(send).not.toHaveBeenCalled();
      expect((await jobStatus(job.id)).status).toBe("CANCELLED");
      const [otherLink] = await database.select().from(telegramChatLinks)
        .where(eq(telegramChatLinks.barbershopId, other.tenant.id));
      expect(otherLink.chatId).toBe("222");
      expect(otherLink.revokedAt).toBeNull();
    } finally {
      await cleanup(other);
    }
  });

  it("excludes revoked chats and never sends phone-verification codes", async () => {
    await link(f, "123", now);
    const first = await enqueue(f);
    const send = vi.fn();
    await processNotificationBatch({
      database, provider: new TelegramJobMessagingProvider(database, { send }), clock,
    });
    expect((await jobStatus(first.id)).status).toBe("CANCELLED");
    // Directly testing the adapter avoids creating a synthetic OTP challenge record.
    const provider = new TelegramJobMessagingProvider(database, { send });
    await expect(provider.send({
      jobId: randomUUID(), type: "CUSTOMER_OTP",
      barbershopId: f.tenant.id, toE164: f.customer.phoneE164,
      timeZone: f.tenant.timezone,
      payload: { type: "CUSTOMER_OTP", otpChallengeId: randomUUID(),
        code: "123456", expiresAt: new Date(now.getTime() + 100000).toISOString() },
      idempotencyKey: randomUUID(),
    }, { signal: new AbortController().signal })).rejects.toMatchObject({ retryable: false });
    expect(send).not.toHaveBeenCalled();
  });

  it("revokes the chat on Telegram HTTP 403 without retrying the job", async () => {
    await link(f, "123456789");
    const job = await enqueue(f);
    const send = vi.fn().mockRejectedValue(
      new MessagingProviderError("Telegram request failed with status 403", {
        retryable: false, statusCode: 403,
      }),
    );
    const result = await processNotificationBatch({
      database, provider: new TelegramJobMessagingProvider(database, { send }), clock,
    });
    expect(result.results).toEqual([{ status: "failed" }]);
    expect((await jobStatus(job.id)).attempts).toBe(1);
    const [linked] = await database.select().from(telegramChatLinks)
      .where(eq(telegramChatLinks.barbershopId, f.tenant.id));
    expect(linked.revokedAt).not.toBeNull();
  });

  it("preserves retry-after handling for a temporary Telegram 429", async () => {
    await link(f, "123456789");
    const job = await enqueue(f);
    const send = vi.fn().mockRejectedValue(
      new MessagingProviderError("Telegram rate-limited", {
        retryable: true, retryAfterMs: 10 * 60_000, statusCode: 429,
      }),
    );
    const result = await processNotificationBatch({
      database, provider: new TelegramJobMessagingProvider(database, { send }), clock,
    });
    expect(result.results).toEqual([{ status: "retried" }]);
    const updated = await jobStatus(job.id);
    expect(updated.status).toBe("PENDING");
    expect(updated.attempts).toBe(1);
    expect(updated.scheduledAt.toISOString()).toBe(new Date(now.getTime() + 10 * 60_000).toISOString());
  });
});
