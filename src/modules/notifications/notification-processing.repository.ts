import {
  and,
  asc,
  eq,
  inArray,
  lte,
  type InferSelectModel,
} from "drizzle-orm";
import type { DbExecutor } from "@/infrastructure/db/executor";
import { notificationJobs } from "@/infrastructure/db/schema";

export type NotificationJobRecord = InferSelectModel<typeof notificationJobs>;

function claimedJobWhere(jobId: string, processingStartedAt: Date) {
  return and(
    eq(notificationJobs.id, jobId),
    eq(notificationJobs.status, "PROCESSING"),
    eq(notificationJobs.processingStartedAt, processingStartedAt),
  );
}

export async function claimDueNotificationJobs(
  executor: DbExecutor,
  params: { now: Date; limit: number },
): Promise<NotificationJobRecord[]> {
  const rows = await executor
    .select()
    .from(notificationJobs)
    .where(and(eq(notificationJobs.status, "PENDING"), lte(notificationJobs.scheduledAt, params.now)))
    .orderBy(asc(notificationJobs.scheduledAt), asc(notificationJobs.id))
    .limit(params.limit)
    .for("update", { skipLocked: true });

  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  await executor
    .update(notificationJobs)
    .set({ status: "PROCESSING", processingStartedAt: params.now })
    .where(inArray(notificationJobs.id, ids));

  return rows.map((row) => ({
    ...row,
    status: "PROCESSING" as const,
    processingStartedAt: params.now,
  }));
}

export async function markNotificationJobSent(
  executor: DbExecutor,
  params: {
    jobId: string;
    processingStartedAt: Date;
    sentAt: Date;
    providerMessageId?: string;
    terminalPayload: Record<string, unknown>;
  },
) {
  const providerMessageId = params.providerMessageId ?? null;
  const [row] = await executor
    .update(notificationJobs)
    .set({
      status: "SENT",
      sentAt: params.sentAt,
      providerMessageId,
      deliveryStatus: providerMessageId ? "ACCEPTED" : null,
      deliveryStatusAt: null,
      deliveryErrorCode: null,
      deliveryErrorMessage: null,
      payload: params.terminalPayload,
      processingStartedAt: null,
      lastError: null,
    })
    .where(claimedJobWhere(params.jobId, params.processingStartedAt))
    .returning({ id: notificationJobs.id });
  return row ?? null;
}

export async function markNotificationJobCancelled(
  executor: DbExecutor,
  params: {
    jobId: string;
    processingStartedAt: Date;
    reason: string;
    terminalPayload: Record<string, unknown>;
  },
) {
  const [row] = await executor
    .update(notificationJobs)
    .set({
      status: "CANCELLED",
      payload: params.terminalPayload,
      processingStartedAt: null,
      lastError: params.reason,
    })
    .where(claimedJobWhere(params.jobId, params.processingStartedAt))
    .returning({ id: notificationJobs.id });
  return row ?? null;
}

export async function markNotificationJobFailed(
  executor: DbExecutor,
  params: {
    jobId: string;
    processingStartedAt: Date;
    attempts: number;
    reason: string;
    terminalPayload: Record<string, unknown>;
  },
) {
  const [row] = await executor
    .update(notificationJobs)
    .set({
      status: "FAILED",
      attempts: params.attempts,
      payload: params.terminalPayload,
      processingStartedAt: null,
      lastError: params.reason,
    })
    .where(claimedJobWhere(params.jobId, params.processingStartedAt))
    .returning({ id: notificationJobs.id });
  return row ?? null;
}

export async function scheduleNotificationJobRetry(
  executor: DbExecutor,
  params: {
    jobId: string;
    processingStartedAt: Date;
    attempts: number;
    scheduledAt: Date;
    reason: string;
  },
) {
  const [row] = await executor
    .update(notificationJobs)
    .set({
      status: "PENDING",
      attempts: params.attempts,
      scheduledAt: params.scheduledAt,
      processingStartedAt: null,
      lastError: params.reason,
    })
    .where(claimedJobWhere(params.jobId, params.processingStartedAt))
    .returning({ id: notificationJobs.id });
  return row ?? null;
}

export function recoverExpiredNotificationJobLeases(
  executor: DbExecutor,
  params: { leaseExpiredBefore: Date },
) {
  return executor
    .update(notificationJobs)
    .set({ status: "PENDING", processingStartedAt: null })
    .where(
      and(
        eq(notificationJobs.status, "PROCESSING"),
        lte(notificationJobs.processingStartedAt, params.leaseExpiredBefore),
      ),
    )
    .returning({ id: notificationJobs.id });
}
