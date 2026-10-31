import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { barbershops } from "./barbershops";
import { users } from "./identity";

export const services = pgTable("services", {
  id: uuid("id").defaultRandom().primaryKey(),
  barbershopId: uuid("barbershop_id")
    .notNull()
    .references(() => barbershops.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  priceCents: integer("price_cents"),
  imageKey: text("image_key"),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("services_barbershop_idx").on(table.barbershopId),
  check("services_duration_positive", sql`${table.durationMinutes} > 0`),
  check("services_price_nonnegative", sql`${table.priceCents} IS NULL OR ${table.priceCents} >= 0`),
]);

export const staffMembers = pgTable(
  "staff_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    barbershopId: uuid("barbershop_id")
      .notNull()
      .references(() => barbershops.id, { onDelete: "restrict" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    imageKey: text("image_key"),
    active: boolean("active").default(true).notNull(),
    acceptsAppointments: boolean("accepts_appointments").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("staff_members_barbershop_idx").on(table.barbershopId),
    uniqueIndex("staff_members_barbershop_user_unique").on(table.barbershopId, table.userId),
  ],
);

export const staffServices = pgTable(
  "staff_services",
  {
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.staffId, table.serviceId] })],
);

export const workingHours = pgTable(
  "working_hours",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "cascade" }),
    weekday: integer("weekday").notNull(),
    startsAt: time("starts_at").notNull(),
    endsAt: time("ends_at").notNull(),
  },
  (table) => [
    index("working_hours_staff_weekday_idx").on(table.staffId, table.weekday),
    check("working_hours_weekday_range", sql`${table.weekday} BETWEEN 0 AND 6`),
    check("working_hours_valid_range", sql`${table.endsAt} > ${table.startsAt}`),
  ],
);

export const timeOff = pgTable(
  "time_off",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("time_off_staff_starts_at_idx").on(table.staffId, table.startsAt),
    check("time_off_valid_range", sql`${table.endsAt} > ${table.startsAt}`),
  ],
);
