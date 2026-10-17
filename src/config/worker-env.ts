import { z } from "zod";
import { databaseEnvSchema } from "./env";

const positiveInteger = z.coerce.number().int().positive();
const optionalNonEmpty = z.string().trim().min(1).optional();

const workerEnvSchema = databaseEnvSchema.extend({
  APP_ORIGIN: z.url(),
  MESSAGING_PROVIDER: z.enum(["fake", "whatsapp"]),
  WHATSAPP_ACCESS_TOKEN: optionalNonEmpty,
  WHATSAPP_PHONE_NUMBER_ID: optionalNonEmpty,
  WHATSAPP_GRAPH_API_VERSION: optionalNonEmpty,
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().trim().min(1).default("pt_BR"),
  WHATSAPP_TEMPLATE_APPOINTMENT_CREATED: optionalNonEmpty,
  WHATSAPP_TEMPLATE_APPOINTMENT_RESCHEDULED: optionalNonEmpty,
  WHATSAPP_TEMPLATE_APPOINTMENT_REMINDER: optionalNonEmpty,
  WHATSAPP_TEMPLATE_APPOINTMENT_CANCELLED: optionalNonEmpty,
  WHATSAPP_TEMPLATE_WAITLIST_ENTRY_CREATED: optionalNonEmpty,
  WHATSAPP_TEMPLATE_WAITLIST_OFFER: optionalNonEmpty,
  WHATSAPP_TEMPLATE_CUSTOMER_OTP: optionalNonEmpty,
  NOTIFICATION_POLL_MS: positiveInteger.default(1000),
  WAITLIST_POLL_MS: positiveInteger.default(1000),
  WAITLIST_ENTRY_SWEEP_MS: positiveInteger.default(60000),
  NOTIFICATION_BATCH_SIZE: positiveInteger.default(25),
  NOTIFICATION_CONCURRENCY: positiveInteger.default(5),
  PROCESSING_LEASE_MS: positiveInteger.default(120000),
  RECOVERY_INTERVAL_MS: positiveInteger.default(60000),
  PROVIDER_TIMEOUT_MS: positiveInteger.default(15000),
  SHUTDOWN_GRACE_MS: positiveInteger.default(20000),
  DB_ERROR_BACKOFF_MS: positiveInteger.default(5000),
});

export function getWorkerEnv() {
  return workerEnvSchema.parse(process.env);
}
