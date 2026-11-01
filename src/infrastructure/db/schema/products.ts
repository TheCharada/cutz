import { sql } from "drizzle-orm";
import {
  boolean, check, foreignKey, index, integer, pgTable, text, timestamp,
  uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { barbershops } from "./barbershops";
import { users } from "./identity";

export const products = pgTable("products", {
  id: uuid("id").defaultRandom().primaryKey(),
  barbershopId: uuid("barbershop_id").notNull()
    .references(() => barbershops.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  description: text("description"),
  priceCents: integer("price_cents").notNull(),
  stockQuantity: integer("stock_quantity").default(0).notNull(),
  minimumStock: integer("minimum_stock").default(0).notNull(),
  imageKey: text("image_key"),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("products_barbershop_idx").on(table.barbershopId),
  index("products_barbershop_active_idx").on(table.barbershopId, table.active),
  uniqueIndex("products_id_barbershop_unique").on(table.id, table.barbershopId),
  check("products_price_nonnegative", sql`${table.priceCents} >= 0`),
  check("products_stock_nonnegative", sql`${table.stockQuantity} >= 0`),
  check("products_minimum_stock_nonnegative", sql`${table.minimumStock} >= 0`),
]);

export const productStockMovements = pgTable("product_stock_movements", {
  id: uuid("id").defaultRandom().primaryKey(),
  barbershopId: uuid("barbershop_id").notNull()
    .references(() => barbershops.id, { onDelete: "restrict" }),
  productId: uuid("product_id").notNull(),
  kind: text("kind", { enum: ["IN", "OUT", "ADJUSTMENT"] }).notNull(),
  quantityDelta: integer("quantity_delta").notNull(),
  quantityBefore: integer("quantity_before").notNull(),
  quantityAfter: integer("quantity_after").notNull(),
  reason: text("reason").notNull(),
  operationId: uuid("operation_id").notNull(),
  createdByUserId: uuid("created_by_user_id").notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    name: "product_stock_movements_product_tenant_fk",
    columns: [table.productId, table.barbershopId],
    foreignColumns: [products.id, products.barbershopId],
  }).onDelete("restrict"),
  index("product_stock_movements_product_created_idx")
    .on(table.barbershopId, table.productId, table.createdAt),
  uniqueIndex("product_stock_movements_operation_unique")
    .on(table.barbershopId, table.operationId),
  check("product_stock_movements_kind_valid",
    sql`${table.kind} IN ('IN', 'OUT', 'ADJUSTMENT')`),
  check("product_stock_movements_delta_valid",
    sql`(${table.kind} = 'IN' AND ${table.quantityDelta} > 0)
      OR (${table.kind} = 'OUT' AND ${table.quantityDelta} < 0)
      OR (${table.kind} = 'ADJUSTMENT')`),
  check("product_stock_movements_balance_valid",
    sql`${table.quantityBefore} >= 0 AND ${table.quantityAfter} >= 0
      AND ${table.quantityAfter} = ${table.quantityBefore} + ${table.quantityDelta}`),
]);
