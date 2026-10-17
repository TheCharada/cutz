export type BarbershopContext = {
  id: string;
  slug: string;
  timezone: string;
  bookingIntervalMinutes: number;
  customerVerificationMode: "NONE" | "WHATSAPP_OTP";
  waitlistOfferTtlMinutes: number;
  reminderOffsetMinutes: number;
};
