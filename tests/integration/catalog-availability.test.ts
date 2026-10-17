import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, getPool } from "@/infrastructure/db/client";
import {
  appointments,
  barbershops,
  customers,
  services,
  staffMembers,
  staffServices,
  timeOff,
  workingHours,
} from "@/infrastructure/db/schema";
import { FixedClock } from "@/shared/clock";
import {
  getPublicAvailabilityForBarbershop,
  listPublicServicesForBarbershop,
  listPublicStaffForBarbershop,
} from "@/workflows/public-catalog";

const db = getDb();
type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createFixture() {
  const suffix = randomUUID().slice(0, 8);
  const [tenant] = await db
    .insert(barbershops)
    .values({
      name: `Tenant ${suffix}`,
      slug: `tenant-${suffix}`,
      timezone: "America/Sao_Paulo",
      bookingIntervalMinutes: 30,
      customerVerificationMode: "NONE",
      waitlistOfferTtlMinutes: 10,
      reminderOffsetMinutes: 1440,
    })
    .returning();
  const [otherTenant] = await db
    .insert(barbershops)
    .values({
      name: `Other ${suffix}`,
      slug: `other-${suffix}`,
      timezone: "America/Sao_Paulo",
      bookingIntervalMinutes: 30,
      customerVerificationMode: "NONE",
      waitlistOfferTtlMinutes: 10,
      reminderOffsetMinutes: 1440,
    })
    .returning();

  const [service] = await db
    .insert(services)
    .values({ barbershopId: tenant.id, name: "Cut", durationMinutes: 30 })
    .returning();
  const [inactiveService] = await db
    .insert(services)
    .values({
      barbershopId: tenant.id,
      name: "Inactive",
      durationMinutes: 30,
      active: false,
    })
    .returning();
  const [otherService] = await db
    .insert(services)
    .values({ barbershopId: otherTenant.id, name: "Other cut", durationMinutes: 30 })
    .returning();

  const [eligibleStaff] = await db
    .insert(staffMembers)
    .values({ barbershopId: tenant.id, name: "Eligible" })
    .returning();
  const [inactiveStaff] = await db
    .insert(staffMembers)
    .values({ barbershopId: tenant.id, name: "Inactive", active: false })
    .returning();
  const [nonBookableStaff] = await db
    .insert(staffMembers)
    .values({
      barbershopId: tenant.id,
      name: "Non-bookable",
      acceptsAppointments: false,
    })
    .returning();
  const [unmappedStaff] = await db
    .insert(staffMembers)
    .values({ barbershopId: tenant.id, name: "Unmapped" })
    .returning();
  const [otherStaff] = await db
    .insert(staffMembers)
    .values({ barbershopId: otherTenant.id, name: "Other staff" })
    .returning();

  await db.insert(staffServices).values([
    { staffId: eligibleStaff.id, serviceId: service.id },
    { staffId: inactiveStaff.id, serviceId: service.id },
    { staffId: nonBookableStaff.id, serviceId: service.id },
    { staffId: otherStaff.id, serviceId: otherService.id },
  ]);
  await db.insert(workingHours).values([
    { staffId: eligibleStaff.id, weekday: 1, startsAt: "08:00", endsAt: "10:00" },
    { staffId: inactiveStaff.id, weekday: 1, startsAt: "08:00", endsAt: "10:00" },
    { staffId: nonBookableStaff.id, weekday: 1, startsAt: "08:00", endsAt: "10:00" },
    { staffId: unmappedStaff.id, weekday: 1, startsAt: "08:00", endsAt: "10:00" },
    { staffId: otherStaff.id, weekday: 1, startsAt: "08:00", endsAt: "10:00" },
  ]);

  return {
    tenant,
    otherTenant,
    service,
    inactiveService,
    otherService,
    eligibleStaff,
    inactiveStaff,
    nonBookableStaff,
    unmappedStaff,
    otherStaff,
  };
}

async function cleanFixture(fixture: Fixture) {
  const tenantIds = [fixture.tenant.id, fixture.otherTenant.id];
  const staffIds = [
    fixture.eligibleStaff.id,
    fixture.inactiveStaff.id,
    fixture.nonBookableStaff.id,
    fixture.unmappedStaff.id,
    fixture.otherStaff.id,
  ];

  await db.delete(appointments).where(inArray(appointments.barbershopId, tenantIds));
  await db.delete(timeOff).where(inArray(timeOff.staffId, staffIds));
  await db.delete(workingHours).where(inArray(workingHours.staffId, staffIds));
  await db.delete(staffServices).where(inArray(staffServices.staffId, staffIds));
  await db.delete(customers).where(inArray(customers.barbershopId, tenantIds));
  await db.delete(staffMembers).where(inArray(staffMembers.id, staffIds));
  await db.delete(services).where(inArray(services.barbershopId, tenantIds));
  await db.delete(barbershops).where(inArray(barbershops.id, tenantIds));
}

describe("public catalog and availability", () => {
  let fixture: Fixture;
  const clock = new FixedClock(new Date("2026-09-07T10:00:00.000Z"));

  beforeEach(async () => {
    fixture = await createFixture();
  });

  afterEach(async () => {
    await cleanFixture(fixture);
  });

  afterAll(async () => {
    await getPool().end();
  });

  it("isolates public services and hides inactive services", async () => {
    const rows = await listPublicServicesForBarbershop(fixture.tenant.slug, db);

    expect(rows).toEqual([
      {
        id: fixture.service.id,
        name: "Cut",
        durationMinutes: 30,
        priceCents: null,
      },
    ]);
    expect(rows?.some((row) => row.id === fixture.otherService.id)).toBe(false);
  });

  it("only exposes active staff that accepts appointments for the tenant", async () => {
    const rows = await listPublicStaffForBarbershop(fixture.tenant.slug, db);
    const ids = rows?.map((row) => row.id) ?? [];

    expect(ids).toContain(fixture.eligibleStaff.id);
    expect(ids).toContain(fixture.unmappedStaff.id);
    expect(ids).not.toContain(fixture.inactiveStaff.id);
    expect(ids).not.toContain(fixture.nonBookableStaff.id);
    expect(ids).not.toContain(fixture.otherStaff.id);
  });

  it("only produces slots for active bookable staff mapped to the requested service", async () => {
    const result = await getPublicAvailabilityForBarbershop(
      {
        slug: fixture.tenant.slug,
        serviceId: fixture.service.id,
        date: "2026-09-07",
      },
      { executor: db, clock },
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("expected availability result");
    }

    expect(new Set(result.slots.map((slot) => slot.staffId))).toEqual(
      new Set([fixture.eligibleStaff.id]),
    );
    expect(result.slots).toHaveLength(4);
  });

  it("does not expose availability for inactive or cross-tenant services", async () => {
    const inactive = await getPublicAvailabilityForBarbershop(
      {
        slug: fixture.tenant.slug,
        serviceId: fixture.inactiveService.id,
        date: "2026-09-07",
      },
      { executor: db, clock },
    );
    const crossTenant = await getPublicAvailabilityForBarbershop(
      {
        slug: fixture.tenant.slug,
        serviceId: fixture.otherService.id,
        date: "2026-09-07",
      },
      { executor: db, clock },
    );

    expect(inactive.status).toBe("service-not-found");
    expect(crossTenant.status).toBe("service-not-found");
  });

  it("subtracts persisted TimeOff and scheduled appointments", async () => {
    const [customer] = await db
      .insert(customers)
      .values({
        barbershopId: fixture.tenant.id,
        name: "Customer",
        phoneE164: `+5514${Date.now().toString().slice(-8)}`,
      })
      .returning();

    await db.insert(timeOff).values({
      staffId: fixture.eligibleStaff.id,
      startsAt: new Date("2026-09-07T11:30:00.000Z"),
      endsAt: new Date("2026-09-07T12:00:00.000Z"),
    });
    await db.insert(appointments).values({
      barbershopId: fixture.tenant.id,
      customerId: customer.id,
      staffId: fixture.eligibleStaff.id,
      serviceId: fixture.service.id,
      startsAt: new Date("2026-09-07T12:00:00.000Z"),
      endsAt: new Date("2026-09-07T12:30:00.000Z"),
      status: "SCHEDULED",
      managementTokenHash: randomUUID(),
    });

    const result = await getPublicAvailabilityForBarbershop(
      {
        slug: fixture.tenant.slug,
        serviceId: fixture.service.id,
        date: "2026-09-07",
      },
      { executor: db, clock },
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("expected availability result");
    }

    expect(result.slots.map((slot) => slot.startsAt)).toEqual([
      "2026-09-07T11:00:00.000Z",
      "2026-09-07T12:30:00.000Z",
    ]);
  });
});
