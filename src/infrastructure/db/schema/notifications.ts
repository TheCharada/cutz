import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { appointments } from "./appointments";
import { barbershops } from "./barbershops";
import { otpChallenges } from "./customers";
import {
  notificationDeliveryStatusEnum,
  notificationJobStatusEnum,
  notificationJobTypeEnum,
} from "./enums";
import { waitlistEntries, waitlistOffers } from "./waitlist";

export const notificationJobs = pgTable(
  "notification_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    barbershopId: uuid("barbershop_id")
      .notNull()
      .references(() => barbershops.id, { onDelete: "restrict" }),
    type: notificationJobTypeEnum("type").notNull(),
    phoneE164: text("phone_e164").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "restrict" }),
    waitlistEntryId: uuid("waitlist_entry_id").references(() => waitlistEntries.id, {
      onDelete: "restrict",
    }),
    waitlistOfferId: uuid("waitlist_offer_id").references(() => waitlistOffers.id, {
      onDelete: "restrict",
    }),
    otpChallengeId: uuid("otp_challenge_id").references(() => otpChallenges.id, {
      onDelete: "restrict",
    }),
    dedupeKey: text("dedupe_key"),
    status: notificationJobStatusEnum("status").default("PENDING").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").default(0).notNull(),
    lastError: text("last_error"),
    providerMessageId: text("provider_message_id"),
    deliveryStatus: notificationDeliveryStatusEnum("delivery_status"),
    deliveryStatusAt: timestamp("delivery_status_at", { withTimezone: true }),
    deliveryErrorCode: integer("delivery_error_code"),
    deliveryErrorMessage: text("delivery_error_message"),
    processingStartedAt: timestamp("processing_started_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("notification_jobs_dedupe_key_unique").on(table.dedupeKey),
    uniqueIndex("notification_jobs_provider_message_id_unique").on(table.providerMessageId),
    index("notification_jobs_status_scheduled_at_idx").on(table.status, table.scheduledAt),
    check("notification_jobs_attempts_nonnegative", sql`${table.attempts} >= 0`),
  ],
);
