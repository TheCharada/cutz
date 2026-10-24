import "dotenv/config";
import { getWorkerEnv } from "@/config/worker-env";
import { getDb, getPool } from "@/infrastructure/db/client";
import { logger } from "@/infrastructure/logging/logger";
import { FakeMessagingProvider } from "@/infrastructure/messaging/fake-messaging-provider";
import { TelegramMessagingProvider } from "@/infrastructure/messaging/telegram-messaging-provider";
import { TelegramJobMessagingProvider } from "@/infrastructure/messaging/telegram-job-provider";
import {
  WhatsAppMessagingProvider,
  type WhatsAppTemplateMap,
} from "@/infrastructure/messaging/whatsapp-messaging-provider";
import type { MessagingProvider, OutboundNotification } from "@/modules/notifications";
import { runWorker, type WorkerRuntimeConfig } from "./runtime";

function errorName(error: unknown) {
  return error instanceof Error ? error.name : "UnknownError";
}

function renderFakeNotification(notification: OutboundNotification) {
  if (process.env.NODE_ENV === "production") {
    process.stdout.write(
      `[fake-messaging] ${JSON.stringify({
        jobId: notification.jobId,
        type: notification.type,
      })}\n`,
    );
    return;
  }

  process.stdout.write(
    `[fake-messaging] ${JSON.stringify({
      to: notification.toE164,
      type: notification.type,
      payload: notification.payload,
    })}\n`,
  );
}

function requiredEnv(name: string, value: string | undefined, provider = "whatsapp") {
  if (!value) throw new Error(`${name} is required when MESSAGING_PROVIDER=${provider}`);
  return value;
}

function createMessagingProvider(env: ReturnType<typeof getWorkerEnv>): MessagingProvider {
  if (env.MESSAGING_PROVIDER === "fake") {
    return new FakeMessagingProvider(renderFakeNotification);
  }

  if (env.MESSAGING_PROVIDER === "telegram") {
    const token = requiredEnv("TELEGRAM_BOT_TOKEN", env.TELEGRAM_BOT_TOKEN, "telegram");
    return new TelegramJobMessagingProvider(getDb(), new TelegramMessagingProvider(token));
  }

  const templates: WhatsAppTemplateMap = {
    APPOINTMENT_CREATED: requiredEnv(
      "WHATSAPP_TEMPLATE_APPOINTMENT_CREATED",
      env.WHATSAPP_TEMPLATE_APPOINTMENT_CREATED,
    ),
    APPOINTMENT_RESCHEDULED: requiredEnv(
      "WHATSAPP_TEMPLATE_APPOINTMENT_RESCHEDULED",
      env.WHATSAPP_TEMPLATE_APPOINTMENT_RESCHEDULED,
    ),
    APPOINTMENT_REMINDER: requiredEnv(
      "WHATSAPP_TEMPLATE_APPOINTMENT_REMINDER",
      env.WHATSAPP_TEMPLATE_APPOINTMENT_REMINDER,
    ),
    APPOINTMENT_CANCELLED: requiredEnv(
      "WHATSAPP_TEMPLATE_APPOINTMENT_CANCELLED",
      env.WHATSAPP_TEMPLATE_APPOINTMENT_CANCELLED,
    ),
    WAITLIST_ENTRY_CREATED: requiredEnv(
      "WHATSAPP_TEMPLATE_WAITLIST_ENTRY_CREATED",
      env.WHATSAPP_TEMPLATE_WAITLIST_ENTRY_CREATED,
    ),
    WAITLIST_OFFER: requiredEnv("WHATSAPP_TEMPLATE_WAITLIST_OFFER", env.WHATSAPP_TEMPLATE_WAITLIST_OFFER),
    CUSTOMER_OTP: requiredEnv("WHATSAPP_TEMPLATE_CUSTOMER_OTP", env.WHATSAPP_TEMPLATE_CUSTOMER_OTP),
  };

  return new WhatsAppMessagingProvider({
    accessToken: requiredEnv("WHATSAPP_ACCESS_TOKEN", env.WHATSAPP_ACCESS_TOKEN),
    phoneNumberId: requiredEnv("WHATSAPP_PHONE_NUMBER_ID", env.WHATSAPP_PHONE_NUMBER_ID),
    graphApiVersion: requiredEnv("WHATSAPP_GRAPH_API_VERSION", env.WHATSAPP_GRAPH_API_VERSION),
    templateLanguage: env.WHATSAPP_TEMPLATE_LANGUAGE,
    templates,
    appOrigin: env.APP_ORIGIN,
  });
}

async function main() {
  const env = getWorkerEnv();
  const stopClaims = new AbortController();
  const abortProviders = new AbortController();
  let shutdownTimer: NodeJS.Timeout | undefined;
  let shutdownRequested = false;
  let resolveShutdownDeadline!: () => void;
  const shutdownDeadline = new Promise<void>((resolve) => {
    resolveShutdownDeadline = resolve;
  });

  const provider = createMessagingProvider(env);
  const config: WorkerRuntimeConfig = {
    appOrigin: env.APP_ORIGIN,
    notificationPollMs: env.NOTIFICATION_POLL_MS,
    waitlistPollMs: env.WAITLIST_POLL_MS,
    waitlistEntrySweepMs: env.WAITLIST_ENTRY_SWEEP_MS,
    notificationBatchSize: env.NOTIFICATION_BATCH_SIZE,
    notificationConcurrency: env.NOTIFICATION_CONCURRENCY,
    processingLeaseMs: env.PROCESSING_LEASE_MS,
    recoveryIntervalMs: env.RECOVERY_INTERVAL_MS,
    providerTimeoutMs: env.PROVIDER_TIMEOUT_MS,
    dbErrorBackoffMs: env.DB_ERROR_BACKOFF_MS,
  };

  function expireShutdownGrace(reason: string) {
    if (!abortProviders.signal.aborted) {
      abortProviders.abort(new Error(reason));
    }
    resolveShutdownDeadline();
  }

  function requestShutdown(signal: NodeJS.Signals) {
    logger.info({ signal }, "worker shutdown requested");
    if (shutdownRequested) {
      logger.warn("worker received a second shutdown signal");
      expireShutdownGrace("worker shutdown forced");
      return;
    }

    shutdownRequested = true;
    stopClaims.abort();
    shutdownTimer = setTimeout(() => {
      logger.warn("worker shutdown grace elapsed; aborting in-flight provider calls");
      expireShutdownGrace("worker shutdown grace elapsed");
    }, env.SHUTDOWN_GRACE_MS);
    shutdownTimer.unref();
  }

  function requestFatalShutdown(error: unknown, event: string) {
    logger.fatal({ event, errorName: errorName(error) }, "worker fatal error");
    process.exitCode = 1;
    stopClaims.abort();
    expireShutdownGrace("worker fatal shutdown");
  }

  process.once("SIGINT", requestShutdown);
  process.once("SIGTERM", requestShutdown);
  process.once("uncaughtException", (error) => requestFatalShutdown(error, "uncaughtException"));
  process.once("unhandledRejection", (reason) => requestFatalShutdown(reason, "unhandledRejection"));

  logger.info({ messagingProvider: env.MESSAGING_PROVIDER }, "worker started");

  const runtime = runWorker({
    database: getDb(),
    provider,
    config,
    stopSignal: stopClaims.signal,
    providerSignal: abortProviders.signal,
  });

  try {
    const outcome = await Promise.race([
      runtime.then(() => "completed" as const),
      shutdownDeadline.then(() => "deadline" as const),
    ]);

    if (outcome === "deadline") {
      void runtime.catch((error) => {
        logger.error({ errorName: errorName(error) }, "worker runtime ended after shutdown deadline");
      });
    }
  } finally {
    if (shutdownTimer) clearTimeout(shutdownTimer);
    if (!abortProviders.signal.aborted) abortProviders.abort();
    await getPool().end();
    logger.info("worker stopped");
  }
}

await main().catch((error) => {
  logger.fatal({ errorName: errorName(error) }, "worker failed to start");
  process.exitCode = 1;
});
