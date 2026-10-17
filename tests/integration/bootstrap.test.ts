import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { seedDatabase } from "../../scripts/db/seed";
import { getDb, getPool } from "@/infrastructure/db/client";
import { barbershops, services, staffMembers, users } from "@/infrastructure/db/schema";
import { FixedClock } from "@/shared/clock";
import {
  getPublicAvailabilityForBarbershop,
  listPublicServicesForBarbershop,
  listPublicStaffForBarbershop,
} from "@/workflows/public-catalog";

const db = getDb();

describe("database bootstrap", () => {
  it("keeps the Barbearia Exemplo seed idempotent and serves the Slice 1 public catalog", async () => {
    await seedDatabase();
    await seedDatabase();

    const [barbershopCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(barbershops)
      .where(eq(barbershops.slug, "demo"));

    const [staffCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(staffMembers);

    const [serviceCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(services);

    const [userCount] = await db.select({ count: sql<number>`count(*)::int` }).from(users);

    expect(barbershopCount.count).toBe(1);
    expect(staffCount.count).toBe(1);
    expect(serviceCount.count).toBe(3);
    expect(userCount.count).toBe(1);

    const publicServices = await listPublicServicesForBarbershop("demo", db);
    expect(publicServices).toHaveLength(3);
    expect(publicServices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Corte", durationMinutes: 30 }),
        expect.objectContaining({ name: "Barba", durationMinutes: 30 }),
        expect.objectContaining({ name: "Corte + Barba", durationMinutes: 60 }),
      ]),
    );

    const publicStaff = await listPublicStaffForBarbershop("demo", db);
    expect(publicStaff).toHaveLength(1);
    expect(publicStaff?.[0]?.name).toBe("Profissional Exemplo");

    const corte = publicServices?.find((service) => service.name === "Corte");
    const professional = publicStaff?.[0];
    if (!corte || !professional) {
      throw new Error("Barbearia Exemplo public seed is incomplete");
    }

    const availability = await getPublicAvailabilityForBarbershop(
      {
        slug: "demo",
        serviceId: corte.id,
        date: "2026-09-07",
      },
      {
        executor: db,
        clock: new FixedClock(new Date("2026-09-07T10:00:00.000Z")),
      },
    );

    expect(availability.status).toBe("ok");
    if (availability.status !== "ok") {
      throw new Error("expected Barbearia Exemplo availability");
    }

    expect(availability.slots).toHaveLength(30);
    expect(availability.slots[0]).toEqual({
      staffId: professional.id,
      startsAt: "2026-09-07T12:00:00.000Z",
      endsAt: "2026-09-07T12:30:00.000Z",
    });
    expect(availability.slots[availability.slots.length - 1]).toEqual({
      staffId: professional.id,
      startsAt: "2026-09-07T20:30:00.000Z",
      endsAt: "2026-09-07T21:00:00.000Z",
    });
  });
});

afterAll(async () => {
  await getPool().end();
});
