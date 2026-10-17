import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { barbershops } from "./barbershops";
import { services, staffMembers } from "./catalog";
import { customers } from "./customers";
import {
  appointmentCancellationKindEnum,
  appointmentCancelledByEnum,
  appointmentStatusEnum,
} from "./enums";

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    barbershopId: uuid("barbershop_id")
      .notNull()
      .references(() => barbershops.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "restrict" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "restrict" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: appointmentStatusEnum("status").default("SCHEDULED").notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: appointmentCancelledByEnum("cancelled_by"),
    cancellationKind: appointmentCancellationKindEnum("cancellation_kind"),
    cancellationReason: text("cancellation_reason"),
    rescheduledFromId: uuid("rescheduled_from_id").references(
      (): AnyPgColumn => appointments.id,
      { onDelete: "restrict" },
    ),
    managementTokenHash: text("management_token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("appointments_management_token_hash_unique").on(table.managementTokenHash),
    index("appointments_barbershop_starts_at_idx").on(table.barbershopId, table.startsAt),
    index("appointments_staff_starts_at_idx").on(table.staffId, table.startsAt),
    index("appointments_customer_starts_at_idx").on(table.customerId, table.startsAt),
    check("appointments_valid_range", sql`${table.endsAt} > ${table.startsAt}`),
    check(
      "appointments_cancellation_fields_consistent",
      sql`(
        ${table.status} = 'CANCELLED'
        AND ${table.cancelledAt} IS NOT NULL
        AND ${table.cancelledBy} IS NOT NULL
        AND ${table.cancellationKind} IS NOT NULL
      ) OR (
        ${table.status} <> 'CANCELLED'
        AND ${table.cancelledAt} IS NULL
        AND ${table.cancelledBy} IS NULL
        AND ${table.cancellationKind} IS NULL
      )`,
    ),
  ],
);
