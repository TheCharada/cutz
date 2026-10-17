import { getDb, type Database } from "@/infrastructure/db/client";
import { getAdminBarbershopSettings, patchAdminBarbershopSettings } from "@/modules/barbershops";
import { SystemClock, type Clock } from "@/shared/clock";

const systemClock = new SystemClock();

export function getAdminSettings(
  barbershopId: string,
  options: { database?: Database } = {},
) {
  return getAdminBarbershopSettings(options.database ?? getDb(), barbershopId);
}

export function updateAdminSettings(
  params: {
    barbershopId: string;
    name?: string;
    bookingIntervalMinutes?: number;
    customerVerificationMode?: "NONE" | "WHATSAPP_OTP";
    waitlistOfferTtlMinutes?: number;
    reminderOffsetMinutes?: number;
  },
  options: { database?: Database; clock?: Clock } = {},
) {
  return patchAdminBarbershopSettings(options.database ?? getDb(), {
    ...params,
    now: (options.clock ?? systemClock).now(),
  });
}
