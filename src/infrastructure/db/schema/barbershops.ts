import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { customerVerificationModeEnum } from "./enums";

export const barbershops = pgTable(
  "barbershops",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    timezone: text("timezone").notNull(),
    bookingIntervalMinutes: integer("booking_interval_minutes").notNull(),
    customerVerificationMode: customerVerificationModeEnum("customer_verification_mode")
      .default("NONE")
      .notNull(),
    waitlistOfferTtlMinutes: integer("waitlist_offer_ttl_minutes").notNull(),
    reminderOffsetMinutes: integer("reminder_offset_minutes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("barbershops_slug_unique").on(table.slug),
    check("barbershops_booking_interval_positive", sql`${table.bookingIntervalMinutes} > 0`),
    check("barbershops_waitlist_ttl_positive", sql`${table.waitlistOfferTtlMinutes} > 0`),
    check("barbershops_reminder_offset_nonnegative", sql`${table.reminderOffsetMinutes} >= 0`),
  ],
);
