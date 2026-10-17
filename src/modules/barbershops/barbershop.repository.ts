import { eq } from "drizzle-orm";
import type { DbExecutor } from "@/infrastructure/db/executor";
import { barbershops } from "@/infrastructure/db/schema";

const contextSelection = {
  id: barbershops.id,
  slug: barbershops.slug,
  timezone: barbershops.timezone,
  bookingIntervalMinutes: barbershops.bookingIntervalMinutes,
  customerVerificationMode: barbershops.customerVerificationMode,
  waitlistOfferTtlMinutes: barbershops.waitlistOfferTtlMinutes,
  reminderOffsetMinutes: barbershops.reminderOffsetMinutes,
};

export async function findBarbershopContextBySlug(executor: DbExecutor, slug: string) {
  const [row] = await executor
    .select(contextSelection)
    .from(barbershops)
    .where(eq(barbershops.slug, slug))
    .limit(1);

  return row ?? null;
}

export async function findBarbershopContextById(executor: DbExecutor, barbershopId: string) {
  const [row] = await executor
    .select(contextSelection)
    .from(barbershops)
    .where(eq(barbershops.id, barbershopId))
    .limit(1);

  return row ?? null;
}
