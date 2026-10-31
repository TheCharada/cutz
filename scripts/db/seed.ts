import "dotenv/config";
import * as argon2 from "argon2";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, getPool, type Database } from "@/infrastructure/db/client";
import {
  appointments,
  appointmentServices,
  barbershopMemberships,
  barbershops,
  customers,
  services,
  staffMembers,
  staffServices,
  users,
  workingHours,
} from "@/infrastructure/db/schema";
import { hashOpaqueToken } from "@/shared/tokens";

const seedEnvSchema = z.object({
  SEED_ADMIN_EMAIL: z.string().email().transform((value) => value.trim().toLowerCase()),
  SEED_ADMIN_PASSWORD: z.string().min(8),
});

type SeedOptions = {
  includeDemoFixtures?: boolean;
};

async function findOrCreateService(
  db: Database,
  barbershopId: string,
  name: string,
  durationMinutes: number,
) {
  const [existing] = await db
    .select()
    .from(services)
    .where(and(eq(services.barbershopId, barbershopId), eq(services.name, name)))
    .limit(1);

  if (existing) {
    return existing;
  }

  const [created] = await db
    .insert(services)
    .values({ barbershopId, name, durationMinutes })
    .returning();

  return created;
}

async function findOrCreateSeedCustomer(
  db: Database,
  barbershopId: string,
  name: string,
  phoneE164: string,
  now: Date,
) {
  const [customer] = await db
    .insert(customers)
    .values({ barbershopId, name, phoneE164 })
    .onConflictDoUpdate({
      target: [customers.barbershopId, customers.phoneE164],
      set: { name, updatedAt: now },
    })
    .returning();
  return customer;
}

async function upsertSeedAppointment(
  db: Database,
  params: {
    barbershopId: string;
    customerId: string;
    staffId: string;
    serviceId: string;
    startsAt: Date;
    token: string;
    now: Date;
  },
) {
  const endsAt = new Date(params.startsAt.getTime() + 30 * 60_000);
  const managementTokenHash = hashOpaqueToken(params.token);
  const [appointment] = await db
    .insert(appointments)
    .values({
      barbershopId: params.barbershopId,
      customerId: params.customerId,
      staffId: params.staffId,
      serviceId: params.serviceId,
      startsAt: params.startsAt,
      endsAt,
      managementTokenHash,
    })
    .onConflictDoUpdate({
      target: appointments.managementTokenHash,
      set: {
        customerId: params.customerId,
        staffId: params.staffId,
        serviceId: params.serviceId,
        startsAt: params.startsAt,
        endsAt,
        status: "SCHEDULED",
        cancelledAt: null,
        cancelledBy: null,
        cancellationKind: null,
        cancellationReason: null,
        rescheduledFromId: null,
        updatedAt: params.now,
      },
    })
    .returning({ id: appointments.id });

  const [service] = await db.select({
    name: services.name,
    durationMinutes: services.durationMinutes,
    priceCents: services.priceCents,
  }).from(services).where(eq(services.id, params.serviceId)).limit(1);
  if (!service) throw new Error("Seed appointment service missing");
  await db.insert(appointmentServices).values({
    barbershopId: params.barbershopId,
    appointmentId: appointment.id,
    serviceId: params.serviceId,
    kind: "BOOKED",
    serviceNameSnapshot: service.name,
    durationMinutesSnapshot: service.durationMinutes,
    unitPriceCents: service.priceCents,
    historicalSnapshotComplete: true,
  }).onConflictDoNothing();
}

export async function seedDatabase(options: SeedOptions = {}) {
  const db = getDb();
  const env = seedEnvSchema.parse(process.env);
  const now = new Date();

  const [barbershop] = await db
    .insert(barbershops)
    .values({
      name: "Barbearia Exemplo",
      slug: "demo",
      timezone: "America/Sao_Paulo",
      bookingIntervalMinutes: 15,
      customerVerificationMode: "NONE",
      waitlistOfferTtlMinutes: 10,
      reminderOffsetMinutes: 1440,
    })
    .onConflictDoUpdate({
      target: barbershops.slug,
      set: {
        name: "Barbearia Exemplo",
        updatedAt: now,
      },
    })
    .returning();

  const [existingStaff] = await db
    .select()
    .from(staffMembers)
    .where(and(eq(staffMembers.barbershopId, barbershop.id), eq(staffMembers.name, "Profissional Exemplo")))
    .limit(1);

  const staff =
    existingStaff ??
    (
      await db
        .insert(staffMembers)
        .values({ barbershopId: barbershop.id, name: "Profissional Exemplo" })
        .returning()
    )[0];

  const serviceRows = await Promise.all([
    findOrCreateService(db, barbershop.id, "Corte", 30),
    findOrCreateService(db, barbershop.id, "Barba", 30),
    findOrCreateService(db, barbershop.id, "Corte + Barba", 60),
  ]);

  await db
    .insert(staffServices)
    .values(serviceRows.map((service) => ({ staffId: staff.id, serviceId: service.id })))
    .onConflictDoNothing();

  await db.delete(workingHours).where(eq(workingHours.staffId, staff.id));
  await db.insert(workingHours).values([
    { staffId: staff.id, weekday: 1, startsAt: "09:00", endsAt: "12:00" },
    { staffId: staff.id, weekday: 1, startsAt: "13:00", endsAt: "18:00" },
    { staffId: staff.id, weekday: 2, startsAt: "09:00", endsAt: "12:00" },
    { staffId: staff.id, weekday: 2, startsAt: "13:00", endsAt: "18:00" },
    { staffId: staff.id, weekday: 3, startsAt: "09:00", endsAt: "12:00" },
    { staffId: staff.id, weekday: 3, startsAt: "13:00", endsAt: "18:00" },
    { staffId: staff.id, weekday: 4, startsAt: "09:00", endsAt: "12:00" },
    { staffId: staff.id, weekday: 4, startsAt: "13:00", endsAt: "18:00" },
    { staffId: staff.id, weekday: 5, startsAt: "09:00", endsAt: "12:00" },
    { staffId: staff.id, weekday: 5, startsAt: "13:00", endsAt: "18:00" },
    { staffId: staff.id, weekday: 6, startsAt: "09:00", endsAt: "13:00" },
  ]);

  const passwordHash = await argon2.hash(env.SEED_ADMIN_PASSWORD, { type: argon2.argon2id });
  const [admin] = await db
    .insert(users)
    .values({ email: env.SEED_ADMIN_EMAIL, passwordHash })
    .onConflictDoUpdate({
      target: users.email,
      set: { passwordHash, updatedAt: now },
    })
    .returning();

  await db
    .insert(barbershopMemberships)
    .values({ userId: admin.id, barbershopId: barbershop.id, role: "OWNER" })
    .onConflictDoUpdate({
      target: [barbershopMemberships.userId, barbershopMemberships.barbershopId],
      set: { role: "OWNER" },
    });

  if (options.includeDemoFixtures === false) return;

  const corte = serviceRows.find((service) => service.name === "Corte");
  if (!corte) throw new Error("Corte seed service is required");
  const completeCustomer = await findOrCreateSeedCustomer(
    db,
    barbershop.id,
    "E2E Complete",
    "+5511999990001",
    now,
  );
  const noShowCustomer = await findOrCreateSeedCustomer(
    db,
    barbershop.id,
    "E2E No-show",
    "+5511999990002",
    now,
  );
  await upsertSeedAppointment(db, {
    barbershopId: barbershop.id,
    customerId: completeCustomer.id,
    staffId: staff.id,
    serviceId: corte.id,
    startsAt: new Date("2026-09-01T12:00:00.000Z"),
    token: "seed-admin-complete",
    now,
  });
  await upsertSeedAppointment(db, {
    barbershopId: barbershop.id,
    customerId: noShowCustomer.id,
    staffId: staff.id,
    serviceId: corte.id,
    startsAt: new Date("2026-09-01T13:00:00.000Z"),
    token: "seed-admin-no-show",
    now,
  });
}

// tsup inlines imported modules into bootstrap.js, so import.meta.url cannot
// distinguish the seed CLI from the production bootstrap after bundling.
const isSeedCli = process.argv[1] ? /(?:^|[\\/])seed\.(?:ts|js)$/.test(process.argv[1]) : false;

if (isSeedCli) {
  try {
    await seedDatabase();
    console.log("Development seed applied.");
  } finally {
    await getPool().end();
  }
}
