import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "@/infrastructure/db/executor";
import { waitlistEntries } from "@/infrastructure/db/schema";

export async function findWaitlistEntryById(
  executor: DbExecutor,
  barbershopId: string,
  entryId: string,
) {
  const [row] = await executor
    .select({
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
    })
    .from(waitlistEntries)
    .where(and(eq(waitlistEntries.barbershopId, barbershopId), eq(waitlistEntries.id, entryId)))
    .limit(1);

  return row ?? null;
}
