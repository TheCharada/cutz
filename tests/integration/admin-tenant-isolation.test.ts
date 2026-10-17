import { inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, getPool } from "@/infrastructure/db/client";
import {
  appointments,
  barbershops,
  customers,
  services,
  staffMembers,
} from "@/infrastructure/db/schema";
import { getAdminServices, getAdminStaff } from "@/modules/catalog";
import { getAdminCustomers } from "@/modules/customers";
import { hashOpaqueToken } from "@/shared/tokens";
import { listAdminAgenda } from "@/workflows/admin-appointments";

const db = getDb();

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createFixture() {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [tenantA, tenantB] = await db
    .insert(barbershops)
    .values([
      {
        name: `Isolation A ${suffix}`,
        slug: `isolation-a-${suffix}`,
        timezone: "America/Sao_Paulo",
        bookingIntervalMinutes: 15,
        customerVerificationMode: "NONE",
        waitlistOfferTtlMinutes: 10,
        reminderOffsetMinutes: 60,
      },
      {
        name: `Isolation B ${suffix}`,
        slug: `isolation-b-${suffix}`,
        timezone: "America/Sao_Paulo",
        bookingIntervalMinutes: 15,
        customerVerificationMode: "NONE",
        waitlistOfferTtlMinutes: 10,
        reminderOffsetMinutes: 60,
      },
    ])
    .returning();

  const [customerA, customerB] = await db
    .insert(customers)
    .values([
      {
        barbershopId: tenantA.id,
        name: "Customer A",
        phoneE164: `+55117${suffix.replace(/[^0-9]/g, "").padEnd(8, "1").slice(0, 8)}`,
      },
      {
        barbershopId: tenantB.id,
        name: "Customer B",
        phoneE164: `+55116${suffix.replace(/[^0-9]/g, "").padEnd(8, "2").slice(0, 8)}`,
      },
    ])
    .returning();
  const [serviceA, serviceB] = await db
    .insert(services)
    .values([
      { barbershopId: tenantA.id, name: "Service A", durationMinutes: 30 },
      { barbershopId: tenantB.id, name: "Service B", durationMinutes: 30 },
    ])
    .returning();
  const [staffA, staffB] = await db
    .insert(staffMembers)
    .values([
      { barbershopId: tenantA.id, name: "Staff A" },
      { barbershopId: tenantB.id, name: "Staff B" },
    ])
    .returning();

  const startsAt = new Date("2026-09-07T12:00:00.000Z");
  const endsAt = new Date("2026-09-07T12:30:00.000Z");
  const [appointmentA, appointmentB] = await db
    .insert(appointments)
    .values([
      {
        barbershopId: tenantA.id,
        customerId: customerA.id,
        serviceId: serviceA.id,
        staffId: staffA.id,
        startsAt,
        endsAt,
        managementTokenHash: hashOpaqueToken(`isolation-a-${suffix}`),
      },
      {
        barbershopId: tenantB.id,
        customerId: customerB.id,
        serviceId: serviceB.id,
        staffId: staffB.id,
        startsAt,
        endsAt,
        managementTokenHash: hashOpaqueToken(`isolation-b-${suffix}`),
      },
    ])
    .returning();

  return {
    tenantA,
    tenantB,
    customerA,
    customerB,
    serviceA,
    serviceB,
    staffA,
    staffB,
    appointmentA,
    appointmentB,
  };
}

async function cleanFixture(fixture: Fixture) {
  const tenantIds = [fixture.tenantA.id, fixture.tenantB.id];
  await db.delete(appointments).where(inArray(appointments.barbershopId, tenantIds));
  await db.delete(customers).where(inArray(customers.barbershopId, tenantIds));
  await db.delete(staffMembers).where(inArray(staffMembers.barbershopId, tenantIds));
  await db.delete(services).where(inArray(services.barbershopId, tenantIds));
  await db.delete(barbershops).where(inArray(barbershops.id, tenantIds));
}

describe("admin tenant isolation", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await createFixture();
  });

  afterEach(async () => {
    await cleanFixture(fixture);
  });

  afterAll(async () => {
    await getPool().end();
  });

  it("isolates appointments, customers, services and staff by barbershop", async () => {
    const agendaA = await listAdminAgenda(
      {
        barbershop: {
          id: fixture.tenantA.id,
          slug: fixture.tenantA.slug,
          timezone: fixture.tenantA.timezone,
          bookingIntervalMinutes: fixture.tenantA.bookingIntervalMinutes,
          customerVerificationMode: fixture.tenantA.customerVerificationMode,
          waitlistOfferTtlMinutes: fixture.tenantA.waitlistOfferTtlMinutes,
          reminderOffsetMinutes: fixture.tenantA.reminderOffsetMinutes,
        },
        date: "2026-09-07",
      },
      { database: db },
    );
    expect(agendaA.map((row) => row.id)).toEqual([fixture.appointmentA.id]);
    expect(agendaA.map((row) => row.id)).not.toContain(fixture.appointmentB.id);

    const customerPageA = await getAdminCustomers(db, {
      barbershopId: fixture.tenantA.id,
      page: 1,
      pageSize: 100,
    });
    expect(customerPageA.rows.map((row) => row.id)).toEqual([fixture.customerA.id]);
    expect(customerPageA.rows.map((row) => row.id)).not.toContain(fixture.customerB.id);

    const servicesA = await getAdminServices(db, fixture.tenantA.id);
    expect(servicesA.map((row) => row.id)).toEqual([fixture.serviceA.id]);
    expect(servicesA.map((row) => row.id)).not.toContain(fixture.serviceB.id);

    const staffA = await getAdminStaff(db, fixture.tenantA.id);
    expect(staffA.map((row) => row.id)).toEqual([fixture.staffA.id]);
    expect(staffA.map((row) => row.id)).not.toContain(fixture.staffB.id);
  });
});
