import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, getPool } from "@/infrastructure/db/client";
import { barbershops, notificationJobs } from "@/infrastructure/db/schema";
import { completeNotificationJob } from "@/modules/notifications";
import { processWhatsAppDeliveryStatuses } from "@/workflows/whatsapp-delivery-status";

const db = getDb();
const processingStartedAt = new Date("2026-09-05T20:00:00.000Z");

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createFixture() {
  const suffix = randomUUID().slice(0, 8);
  const [tenant] = await db
    .insert(barbershops)
    .values({
      name: `Webhook ${suffix}`,
      slug: `webhook-${suffix}`,
      timezone: "America/Sao_Paulo",
      bookingIntervalMinutes: 30,
      customerVerificationMode: "NONE",
      waitlistOfferTtlMinutes: 10,
      reminderOffsetMinutes: 1440,
    })
    .returning();

  return { tenant };
}

async function insertProcessingJob(fixture: Fixture, providerMessageId: string) {
  const [job] = await db
    .insert(notificationJobs)
    .values({
      barbershopId: fixture.tenant.id,
      type: "APPOINTMENT_REMINDER",
      phoneE164: "+5514999999999",
      payload: { type: "APPOINTMENT_REMINDER" },
      status: "PROCESSING",
      scheduledAt: processingStartedAt,
      processingStartedAt,
    })
    .returning();

  const changed = await completeNotificationJob(db, {
    jobId: job.id,
    processingStartedAt,
    sentAt: new Date("2026-09-05T20:00:01.000Z"),
    providerMessageId,
    terminalPayload: { type: "APPOINTMENT_REMINDER" },
  });
  expect(changed).not.toBeNull();

  return job.id;
}

async function getJob(jobId: string) {
  const [job] = await db.select().from(notificationJobs).where(eq(notificationJobs.id, jobId));
  if (!job) throw new Error(`NotificationJob ${jobId} not found`);
  return job;
}

describe("WhatsApp delivery status persistence", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await createFixture();
  });

  afterEach(async () => {
    await db.delete(notificationJobs).where(eq(notificationJobs.barbershopId, fixture.tenant.id));
    await db.delete(barbershops).where(eq(barbershops.id, fixture.tenant.id));
  });

  afterAll(async () => {
    await getPool().end();
  });

  it("separates provider acceptance from asynchronous delivery progression", async () => {
    const providerMessageId = `wamid.${randomUUID()}`;
    const jobId = await insertProcessingJob(fixture, providerMessageId);

    const accepted = await getJob(jobId);
    expect(accepted.status).toBe("SENT");
    expect(accepted.providerMessageId).toBe(providerMessageId);
    expect(accepted.deliveryStatus).toBe("ACCEPTED");
    expect(accepted.deliveryStatusAt).toBeNull();

    const statusAt = new Date("2026-09-05T20:00:02.000Z");
    expect(
      await processWhatsAppDeliveryStatuses({
        database: db,
        updates: [{ providerMessageId, status: "SENT", occurredAt: statusAt }],
      }),
    ).toEqual({ received: 1, updated: 1, ignored: 0, unmatched: 0 });

    expect(
      await processWhatsAppDeliveryStatuses({
        database: db,
        updates: [{ providerMessageId, status: "DELIVERED", occurredAt: statusAt }],
      }),
    ).toEqual({ received: 1, updated: 1, ignored: 0, unmatched: 0 });

    expect(
      await processWhatsAppDeliveryStatuses({
        database: db,
        updates: [{ providerMessageId, status: "SENT", occurredAt: statusAt }],
      }),
    ).toEqual({ received: 1, updated: 0, ignored: 1, unmatched: 0 });

    expect(
      await processWhatsAppDeliveryStatuses({
        database: db,
        updates: [
          {
            providerMessageId,
            status: "FAILED",
            occurredAt: new Date("2026-09-05T20:00:01.000Z"),
            errorCode: 130497,
            errorMessage: "stale failure",
          },
        ],
      }),
    ).toEqual({ received: 1, updated: 0, ignored: 1, unmatched: 0 });

    const readAt = new Date("2026-09-05T20:00:03.000Z");
    await processWhatsAppDeliveryStatuses({
      database: db,
      updates: [{ providerMessageId, status: "READ", occurredAt: readAt }],
    });

    const final = await getJob(jobId);
    expect(final.status).toBe("SENT");
    expect(final.deliveryStatus).toBe("READ");
    expect(final.deliveryStatusAt?.toISOString()).toBe(readAt.toISOString());
    expect(final.deliveryErrorCode).toBeNull();
    expect(final.deliveryErrorMessage).toBeNull();
  });

  it("records asynchronous provider failures without retrying or rewriting the worker job state", async () => {
    const providerMessageId = `wamid.${randomUUID()}`;
    const jobId = await insertProcessingJob(fixture, providerMessageId);
    const failedAt = new Date("2026-09-05T20:01:00.000Z");

    const result = await processWhatsAppDeliveryStatuses({
      database: db,
      updates: [
        {
          providerMessageId,
          status: "FAILED",
          occurredAt: failedAt,
          errorCode: 130497,
          errorMessage: "Business account is restricted from messaging users in this country.",
        },
      ],
    });

    expect(result).toEqual({ received: 1, updated: 1, ignored: 0, unmatched: 0 });
    const failed = await getJob(jobId);
    expect(failed.status).toBe("SENT");
    expect(failed.attempts).toBe(0);
    expect(failed.deliveryStatus).toBe("FAILED");
    expect(failed.deliveryStatusAt?.toISOString()).toBe(failedAt.toISOString());
    expect(failed.deliveryErrorCode).toBe(130497);
    expect(failed.deliveryErrorMessage).toContain("restricted from messaging users");
  });

  it("acknowledges a valid status for an unknown provider message without creating data", async () => {
    const result = await processWhatsAppDeliveryStatuses({
      database: db,
      updates: [
        {
          providerMessageId: `wamid.unknown.${randomUUID()}`,
          status: "FAILED",
          occurredAt: new Date("2026-09-05T20:02:00.000Z"),
          errorCode: 130497,
        },
      ],
    });

    expect(result).toEqual({ received: 1, updated: 0, ignored: 0, unmatched: 1 });
  });
});
