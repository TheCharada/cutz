import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { appointments } from "./appointments";
import { barbershops } from "./barbershops";
import { waitlistEntries } from "./waitlist";

export const telegramLinkTokens = pgTable(
  "telegram_link_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tokenHash: text("token_hash").notNull(),
    barbershopId: uuid("barbershop_id")
      .notNull()
      .references(() => barbershops.id, { onDelete: "restrict" }),
    appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "restrict" }),
    waitlistEntryId: uuid("waitlist_entry_id").references(() => waitlistEntries.id, { onDelete: "restrict" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("telegram_link_tokens_token_hash_unique").on(table.tokenHash),
    check(
      "telegram_link_tokens_exactly_one_scope",
      sql`(${table.appointmentId} IS NOT NULL) <> (${table.waitlistEntryId} IS NOT NULL)`,
    ),
  ],
);

export const telegramChatLinks = pgTable(
  "telegram_chat_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    barbershopId: uuid("barbershop_id")
      .notNull()
      .references(() => barbershops.id, { onDelete: "restrict" }),
    appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "restrict" }),
    waitlistEntryId: uuid("waitlist_entry_id").references(() => waitlistEntries.id, { onDelete: "restrict" }),
    chatId: text("chat_id").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("telegram_chat_links_appointment_unique").on(table.appointmentId),
    uniqueIndex("telegram_chat_links_waitlist_unique").on(table.waitlistEntryId),
    check(
      "telegram_chat_links_exactly_one_scope",
      sql`(${table.appointmentId} IS NOT NULL) <> (${table.waitlistEntryId} IS NOT NULL)`,
    ),
  ],
);
