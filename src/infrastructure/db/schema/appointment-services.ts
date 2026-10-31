import { sql } from "drizzle-orm";
import {
  boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { appointments } from "./appointments";
import { barbershops } from "./barbershops";
import { services } from "./catalog";
import { users } from "./identity";

export const appointmentServices = pgTable("appointment_services", {
  id: uuid("id").defaultRandom().primaryKey(),
  barbershopId: uuid("barbershop_id").notNull()
    .references(() => barbershops.id, { onDelete: "restrict" }),
  appointmentId: uuid("appointment_id").notNull()
    .references(() => appointments.id, { onDelete: "cascade" }),
  serviceId: uuid("service_id").notNull()
    .references(() => services.id, { onDelete: "restrict" }),
  kind: text("kind", { enum: ["BOOKED", "ADDITIONAL"] }).notNull(),
  serviceNameSnapshot: text("service_name_snapshot").notNull(),
  durationMinutesSnapshot: integer("duration_minutes_snapshot"),
  unitPriceCents: integer("unit_price_cents"),
  historicalSnapshotComplete: boolean("historical_snapshot_complete").default(true).notNull(),
  performedAt: timestamp("performed_at", { withTimezone: true }),
  priceAdjustmentReason: text("price_adjustment_reason"),
  operationId: uuid("operation_id"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  voidedByUserId: uuid("voided_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  voidReason: text("void_reason"),
}, (table) => [
  index("appointment_services_tenant_appointment_idx")
    .on(table.barbershopId, table.appointmentId),
  uniqueIndex("appointment_services_one_booked_per_appointment")
    .on(table.appointmentId).where(sql`${table.kind} = 'BOOKED'`),
  uniqueIndex("appointment_services_operation_unique")
    .on(table.barbershopId, table.appointmentId, table.operationId),
  check("appointment_services_duration_positive",
    sql`${table.durationMinutesSnapshot} IS NULL OR ${table.durationMinutesSnapshot} > 0`),
  check("appointment_services_price_nonnegative",
    sql`${table.unitPriceCents} IS NULL OR ${table.unitPriceCents} >= 0`),
  check("appointment_services_void_consistent",
    sql`(${table.voidedAt} IS NULL AND ${table.voidedByUserId} IS NULL AND ${table.voidReason} IS NULL)
      OR (${table.kind} = 'ADDITIONAL' AND ${table.voidedAt} IS NOT NULL
        AND ${table.voidedByUserId} IS NOT NULL AND ${table.voidReason} IS NOT NULL)`),
]);
