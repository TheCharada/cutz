import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, getPool } from "@/infrastructure/db/client";
import {
  appointments,
  barbershops,
  customers,
  notificationJobs,
  services,
  staffMembers,
} from "@/infrastructure/db/schema";
import {
  claimNotificationJobs,
  enqueueAppointmentNotifications,
  MessagingProviderError,
  type MessagingProvider,
  type OutboundNotification,
} from "@/modules/notifications";
import type { Clock } from "@/shared/clock";
import {
  processNotificationBatch,
  recoverAbandonedNotificationJobs,
} from "@/workflows/notification-processing";

const db = getDb();
const initialNow = new Date("2026-09-05T10:00:00.000Z");
const appointmentStartsAt = new Date("2026-09-10T12:00:00.000Z");
const appointmentEndsAt = new Date("2026-09-10T12:30:00.000Z");

type Fixture = Awaited<ReturnType<typeof createFixture>>;

class MutableClock implements Clock {
  constructor(private instant: Date) {}

  now() {
    return new Date(this.instant.getTime());
  }

  set(instant: Date) {
    this.instant = new Date(instant.getTime());
  }
}

class RecordingProvider implements MessagingProvider {
  readonly sent: OutboundNotification[] = [];

  async send(notification: OutboundNotification) {
    this.sent.push(notification);
    return { providerMessageId: `provider:${notification.jobId}` };
  }
}

class AlwaysFailingProvider implements MessagingProvider {
  constructor(private readonly error: Error) {}

  async send(): Promise<never> {
    throw this.error;
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function createFixture() {
  const suffix = randomUUID().slice(0, 8);
  const [tenant] = await db
    .insert(barbershops)
    .values({
      name: `Notification ${suffix}`,
      slug: `notification-${suffix}`,
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
      phoneE164: `+5514${Math.floor(100000000 + Math.random() * 899999999)}`,
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
  const [appointment] = await db
    .insert(appointments)
    .values({
      barbershopId: tenant.id,
      customerId: customer.id,
      staffId: staff.id,
      serviceId: service.id,
      startsAt: appointmentStartsAt,
      endsAt: appointmentEndsAt,
      managementTokenHash: `management-${randomUUID()}`,
    })
    .returning();

  return { tenant, customer, service, staff, appointment };
}

async function cleanFixture(fixture: Fixture) {
  await db.delete(notificationJobs).where(eq(notificationJobs.barbershopId, fixture.tenant.id));
  await db.delete(appointments).where(eq(appointments.barbershopId, fixture.tenant.id));
  await db.delete(customers).where(eq(customers.barbershopId, fixture.tenant.id));
  await db.delete(staffMembers).where(eq(staffMembers.id, fixture.staff.id));
  await db.delete(services).where(eq(services.id, fixture.service.id));
  await db.delete(barbershops).where(eq(barbershops.id, fixture.tenant.id));
}

function createdPayload(fixture: Fixture, token = "secret-capability") {
  return {
    type: "APPOINTMENT_CREATED" as const,
    appointmentId: fixture.appointment.id,
    customerName: fixture.customer.name,
    serviceName: fixture.service.name,
    staffName: fixture.staff.name,
    startsAt: fixture.appointment.startsAt.toISOString(),
    managementUrl: `http://localhost:3000/a/${token}`,
  };
}

async function insertCreatedJob(
  fixture: Fixture,
  options: {
    dedupeKey?: string;
    payload?: Record<string, unknown>;
    status?: "PENDING" | "PROCESSING";
    scheduledAt?: Date;
    attempts?: number;
    processingStartedAt?: Date;
  } = {},
) {
  const [job] = await db
    .insert(notificationJobs)
    .values({
      barbershopId: fixture.tenant.id,
      type: "APPOINTMENT_CREATED",
      phoneE164: fixture.customer.phoneE164,
      payload: options.payload ?? createdPayload(fixture),
      appointmentId: fixture.appointment.id,
      dedupeKey: options.dedupeKey ?? `test:${randomUUID()}`,
      status: options.status ?? "PENDING",
      scheduledAt: options.scheduledAt ?? initialNow,
      attempts: options.attempts ?? 0,
      processingStartedAt: options.processingStartedAt,
    })
    .returning();
  return job;
}

async function getJob(jobId: string) {
  const [job] = await db.select().from(notificationJobs).where(eq(notificationJobs.id, jobId));
  if (!job) throw new Error(`NotificationJob ${jobId} not found`);
  return job;
}

describe("notification worker", () => {
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

  it("claims jobs atomically across two concurrent workers", async () => {
    const jobs = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        insertCreatedJob(fixture, { dedupeKey: `concurrent:${fixture.tenant.id}:${index}` }),
      ),
    );

    const [first, second] = await Promise.all([
      db.transaction((tx) => claimNotificationJobs(tx, { now: initialNow, limit: 6 })),
      db.transaction((tx) => claimNotificationJobs(tx, { now: initialNow, limit: 6 })),
    ]);

    const firstIds = new Set(first.map((job) => job.id));
    const secondIds = new Set(second.map((job) => job.id));
    expect([...firstIds].some((id) => secondIds.has(id))).toBe(false);
    expect(new Set([...firstIds, ...secondIds])).toEqual(new Set(jobs.map((job) => job.id)));
  });

  it("commits PROCESSING before network and transitions to SENT after provider acceptance", async () => {
    const job = await insertCreatedJob(fixture);
    const entered = deferred();
    const release = deferred();
    const provider: MessagingProvider = {
      async send(notification) {
        entered.resolve();
        await release.promise;
        return { providerMessageId: `provider:${notification.jobId}` };
      },
    };

    const processing = processNotificationBatch({
      database: db,
      provider,
      clock: new MutableClock(initialNow),
      batchSize: 1,
      concurrency: 1,
    });
    await entered.promise;

    const duringSend = await getJob(job.id);
    expect(duringSend.status).toBe("PROCESSING");
    expect(duringSend.attempts).toBe(0);
    expect(duringSend.processingStartedAt?.toISOString()).toBe(initialNow.toISOString());

    release.resolve();
    await processing;

    const sent = await getJob(job.id);
    expect(sent.status).toBe("SENT");
    expect(sent.attempts).toBe(0);
    expect(sent.providerMessageId).toBe(`provider:${job.id}`);
    expect(sent.processingStartedAt).toBeNull();
    expect(sent.payload).toMatchObject({ managementUrl: "[redacted]" });
  });

  it("leaves PROCESSING for lease recovery when persistence fails after provider acceptance", async () => {
    const job = await insertCreatedJob(fixture);
    const provider = new RecordingProvider();
    const clock = new MutableClock(initialNow);

    await expect(
      processNotificationBatch({
        database: db,
        provider,
        clock,
        batchSize: 1,
        concurrency: 1,
        completeJob: async () => {
          throw new Error("database write failed");
        },
      }),
    ).rejects.toThrow("database write failed");

    expect(provider.sent).toHaveLength(1);
    const processing = await getJob(job.id);
    expect(processing.status).toBe("PROCESSING");
    expect(processing.attempts).toBe(0);
    expect(processing.processingStartedAt?.toISOString()).toBe(initialNow.toISOString());

    clock.set(new Date(initialNow.getTime() + 121_000));
    const recovered = await recoverAbandonedNotificationJobs({
      database: db,
      clock,
      processingLeaseMs: 120_000,
    });
    expect(recovered.recovered).toBe(1);

    const pending = await getJob(job.id);
    expect(pending.status).toBe("PENDING");
    expect(pending.attempts).toBe(0);
    expect(pending.processingStartedAt).toBeNull();
  });

  it("retries provider failures after 1m, 5m and 15m then fails on the fourth failure", async () => {
    const job = await insertCreatedJob(fixture);
    const clock = new MutableClock(initialNow);
    const provider = new AlwaysFailingProvider(
      new MessagingProviderError("temporary", { retryable: true }),
    );
    const expectedDelays = [60_000, 5 * 60_000, 15 * 60_000];

    for (let failure = 1; failure <= 4; failure += 1) {
      await processNotificationBatch({ database: db, provider, clock, batchSize: 1, concurrency: 1 });
      const state = await getJob(job.id);
      expect(state.attempts).toBe(failure);

      if (failure < 4) {
        expect(state.status).toBe("PENDING");
        expect(state.scheduledAt.getTime()).toBe(clock.now().getTime() + expectedDelays[failure - 1]);
        clock.set(state.scheduledAt);
      } else {
        expect(state.status).toBe("FAILED");
        expect(state.payload).toMatchObject({ managementUrl: "[redacted]" });
      }
    }
  });

  it("fails a permanent provider error without retrying", async () => {
    const job = await insertCreatedJob(fixture);
    const provider = new AlwaysFailingProvider(
      new MessagingProviderError("invalid destination", { retryable: false }),
    );

    await processNotificationBatch({
      database: db,
      provider,
      clock: new MutableClock(initialNow),
      batchSize: 1,
      concurrency: 1,
    });

    const state = await getJob(job.id);
    expect(state.status).toBe("FAILED");
    expect(state.attempts).toBe(1);
    expect(state.lastError).toBe("MESSAGING_PROVIDER_PERMANENT");
  });

  it("recovers abandoned PROCESSING jobs without incrementing attempts", async () => {
    const job = await insertCreatedJob(fixture, {
      status: "PROCESSING",
      attempts: 2,
      processingStartedAt: new Date(initialNow.getTime() - 121_000),
    });

    const result = await recoverAbandonedNotificationJobs({
      database: db,
      clock: new MutableClock(initialNow),
      processingLeaseMs: 120_000,
    });

    expect(result.recovered).toBe(1);
    const state = await getJob(job.id);
    expect(state.status).toBe("PENDING");
    expect(state.attempts).toBe(2);
    expect(state.processingStartedAt).toBeNull();
  });

  it("cancels a stale domain notification before calling the provider", async () => {
    const job = await insertCreatedJob(fixture, { payload: createdPayload(fixture, "stale-secret") });
    await db
      .update(appointments)
      .set({
        status: "CANCELLED",
        cancelledAt: initialNow,
        cancelledBy: "CUSTOMER",
        cancellationKind: "CANCELLATION",
      })
      .where(eq(appointments.id, fixture.appointment.id));
    const provider = new RecordingProvider();

    await processNotificationBatch({
      database: db,
      provider,
      clock: new MutableClock(initialNow),
      batchSize: 1,
      concurrency: 1,
    });

    expect(provider.sent).toHaveLength(0);
    const state = await getJob(job.id);
    expect(state.status).toBe("CANCELLED");
    expect(state.attempts).toBe(0);
    expect(state.payload).toMatchObject({ managementUrl: "[redacted]" });
  });

  it("fails malformed payload permanently without counting a provider attempt", async () => {
    const job = await insertCreatedJob(fixture, {
      payload: {
        type: "APPOINTMENT_CREATED",
        appointmentId: fixture.appointment.id,
        customerName: "Cliente",
      },
    });
    const provider = new RecordingProvider();

    await processNotificationBatch({
      database: db,
      provider,
      clock: new MutableClock(initialNow),
      batchSize: 1,
      concurrency: 1,
    });

    expect(provider.sent).toHaveLength(0);
    const state = await getJob(job.id);
    expect(state.status).toBe("FAILED");
    expect(state.attempts).toBe(0);
    expect(state.lastError).toBe("INVALID_NOTIFICATION_PAYLOAD");
  });

  it("deduplicates the same logical notification effect", async () => {
    const params = {
      barbershopId: fixture.tenant.id,
      appointmentId: fixture.appointment.id,
      phoneE164: fixture.customer.phoneE164,
      now: initialNow,
      startsAt: fixture.appointment.startsAt,
      reminderOffsetMinutes: 10_000,
      createdPayload: createdPayload(fixture),
      reminderPayload: {
        type: "APPOINTMENT_REMINDER" as const,
        appointmentId: fixture.appointment.id,
        customerName: fixture.customer.name,
        serviceName: fixture.service.name,
        staffName: fixture.staff.name,
        startsAt: fixture.appointment.startsAt.toISOString(),
      },
    };

    await enqueueAppointmentNotifications(db, params);
    await enqueueAppointmentNotifications(db, params);

    const rows = await db
      .select({ id: notificationJobs.id })
      .from(notificationJobs)
      .where(eq(notificationJobs.dedupeKey, `appointment:${fixture.appointment.id}:created`));
    expect(rows).toHaveLength(1);
  });
});
