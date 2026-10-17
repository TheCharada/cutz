CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
CREATE TYPE "customer_verification_mode" AS ENUM ('NONE', 'WHATSAPP_OTP');
--> statement-breakpoint
CREATE TYPE "customer_verification_level" AS ENUM ('UNVERIFIED', 'PHONE_VERIFIED');
--> statement-breakpoint
CREATE TYPE "membership_role" AS ENUM ('OWNER', 'STAFF');
--> statement-breakpoint
CREATE TYPE "appointment_status" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');
--> statement-breakpoint
CREATE TYPE "appointment_cancelled_by" AS ENUM ('CUSTOMER', 'STAFF');
--> statement-breakpoint
CREATE TYPE "appointment_cancellation_kind" AS ENUM ('CANCELLATION', 'RESCHEDULED');
--> statement-breakpoint
CREATE TYPE "waitlist_entry_status" AS ENUM ('ACTIVE', 'FULFILLED', 'CANCELLED', 'EXPIRED');
--> statement-breakpoint
CREATE TYPE "waitlist_offer_status" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED');
--> statement-breakpoint
CREATE TYPE "notification_job_status" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED');
--> statement-breakpoint
CREATE TYPE "notification_job_type" AS ENUM ('APPOINTMENT_CREATED', 'APPOINTMENT_RESCHEDULED', 'APPOINTMENT_REMINDER', 'APPOINTMENT_CANCELLED', 'WAITLIST_ENTRY_CREATED', 'WAITLIST_OFFER', 'CUSTOMER_OTP');
--> statement-breakpoint
CREATE TABLE "barbershops" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "timezone" text NOT NULL,
  "booking_interval_minutes" integer NOT NULL,
  "customer_verification_mode" "customer_verification_mode" DEFAULT 'NONE' NOT NULL,
  "waitlist_offer_ttl_minutes" integer NOT NULL,
  "reminder_offset_minutes" integer NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "barbershops_booking_interval_positive" CHECK ("booking_interval_minutes" > 0),
  CONSTRAINT "barbershops_waitlist_ttl_positive" CHECK ("waitlist_offer_ttl_minutes" > 0),
  CONSTRAINT "barbershops_reminder_offset_nonnegative" CHECK ("reminder_offset_minutes" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "barbershops_slug_unique" ON "barbershops" ("slug");
--> statement-breakpoint
CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "password_hash" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" ("email");
--> statement-breakpoint
CREATE TABLE "user_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "user_sessions_token_hash_unique" ON "user_sessions" ("token_hash");
--> statement-breakpoint
CREATE TABLE "barbershop_memberships" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "barbershop_id" uuid NOT NULL REFERENCES "barbershops"("id") ON DELETE RESTRICT,
  "role" "membership_role" NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY ("user_id", "barbershop_id")
);
--> statement-breakpoint
CREATE TABLE "customers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "barbershop_id" uuid NOT NULL REFERENCES "barbershops"("id") ON DELETE RESTRICT,
  "name" text NOT NULL,
  "phone_e164" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "customers_barbershop_phone_unique" ON "customers" ("barbershop_id", "phone_e164");
--> statement-breakpoint
CREATE TABLE "customer_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "barbershop_id" uuid NOT NULL REFERENCES "barbershops"("id") ON DELETE CASCADE,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "verification_level" "customer_verification_level" NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_sessions_token_hash_unique" ON "customer_sessions" ("token_hash");
--> statement-breakpoint
CREATE TABLE "otp_challenges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "barbershop_id" uuid NOT NULL REFERENCES "barbershops"("id") ON DELETE RESTRICT,
  "phone_e164" text NOT NULL,
  "code_hash" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "consumed_at" timestamptz,
  "invalidated_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "otp_challenges_attempts_nonnegative" CHECK ("attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "services" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "barbershop_id" uuid NOT NULL REFERENCES "barbershops"("id") ON DELETE RESTRICT,
  "name" text NOT NULL,
  "duration_minutes" integer NOT NULL,
  "price_cents" integer,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "services_duration_positive" CHECK ("duration_minutes" > 0),
  CONSTRAINT "services_price_nonnegative" CHECK ("price_cents" IS NULL OR "price_cents" >= 0)
);
--> statement-breakpoint
CREATE INDEX "services_barbershop_idx" ON "services" ("barbershop_id");
--> statement-breakpoint
CREATE TABLE "staff_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "barbershop_id" uuid NOT NULL REFERENCES "barbershops"("id") ON DELETE RESTRICT,
  "user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "name" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "accepts_appointments" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "staff_members_barbershop_idx" ON "staff_members" ("barbershop_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "staff_members_barbershop_user_unique" ON "staff_members" ("barbershop_id", "user_id");
--> statement-breakpoint
CREATE TABLE "staff_services" (
  "staff_id" uuid NOT NULL REFERENCES "staff_members"("id") ON DELETE CASCADE,
  "service_id" uuid NOT NULL REFERENCES "services"("id") ON DELETE CASCADE,
  PRIMARY KEY ("staff_id", "service_id")
);
--> statement-breakpoint
CREATE TABLE "working_hours" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "staff_id" uuid NOT NULL REFERENCES "staff_members"("id") ON DELETE CASCADE,
  "weekday" integer NOT NULL,
  "starts_at" time NOT NULL,
  "ends_at" time NOT NULL,
  CONSTRAINT "working_hours_weekday_range" CHECK ("weekday" BETWEEN 0 AND 6),
  CONSTRAINT "working_hours_valid_range" CHECK ("ends_at" > "starts_at")
);
--> statement-breakpoint
CREATE INDEX "working_hours_staff_weekday_idx" ON "working_hours" ("staff_id", "weekday");
--> statement-breakpoint
CREATE TABLE "time_off" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "staff_id" uuid NOT NULL REFERENCES "staff_members"("id") ON DELETE CASCADE,
  "starts_at" timestamptz NOT NULL,
  "ends_at" timestamptz NOT NULL,
  "reason" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "time_off_valid_range" CHECK ("ends_at" > "starts_at")
);
--> statement-breakpoint
CREATE INDEX "time_off_staff_starts_at_idx" ON "time_off" ("staff_id", "starts_at");
--> statement-breakpoint
CREATE TABLE "appointments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "barbershop_id" uuid NOT NULL REFERENCES "barbershops"("id") ON DELETE RESTRICT,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
  "staff_id" uuid NOT NULL REFERENCES "staff_members"("id") ON DELETE RESTRICT,
  "service_id" uuid NOT NULL REFERENCES "services"("id") ON DELETE RESTRICT,
  "starts_at" timestamptz NOT NULL,
  "ends_at" timestamptz NOT NULL,
  "status" "appointment_status" DEFAULT 'SCHEDULED' NOT NULL,
  "cancelled_at" timestamptz,
  "cancelled_by" "appointment_cancelled_by",
  "cancellation_kind" "appointment_cancellation_kind",
  "cancellation_reason" text,
  "rescheduled_from_id" uuid REFERENCES "appointments"("id") ON DELETE RESTRICT,
  "management_token_hash" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "appointments_valid_range" CHECK ("ends_at" > "starts_at"),
  CONSTRAINT "appointments_cancellation_fields_consistent" CHECK (("status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL AND "cancelled_by" IS NOT NULL AND "cancellation_kind" IS NOT NULL) OR ("status" <> 'CANCELLED' AND "cancelled_at" IS NULL AND "cancelled_by" IS NULL AND "cancellation_kind" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_management_token_hash_unique" ON "appointments" ("management_token_hash");
--> statement-breakpoint
CREATE INDEX "appointments_barbershop_starts_at_idx" ON "appointments" ("barbershop_id", "starts_at");
--> statement-breakpoint
CREATE INDEX "appointments_staff_starts_at_idx" ON "appointments" ("staff_id", "starts_at");
--> statement-breakpoint
CREATE INDEX "appointments_customer_starts_at_idx" ON "appointments" ("customer_id", "starts_at");
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_no_scheduled_overlap" EXCLUDE USING gist ("staff_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&) WHERE ("status" = 'SCHEDULED');
--> statement-breakpoint
CREATE TABLE "waitlist_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "barbershop_id" uuid NOT NULL REFERENCES "barbershops"("id") ON DELETE RESTRICT,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
  "service_id" uuid NOT NULL REFERENCES "services"("id") ON DELETE RESTRICT,
  "staff_id" uuid REFERENCES "staff_members"("id") ON DELETE RESTRICT,
  "desired_date" date NOT NULL,
  "earliest_time" time NOT NULL,
  "latest_time" time NOT NULL,
  "status" "waitlist_entry_status" DEFAULT 'ACTIVE' NOT NULL,
  "management_token_hash" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "waitlist_entries_valid_window" CHECK ("latest_time" > "earliest_time")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_entries_management_token_hash_unique" ON "waitlist_entries" ("management_token_hash");
--> statement-breakpoint
CREATE INDEX "waitlist_entries_lookup_idx" ON "waitlist_entries" ("barbershop_id", "status", "desired_date", "created_at");
--> statement-breakpoint
CREATE TABLE "waitlist_offers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "barbershop_id" uuid NOT NULL REFERENCES "barbershops"("id") ON DELETE RESTRICT,
  "waitlist_entry_id" uuid NOT NULL REFERENCES "waitlist_entries"("id") ON DELETE RESTRICT,
  "staff_id" uuid NOT NULL REFERENCES "staff_members"("id") ON DELETE RESTRICT,
  "starts_at" timestamptz NOT NULL,
  "ends_at" timestamptz NOT NULL,
  "status" "waitlist_offer_status" DEFAULT 'PENDING' NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "action_token_hash" text NOT NULL,
  "appointment_id" uuid REFERENCES "appointments"("id") ON DELETE RESTRICT,
  "opportunity_id" uuid NOT NULL,
  "opportunity_starts_at" timestamptz NOT NULL,
  "opportunity_ends_at" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "responded_at" timestamptz,
  CONSTRAINT "waitlist_offers_valid_range" CHECK ("ends_at" > "starts_at"),
  CONSTRAINT "waitlist_offers_valid_opportunity_range" CHECK ("opportunity_ends_at" > "opportunity_starts_at"),
  CONSTRAINT "waitlist_offers_expiry_after_creation" CHECK ("expires_at" > "created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_offers_action_token_hash_unique" ON "waitlist_offers" ("action_token_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_offers_opportunity_entry_unique" ON "waitlist_offers" ("opportunity_id", "waitlist_entry_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_offers_one_pending_per_entry" ON "waitlist_offers" ("waitlist_entry_id") WHERE "status" = 'PENDING';
--> statement-breakpoint
CREATE INDEX "waitlist_offers_status_expires_at_idx" ON "waitlist_offers" ("status", "expires_at");
--> statement-breakpoint
ALTER TABLE "waitlist_offers" ADD CONSTRAINT "waitlist_offers_no_pending_overlap" EXCLUDE USING gist ("staff_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&) WHERE ("status" = 'PENDING');
--> statement-breakpoint
CREATE TABLE "notification_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "barbershop_id" uuid NOT NULL REFERENCES "barbershops"("id") ON DELETE RESTRICT,
  "type" "notification_job_type" NOT NULL,
  "phone_e164" text NOT NULL,
  "payload" jsonb NOT NULL,
  "appointment_id" uuid REFERENCES "appointments"("id") ON DELETE RESTRICT,
  "waitlist_entry_id" uuid REFERENCES "waitlist_entries"("id") ON DELETE RESTRICT,
  "waitlist_offer_id" uuid REFERENCES "waitlist_offers"("id") ON DELETE RESTRICT,
  "otp_challenge_id" uuid REFERENCES "otp_challenges"("id") ON DELETE RESTRICT,
  "dedupe_key" text,
  "status" "notification_job_status" DEFAULT 'PENDING' NOT NULL,
  "scheduled_at" timestamptz NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "provider_message_id" text,
  "processing_started_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "sent_at" timestamptz,
  CONSTRAINT "notification_jobs_attempts_nonnegative" CHECK ("attempts" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_jobs_dedupe_key_unique" ON "notification_jobs" ("dedupe_key");
--> statement-breakpoint
CREATE INDEX "notification_jobs_status_scheduled_at_idx" ON "notification_jobs" ("status", "scheduled_at");
