CREATE TYPE "public"."notification_delivery_status" AS ENUM('ACCEPTED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'DELETED');--> statement-breakpoint
ALTER TABLE "notification_jobs" ADD COLUMN "delivery_status" "notification_delivery_status";--> statement-breakpoint
ALTER TABLE "notification_jobs" ADD COLUMN "delivery_status_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_jobs" ADD COLUMN "delivery_error_code" integer;--> statement-breakpoint
ALTER TABLE "notification_jobs" ADD COLUMN "delivery_error_message" text;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_jobs_provider_message_id_unique" ON "notification_jobs" USING btree ("provider_message_id");