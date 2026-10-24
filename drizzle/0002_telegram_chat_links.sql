CREATE TABLE "telegram_link_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token_hash" text NOT NULL,
  "barbershop_id" uuid NOT NULL,
  "appointment_id" uuid,
  "waitlist_entry_id" uuid,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "telegram_link_tokens_exactly_one_scope" CHECK (("appointment_id" IS NOT NULL) <> ("waitlist_entry_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "telegram_chat_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "barbershop_id" uuid NOT NULL,
  "appointment_id" uuid,
  "waitlist_entry_id" uuid,
  "chat_id" text NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "telegram_chat_links_exactly_one_scope" CHECK (("appointment_id" IS NOT NULL) <> ("waitlist_entry_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "telegram_link_tokens" ADD CONSTRAINT "telegram_link_tokens_barbershop_id_barbershops_id_fk" FOREIGN KEY ("barbershop_id") REFERENCES "public"."barbershops"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "telegram_link_tokens" ADD CONSTRAINT "telegram_link_tokens_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "telegram_link_tokens" ADD CONSTRAINT "telegram_link_tokens_waitlist_entry_id_waitlist_entries_id_fk" FOREIGN KEY ("waitlist_entry_id") REFERENCES "public"."waitlist_entries"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "telegram_chat_links" ADD CONSTRAINT "telegram_chat_links_barbershop_id_barbershops_id_fk" FOREIGN KEY ("barbershop_id") REFERENCES "public"."barbershops"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "telegram_chat_links" ADD CONSTRAINT "telegram_chat_links_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "telegram_chat_links" ADD CONSTRAINT "telegram_chat_links_waitlist_entry_id_waitlist_entries_id_fk" FOREIGN KEY ("waitlist_entry_id") REFERENCES "public"."waitlist_entries"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_link_tokens_token_hash_unique" ON "telegram_link_tokens" USING btree ("token_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_chat_links_appointment_unique" ON "telegram_chat_links" USING btree ("appointment_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_chat_links_waitlist_unique" ON "telegram_chat_links" USING btree ("waitlist_entry_id");
