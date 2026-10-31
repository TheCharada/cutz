CREATE TABLE "products" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "barbershop_id" uuid NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "price_cents" integer NOT NULL,
  "stock_quantity" integer DEFAULT 0 NOT NULL,
  "minimum_stock" integer DEFAULT 0 NOT NULL,
  "image_key" text,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "products_price_nonnegative" CHECK ("products"."price_cents" >= 0),
  CONSTRAINT "products_stock_nonnegative" CHECK ("products"."stock_quantity" >= 0),
  CONSTRAINT "products_minimum_stock_nonnegative" CHECK ("products"."minimum_stock" >= 0)
);
--> statement-breakpoint
CREATE TABLE "product_stock_movements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "barbershop_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "quantity_delta" integer NOT NULL,
  "quantity_before" integer NOT NULL,
  "quantity_after" integer NOT NULL,
  "reason" text NOT NULL,
  "operation_id" uuid NOT NULL,
  "created_by_user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "product_stock_movements_kind_valid" CHECK ("product_stock_movements"."kind" IN ('IN', 'OUT', 'ADJUSTMENT')),
  CONSTRAINT "product_stock_movements_delta_valid" CHECK (("product_stock_movements"."kind" = 'IN' AND "product_stock_movements"."quantity_delta" > 0)
      OR ("product_stock_movements"."kind" = 'OUT' AND "product_stock_movements"."quantity_delta" < 0)
      OR ("product_stock_movements"."kind" = 'ADJUSTMENT')),
  CONSTRAINT "product_stock_movements_balance_valid" CHECK ("product_stock_movements"."quantity_before" >= 0 AND "product_stock_movements"."quantity_after" >= 0
      AND "product_stock_movements"."quantity_after" = "product_stock_movements"."quantity_before" + "product_stock_movements"."quantity_delta")
);
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_barbershop_id_barbershops_id_fk" FOREIGN KEY ("barbershop_id") REFERENCES "public"."barbershops"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_stock_movements" ADD CONSTRAINT "product_stock_movements_barbershop_id_barbershops_id_fk" FOREIGN KEY ("barbershop_id") REFERENCES "public"."barbershops"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_stock_movements" ADD CONSTRAINT "product_stock_movements_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "products_id_barbershop_unique" ON "products" USING btree ("id","barbershop_id");
--> statement-breakpoint
ALTER TABLE "product_stock_movements" ADD CONSTRAINT "product_stock_movements_product_tenant_fk" FOREIGN KEY ("product_id","barbershop_id") REFERENCES "public"."products"("id","barbershop_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "products_barbershop_idx" ON "products" USING btree ("barbershop_id");
--> statement-breakpoint
CREATE INDEX "products_barbershop_active_idx" ON "products" USING btree ("barbershop_id","active");
--> statement-breakpoint
CREATE INDEX "product_stock_movements_product_created_idx" ON "product_stock_movements" USING btree ("barbershop_id","product_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "product_stock_movements_operation_unique" ON "product_stock_movements" USING btree ("barbershop_id","operation_id");
