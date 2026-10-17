import { and, count, eq, sql } from "drizzle-orm";
import type { DbExecutor } from "@/infrastructure/db/executor";
import { waitlistEntries } from "@/infrastructure/db/schema";

export async function lockWaitlistCreationForCustomer(
  executor: DbExecutor,
  barbershopId: string,
  customerId: string,
) {
  await executor.execute(
    sql`select pg_advisory_xact_lock(hashtext(${barbershopId}), hashtext(${`waitlist:${customerId}`}))`,
  );
}

export async function countActiveWaitlistEntriesForCustomer(
  executor: DbExecutor,
  barbershopId: string,
  customerId: string,
) {
  const [row] = await executor
    .select({ value: count() })
    .from(waitlistEntries)
    .where(
      and(
        eq(waitlistEntries.barbershopId, barbershopId),
        eq(waitlistEntries.customerId, customerId),
        eq(waitlistEntries.status, "ACTIVE"),
      ),
    );
  return row.value;
}
