import { and, asc, eq } from "drizzle-orm";
import type { DbExecutor } from "@/infrastructure/db/executor";
import { customers, services, staffMembers, waitlistEntries } from "@/infrastructure/db/schema";

const adminEntrySelection = {
  id: waitlistEntries.id,
  barbershopId: waitlistEntries.barbershopId,
  customerId: waitlistEntries.customerId,
  serviceId: waitlistEntries.serviceId,
  staffId: waitlistEntries.staffId,
  desiredDate: waitlistEntries.desiredDate,
  earliestTime: waitlistEntries.earliestTime,
  latestTime: waitlistEntries.latestTime,
  status: waitlistEntries.status,
  createdAt: waitlistEntries.createdAt,
  updatedAt: waitlistEntries.updatedAt,
};

export function listAdminWaitlistRows(executor: DbExecutor, barbershopId: string) {
  return executor
    .select({
      ...adminEntrySelection,
      customerName: customers.name,
      customerPhoneE164: customers.phoneE164,
      serviceName: services.name,
      staffName: staffMembers.name,
    })
    .from(waitlistEntries)
    .innerJoin(
      customers,
      and(eq(customers.id, waitlistEntries.customerId), eq(customers.barbershopId, barbershopId)),
    )
    .innerJoin(
      services,
      and(eq(services.id, waitlistEntries.serviceId), eq(services.barbershopId, barbershopId)),
    )
    .leftJoin(
      staffMembers,
      and(eq(staffMembers.id, waitlistEntries.staffId), eq(staffMembers.barbershopId, barbershopId)),
    )
    .where(eq(waitlistEntries.barbershopId, barbershopId))
    .orderBy(asc(waitlistEntries.createdAt), asc(waitlistEntries.id));
}

export async function findAdminWaitlistEntry(
  executor: DbExecutor,
  barbershopId: string,
  entryId: string,
) {
  const [row] = await executor
    .select(adminEntrySelection)
    .from(waitlistEntries)
    .where(and(eq(waitlistEntries.barbershopId, barbershopId), eq(waitlistEntries.id, entryId)))
    .limit(1);
  return row ?? null;
}

export async function lockAdminWaitlistEntry(
  executor: DbExecutor,
  barbershopId: string,
  entryId: string,
) {
  const [row] = await executor
    .select(adminEntrySelection)
    .from(waitlistEntries)
    .where(and(eq(waitlistEntries.barbershopId, barbershopId), eq(waitlistEntries.id, entryId)))
    .limit(1)
    .for("update");
  return row ?? null;
}
