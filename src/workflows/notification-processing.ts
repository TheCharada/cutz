import { getDb, type Database } from "@/infrastructure/db/client";
import { resolveBarbershopById } from "@/modules/barbershops";
import { getOtpChallengeById } from "@/modules/customers";
import {
  cancelNotificationJob,
  claimNotificationJobs,
  completeNotificationJob,
  failNotificationJob,
  MessagingProviderError,
  MessagingRecipientUnavailableError,
  notificationPayloadSchema,
  recoverNotificationJobLeases,
  retryNotificationJob,
  type MessagingProvider,
  type MessagingSendResult,
  type NotificationJobRecord,
  type NotificationPayload,
} from "@/modules/notifications";
import { getAppointmentById } from "@/modules/scheduling";
import { getWaitlistEntryById, getWaitlistOfferById } from "@/modules/waitlist";
import { SystemClock, type Clock } from "@/shared/clock";

const systemClock = new SystemClock();
const retryBackoffMs = [60_000, 5 * 60_000, 15 * 60_000] as const;
const maxProviderFailures = 4;
const sensitivePayloadKeys = new Set(["managementUrl", "actionUrl", "code", "otp", "token"]);

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      sensitivePayloadKeys.has(key) ? "[redacted]" : redactValue(nested),
    ]),
  );
}

export function redactTerminalNotificationPayload(payload: Record<string, unknown>) {
  return redactValue(payload) as Record<string, unknown>;
}

type RevalidationResult =
  | { status: "valid" }
  | { status: "stale"; reason: string }
  | { status: "invalid"; reason: string };

async function revalidateNotificationJob(
  database: Database,
  job: NotificationJobRecord,
  payload: NotificationPayload,
  now: Date,
): Promise<RevalidationResult> {
  switch (payload.type) {
    case "APPOINTMENT_CREATED":
    case "APPOINTMENT_RESCHEDULED": {
      if (!job.appointmentId || job.appointmentId !== payload.appointmentId) {
        return { status: "invalid", reason: "INVALID_APPOINTMENT_REFERENCE" };
      }
      const appointment = await getAppointmentById(database, job.barbershopId, job.appointmentId);
      return appointment?.status === "SCHEDULED"
        ? { status: "valid" }
        : { status: "stale", reason: "APPOINTMENT_NOT_SCHEDULED" };
    }

    case "APPOINTMENT_REMINDER": {
      if (!job.appointmentId || job.appointmentId !== payload.appointmentId) {
        return { status: "invalid", reason: "INVALID_APPOINTMENT_REFERENCE" };
      }
      const appointment = await getAppointmentById(database, job.barbershopId, job.appointmentId);
      return appointment?.status === "SCHEDULED" && now < appointment.startsAt
        ? { status: "valid" }
        : { status: "stale", reason: "REMINDER_NO_LONGER_VALID" };
    }

    case "APPOINTMENT_CANCELLED": {
      if (!job.appointmentId || job.appointmentId !== payload.appointmentId) {
        return { status: "invalid", reason: "INVALID_APPOINTMENT_REFERENCE" };
      }
      const appointment = await getAppointmentById(database, job.barbershopId, job.appointmentId);
      return appointment?.status === "CANCELLED" && appointment.cancellationKind === "CANCELLATION"
        ? { status: "valid" }
        : { status: "stale", reason: "CANCELLATION_NO_LONGER_VALID" };
    }

    case "WAITLIST_ENTRY_CREATED": {
      if (!job.waitlistEntryId || job.waitlistEntryId !== payload.waitlistEntryId) {
        return { status: "invalid", reason: "INVALID_WAITLIST_ENTRY_REFERENCE" };
      }
      const entry = await getWaitlistEntryById(
        database,
        job.barbershopId,
        job.waitlistEntryId,
      );
      return entry?.barbershopId === job.barbershopId && entry.status === "ACTIVE"
        ? { status: "valid" }
        : { status: "stale", reason: "WAITLIST_ENTRY_NOT_ACTIVE" };
    }

    case "WAITLIST_OFFER": {
      if (!job.waitlistOfferId || job.waitlistOfferId !== payload.waitlistOfferId) {
        return { status: "invalid", reason: "INVALID_WAITLIST_OFFER_REFERENCE" };
      }
      const offer = await getWaitlistOfferById(
        database,
        job.barbershopId,
        job.waitlistOfferId,
      );
      return offer?.barbershopId === job.barbershopId &&
        offer.status === "PENDING" &&
        now < offer.expiresAt
        ? { status: "valid" }
        : { status: "stale", reason: "WAITLIST_OFFER_NOT_SENDABLE" };
    }

    case "CUSTOMER_OTP": {
      if (!job.otpChallengeId || job.otpChallengeId !== payload.otpChallengeId) {
        return { status: "invalid", reason: "INVALID_OTP_REFERENCE" };
      }
      const challenge = await getOtpChallengeById(database, job.barbershopId, job.otpChallengeId);
      return challenge &&
        !challenge.consumedAt &&
        !challenge.invalidatedAt &&
        now < challenge.expiresAt
        ? { status: "valid" }
        : { status: "stale", reason: "OTP_NO_LONGER_VALID" };
    }
  }
}

function providerFailure(error: unknown) {
  if (error instanceof MessagingProviderError) return error;
  const name = error instanceof Error ? error.name : "UnknownError";
  return new MessagingProviderError(
    name === "TimeoutError" ? "provider timeout" : "provider request failed",
    { retryable: true, cause: error },
  );
}

function providerFailureReason(error: MessagingProviderError) {
  if (error.cause instanceof Error && error.cause.name === "TimeoutError") {
    return "MESSAGING_PROVIDER_TIMEOUT";
  }
  return error.retryable ? "MESSAGING_PROVIDER_RETRYABLE" : "MESSAGING_PROVIDER_PERMANENT";
}

function createSendSignal(providerSignal: AbortSignal, timeoutMs: number) {
  return AbortSignal.any([providerSignal, AbortSignal.timeout(timeoutMs)]);
}

async function processClaimedNotificationJob(
  job: NotificationJobRecord,
  options: {
    database: Database;
    provider: MessagingProvider;
    clock: Clock;
    providerSignal: AbortSignal;
    providerTimeoutMs: number;
    completeJob: typeof completeNotificationJob;
  },
) {
  if (!job.processingStartedAt) {
    throw new Error("Claimed NotificationJob is missing processingStartedAt");
  }

  const parsed = notificationPayloadSchema.safeParse(job.payload);
  if (!parsed.success || parsed.data.type !== job.type) {
    const changed = await failNotificationJob(options.database, {
      jobId: job.id,
      processingStartedAt: job.processingStartedAt,
      attempts: job.attempts,
      reason: "INVALID_NOTIFICATION_PAYLOAD",
      terminalPayload: redactTerminalNotificationPayload(job.payload),
    });
    return { status: changed ? "failed" : "lease-lost" } as const;
  }

  const barbershop = await resolveBarbershopById(options.database, job.barbershopId);
  if (!barbershop) {
    const changed = await failNotificationJob(options.database, {
      jobId: job.id,
      processingStartedAt: job.processingStartedAt,
      attempts: job.attempts,
      reason: "INVALID_BARBERSHOP_REFERENCE",
      terminalPayload: redactTerminalNotificationPayload(job.payload),
    });
    return { status: changed ? "failed" : "lease-lost" } as const;
  }

  const now = options.clock.now();
  const revalidation = await revalidateNotificationJob(options.database, job, parsed.data, now);
  if (revalidation.status === "invalid") {
    const changed = await failNotificationJob(options.database, {
      jobId: job.id,
      processingStartedAt: job.processingStartedAt,
      attempts: job.attempts,
      reason: revalidation.reason,
      terminalPayload: redactTerminalNotificationPayload(job.payload),
    });
    return { status: changed ? "failed" : "lease-lost" } as const;
  }
  if (revalidation.status === "stale") {
    const changed = await cancelNotificationJob(options.database, {
      jobId: job.id,
      processingStartedAt: job.processingStartedAt,
      reason: revalidation.reason,
      terminalPayload: redactTerminalNotificationPayload(job.payload),
    });
    return { status: changed ? "cancelled" : "lease-lost" } as const;
  }

  let result: MessagingSendResult;
  try {
    result = await options.provider.send(
      {
        jobId: job.id,
        barbershopId: job.barbershopId,
        appointmentId: job.appointmentId,
        waitlistEntryId: job.waitlistEntryId,
        type: parsed.data.type,
        toE164: job.phoneE164,
        timeZone: barbershop.timezone,
        payload: parsed.data,
        idempotencyKey: job.id,
      },
      { signal: createSendSignal(options.providerSignal, options.providerTimeoutMs) },
    );
  } catch (error) {
    if (options.providerSignal.aborted) {
      return { status: "abandoned" } as const;
    }

    if (error instanceof MessagingRecipientUnavailableError) {
      const changed = await cancelNotificationJob(options.database, {
        jobId: job.id,
        processingStartedAt: job.processingStartedAt,
        reason: "NO_AUTHORIZED_MESSAGING_RECIPIENT",
        terminalPayload: redactTerminalNotificationPayload(job.payload),
      });
      return { status: changed ? "cancelled" : "lease-lost" } as const;
    }

    const failure = providerFailure(error);
    const attempts = job.attempts + 1;
    const reason = providerFailureReason(failure);
    const failedAt = options.clock.now();

    if (!failure.retryable || attempts >= maxProviderFailures) {
      const changed = await failNotificationJob(options.database, {
        jobId: job.id,
        processingStartedAt: job.processingStartedAt,
        attempts,
        reason,
        terminalPayload: redactTerminalNotificationPayload(job.payload),
      });
      return { status: changed ? "failed" : "lease-lost" } as const;
    }

    const policyDelay = retryBackoffMs[attempts - 1];
    const retryDelay = Math.max(policyDelay, failure.retryAfterMs ?? 0);
    const changed = await retryNotificationJob(options.database, {
      jobId: job.id,
      processingStartedAt: job.processingStartedAt,
      attempts,
      scheduledAt: new Date(failedAt.getTime() + retryDelay),
      reason,
    });
    return { status: changed ? "retried" : "lease-lost" } as const;
  }

  const changed = await options.completeJob(options.database, {
    jobId: job.id,
    processingStartedAt: job.processingStartedAt,
    sentAt: options.clock.now(),
    providerMessageId: result.providerMessageId,
    terminalPayload: redactTerminalNotificationPayload(job.payload),
  });
  return { status: changed ? "sent" : "lease-lost" } as const;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  handler: (value: T) => Promise<R>,
) {
  if (values.length === 0) return [];
  const results = new Array<R>(values.length);
  let cursor = 0;

  async function consume() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      results[index] = await handler(values[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, () => consume()),
  );
  return results;
}

export async function processNotificationBatch(
  options: {
    database?: Database;
    provider: MessagingProvider;
    clock?: Clock;
    providerSignal?: AbortSignal;
    batchSize?: number;
    concurrency?: number;
    providerTimeoutMs?: number;
    completeJob?: typeof completeNotificationJob;
  },
) {
  const database = options.database ?? getDb();
  const clock = options.clock ?? systemClock;
  const providerSignal = options.providerSignal ?? new AbortController().signal;
  const claimedAt = clock.now();
  const jobs = await database.transaction((tx) =>
    claimNotificationJobs(tx, { now: claimedAt, limit: options.batchSize ?? 25 }),
  );

  const results = await mapWithConcurrency(jobs, options.concurrency ?? 5, (job) =>
    processClaimedNotificationJob(job, {
      database,
      provider: options.provider,
      clock,
      providerSignal,
      providerTimeoutMs: options.providerTimeoutMs ?? 15_000,
      completeJob: options.completeJob ?? completeNotificationJob,
    }),
  );

  return { claimed: jobs.length, results };
}

export async function recoverAbandonedNotificationJobs(
  options: { database?: Database; clock?: Clock; processingLeaseMs?: number } = {},
) {
  const database = options.database ?? getDb();
  const now = (options.clock ?? systemClock).now();
  const leaseExpiredBefore = new Date(now.getTime() - (options.processingLeaseMs ?? 120_000));
  const rows = await recoverNotificationJobLeases(database, { leaseExpiredBefore });
  return { recovered: rows.length };
}
