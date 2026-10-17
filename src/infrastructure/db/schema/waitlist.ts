import { sql } from "drizzle-orm";
import { check, date, index, pgTable, text, time, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { appointments } from "./appointments";
import { barbershops } from "./barbershops";
import { services, staffMembers } from "./catalog";
import { customers } from "./customers";
import { waitlistEntryStatusEnum, waitlistOfferStatusEnum } from "./enums";

export const waitlistEntries = pgTable(
  "waitlist_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    barbershopId: uuid("barbershop_id")
      .notNull()
      .references(() => barbershops.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "restrict" }),
    staffId: uuid("staff_id").references(() => staffMembers.id, { onDelete: "restrict" }),
    desiredDate: date("desired_date").notNull(),
    earliestTime: time("earliest_time").notNull(),
    latestTime: time("latest_time").notNull(),
    status: waitlistEntryStatusEnum("status").default("ACTIVE").notNull(),
    managementTokenHash: text("management_token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("waitlist_entries_management_token_hash_unique").on(table.managementTokenHash),
    index("waitlist_entries_lookup_idx").on(
      table.barbershopId,
      table.status,
      table.desiredDate,
      table.createdAt,
    ),
    check("waitlist_entries_valid_window", sql`${table.latestTime} > ${table.earliestTime}`),
  ],
);

export const waitlistOffers = pgTable(
  "waitlist_offers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    barbershopId: uuid("barbershop_id")
      .notNull()
      .references(() => barbershops.id, { onDelete: "restrict" }),
    waitlistEntryId: uuid("waitlist_entry_id")
      .notNull()
      .references(() => waitlistEntries.id, { onDelete: "restrict" }),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "restrict" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: waitlistOfferStatusEnum("status").default("PENDING").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    actionTokenHash: text("action_token_hash").notNull(),
    appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "restrict" }),
    opportunityId: uuid("opportunity_id").notNull(),
    opportunityStartsAt: timestamp("opportunity_starts_at", { withTimezone: true }).notNull(),
    opportunityEndsAt: timestamp("opportunity_ends_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("waitlist_offers_action_token_hash_unique").on(table.actionTokenHash),
    uniqueIndex("waitlist_offers_opportunity_entry_unique").on(
      table.opportunityId,
      table.waitlistEntryId,
    ),
    uniqueIndex("waitlist_offers_one_pending_per_entry")
      .on(table.waitlistEntryId)
      .where(sql`${table.status} = 'PENDING'`),
    index("waitlist_offers_status_expires_at_idx").on(table.status, table.expiresAt),
    check("waitlist_offers_valid_range", sql`${table.endsAt} > ${table.startsAt}`),
    check("waitlist_offers_valid_opportunity_range", sql`${table.opportunityEndsAt} > ${table.opportunityStartsAt}`),
    check("waitlist_offers_expiry_after_creation", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);
