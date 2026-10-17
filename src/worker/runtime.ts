import type { Database } from "@/infrastructure/db/client";
import type { MessagingProvider } from "@/modules/notifications";
import { logger } from "@/infrastructure/logging/logger";
import { SystemClock, type Clock } from "@/shared/clock";
import {
  processNotificationBatch,
  recoverAbandonedNotificationJobs,
} from "@/workflows/notification-processing";
import { processExpiredWaitlistEntries } from "@/workflows/waitlist-entry-expiration";
import { processExpiredWaitlistOffers } from "@/workflows/waitlist-expiration";

const systemClock = new SystemClock();

export type WorkerRuntimeConfig = {
  appOrigin: string;
  notificationPollMs: number;
  waitlistPollMs: number;
  waitlistEntrySweepMs: number;
  notificationBatchSize: number;
  notificationConcurrency: number;
  processingLeaseMs: number;
  recoveryIntervalMs: number;
  providerTimeoutMs: number;
  dbErrorBackoffMs: number;
};

type WorkerOperations = {
  processNotifications: typeof processNotificationBatch;
  recoverNotifications: typeof recoverAbandonedNotificationJobs;
  expireWaitlistOffers: typeof processExpiredWaitlistOffers;
  expireWaitlistEntries: typeof processExpiredWaitlistEntries;
};

const defaultOperations: WorkerOperations = {
  processNotifications: processNotificationBatch,
  recoverNotifications: recoverAbandonedNotificationJobs,
  expireWaitlistOffers: processExpiredWaitlistOffers,
  expireWaitlistEntries: processExpiredWaitlistEntries,
};

function sanitizedErrorMessage(error: Error) {
  return error.message
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, "postgresql://[redacted]@")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}

function errorFields(error: unknown) {
  if (!(error instanceof Error)) return { errorName: "UnknownError" };

  const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
  return {
    errorName: error.name,
    errorMessage: sanitizedErrorMessage(error),
    ...(code ? { errorCode: code } : {}),
  };
}

export function waitForAbortableDelay(ms: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();

  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

export async function runNotificationLoop(options: {
  database: Database;
  provider: MessagingProvider;
  config: WorkerRuntimeConfig;
  stopSignal: AbortSignal;
  providerSignal: AbortSignal;
  clock?: Clock;
  operations?: WorkerOperations;
}) {
  const clock = options.clock ?? systemClock;
  const operations = options.operations ?? defaultOperations;
  let nextRecoveryAt = 0;

  while (!options.stopSignal.aborted) {
    try {
      const now = clock.now();
      if (now.getTime() >= nextRecoveryAt) {
        await operations.recoverNotifications({
          database: options.database,
          clock,
          processingLeaseMs: options.config.processingLeaseMs,
        });
        nextRecoveryAt = now.getTime() + options.config.recoveryIntervalMs;
      }

      if (options.stopSignal.aborted) break;

      await operations.processNotifications({
        database: options.database,
        provider: options.provider,
        clock,
        providerSignal: options.providerSignal,
        batchSize: options.config.notificationBatchSize,
        concurrency: options.config.notificationConcurrency,
        providerTimeoutMs: options.config.providerTimeoutMs,
      });
    } catch (error) {
      logger.error(errorFields(error), "notification worker cycle failed");
      await waitForAbortableDelay(options.config.dbErrorBackoffMs, options.stopSignal);
      continue;
    }

    await waitForAbortableDelay(options.config.notificationPollMs, options.stopSignal);
  }
}

export async function runWaitlistMaintenanceLoop(options: {
  database: Database;
  config: WorkerRuntimeConfig;
  stopSignal: AbortSignal;
  clock?: Clock;
  operations?: WorkerOperations;
}) {
  const clock = options.clock ?? systemClock;
  const operations = options.operations ?? defaultOperations;
  let nextEntrySweepAt = 0;

  while (!options.stopSignal.aborted) {
    try {
      await operations.expireWaitlistOffers({
        database: options.database,
        clock,
        appOrigin: options.config.appOrigin,
      });

      if (options.stopSignal.aborted) break;

      const now = clock.now();
      if (now.getTime() >= nextEntrySweepAt) {
        await operations.expireWaitlistEntries({ database: options.database, clock });
        nextEntrySweepAt = now.getTime() + options.config.waitlistEntrySweepMs;
      }
    } catch (error) {
      logger.error(errorFields(error), "waitlist maintenance cycle failed");
      await waitForAbortableDelay(options.config.dbErrorBackoffMs, options.stopSignal);
      continue;
    }

    await waitForAbortableDelay(options.config.waitlistPollMs, options.stopSignal);
  }
}

export function runWorker(options: {
  database: Database;
  provider: MessagingProvider;
  config: WorkerRuntimeConfig;
  stopSignal: AbortSignal;
  providerSignal: AbortSignal;
  clock?: Clock;
  operations?: WorkerOperations;
}) {
  return Promise.all([
    runNotificationLoop(options),
    runWaitlistMaintenanceLoop(options),
  ]).then(() => undefined);
}
