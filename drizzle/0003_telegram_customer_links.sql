CREATE TABLE "telegram_customer_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "barbershop_id" uuid NOT NULL,
  "customer_id" uuid NOT NULL,
  "chat_id" text NOT NULL,
  "verified_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_contact_challenges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "chat_id" text NOT NULL,
  "barbershop_id" uuid NOT NULL,
  "customer_id" uuid NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "telegram_customer_links" ADD CONSTRAINT "telegram_customer_links_barbershop_id_barbershops_id_fk" FOREIGN KEY ("barbershop_id") REFERENCES "public"."barbershops"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "telegram_customer_links" ADD CONSTRAINT "telegram_customer_links_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "telegram_contact_challenges" ADD CONSTRAINT "telegram_contact_challenges_barbershop_id_barbershops_id_fk" FOREIGN KEY ("barbershop_id") REFERENCES "public"."barbershops"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "telegram_contact_challenges" ADD CONSTRAINT "telegram_contact_challenges_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_customer_links_tenant_customer_unique" ON "telegram_customer_links" USING btree ("barbershop_id","customer_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_customer_links_tenant_chat_unique" ON "telegram_customer_links" USING btree ("barbershop_id","chat_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_contact_challenges_chat_unique" ON "telegram_contact_challenges" USING btree ("chat_id");
