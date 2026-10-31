CREATE TABLE "appointment_services" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "barbershop_id" uuid NOT NULL,
  "appointment_id" uuid NOT NULL,
  "service_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "service_name_snapshot" text NOT NULL,
  "duration_minutes_snapshot" integer,
  "unit_price_cents" integer,
  "historical_snapshot_complete" boolean DEFAULT true NOT NULL,
  "performed_at" timestamp with time zone,
  "price_adjustment_reason" text,
  "operation_id" uuid,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "voided_at" timestamp with time zone,
  "voided_by_user_id" uuid,
  "void_reason" text,
  CONSTRAINT "appointment_services_duration_positive" CHECK ("appointment_services"."duration_minutes_snapshot" IS NULL OR "appointment_services"."duration_minutes_snapshot" > 0),
  CONSTRAINT "appointment_services_price_nonnegative" CHECK ("appointment_services"."unit_price_cents" IS NULL OR "appointment_services"."unit_price_cents" >= 0),
  CONSTRAINT "appointment_services_void_consistent" CHECK (("appointment_services"."voided_at" IS NULL AND "appointment_services"."voided_by_user_id" IS NULL AND "appointment_services"."void_reason" IS NULL)
      OR ("appointment_services"."kind" = 'ADDITIONAL' AND "appointment_services"."voided_at" IS NOT NULL
        AND "appointment_services"."voided_by_user_id" IS NOT NULL AND "appointment_services"."void_reason" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "appointment_services" ADD CONSTRAINT "appointment_services_barbershop_id_barbershops_id_fk" FOREIGN KEY ("barbershop_id") REFERENCES "public"."barbershops"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appointment_services" ADD CONSTRAINT "appointment_services_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appointment_services" ADD CONSTRAINT "appointment_services_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appointment_services" ADD CONSTRAINT "appointment_services_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appointment_services" ADD CONSTRAINT "appointment_services_voided_by_user_id_users_id_fk" FOREIGN KEY ("voided_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "appointment_services_tenant_appointment_idx" ON "appointment_services" USING btree ("barbershop_id","appointment_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_services_one_booked_per_appointment" ON "appointment_services" USING btree ("appointment_id") WHERE "appointment_services"."kind" = 'BOOKED';
--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_services_operation_unique" ON "appointment_services" USING btree ("barbershop_id","appointment_id","operation_id");
--> statement-breakpoint
INSERT INTO "appointment_services" (
  "barbershop_id", "appointment_id", "service_id", "kind",
  "service_name_snapshot", "historical_snapshot_complete", "performed_at", "created_at"
)
SELECT
  a."barbershop_id", a."id", a."service_id", 'BOOKED',
  s."name", false, NULL, a."created_at"
FROM "appointments" a
JOIN "services" s ON s."id" = a."service_id" AND s."barbershop_id" = a."barbershop_id";
