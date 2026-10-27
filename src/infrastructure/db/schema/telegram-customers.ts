import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { barbershops } from "./barbershops";
import { customers } from "./customers";

/** Telegram subscriptions are granted only after proving ownership of the phone in Telegram. */
export const telegramCustomerLinks = pgTable(
  "telegram_customer_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    barbershopId: uuid("barbershop_id").notNull().references(() => barbershops.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "restrict" }),
    chatId: text("chat_id").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("telegram_customer_links_tenant_customer_unique")
      .on(table.barbershopId, table.customerId),
    uniqueIndex("telegram_customer_links_tenant_chat_unique")
      .on(table.barbershopId, table.chatId),
  ],
);

/** Short-lived authorization to verify a customer after redeeming a resource capability. */
export const telegramContactChallenges = pgTable(
  "telegram_contact_challenges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    chatId: text("chat_id").notNull(),
    barbershopId: uuid("barbershop_id").notNull().references(() => barbershops.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "restrict" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("telegram_contact_challenges_chat_unique").on(table.chatId),
  ],
);
