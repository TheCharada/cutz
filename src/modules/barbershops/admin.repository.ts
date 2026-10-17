import { eq } from "drizzle-orm";
import type { DbExecutor } from "@/infrastructure/db/executor";
import { barbershops } from "@/infrastructure/db/schema";

const settingsSelection = {
  id: barbershops.id,
  name: barbershops.name,
  slug: barbershops.slug,
  timezone: barbershops.timezone,
  bookingIntervalMinutes: barbershops.bookingIntervalMinutes,
  customerVerificationMode: barbershops.customerVerificationMode,
  waitlistOfferTtlMinutes: barbershops.waitlistOfferTtlMinutes,
  reminderOffsetMinutes: barbershops.reminderOffsetMinutes,
};

export async function findAdminBarbershopSettings(executor: DbExecutor, barbershopId: string) {
  const [row] = await executor.select(settingsSelection).from(barbershops).where(eq(barbershops.id, barbershopId)).limit(1);
  return row ?? null;
}

export async function updateAdminBarbershopSettings(
  executor: DbExecutor,
  params: {
    barbershopId: string;
    name?: string;
    bookingIntervalMinutes?: number;
    customerVerificationMode?: "NONE" | "WHATSAPP_OTP";
    waitlistOfferTtlMinutes?: number;
    reminderOffsetMinutes?: number;
    now: Date;
  },
) {
  const set = { updatedAt: params.now } as Record<string, unknown>;
  if (params.name !== undefined) set.name = params.name;
  if (params.bookingIntervalMinutes !== undefined) set.bookingIntervalMinutes = params.bookingIntervalMinutes;
  if (params.customerVerificationMode !== undefined) set.customerVerificationMode = params.customerVerificationMode;
  if (params.waitlistOfferTtlMinutes !== undefined) set.waitlistOfferTtlMinutes = params.waitlistOfferTtlMinutes;
  if (params.reminderOffsetMinutes !== undefined) set.reminderOffsetMinutes = params.reminderOffsetMinutes;
  const [row] = await executor.update(barbershops).set(set).where(eq(barbershops.id, params.barbershopId)).returning(settingsSelection);
  return row ?? null;
}
