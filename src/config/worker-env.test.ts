import { afterEach, describe, expect, it, vi } from "vitest";
import { getWorkerEnv } from "./worker-env";

const optionalMessagingFields = [
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_GRAPH_API_VERSION",
  "WHATSAPP_TEMPLATE_APPOINTMENT_CREATED",
  "WHATSAPP_TEMPLATE_APPOINTMENT_RESCHEDULED",
  "WHATSAPP_TEMPLATE_APPOINTMENT_REMINDER",
  "WHATSAPP_TEMPLATE_APPOINTMENT_CANCELLED",
  "WHATSAPP_TEMPLATE_WAITLIST_ENTRY_CREATED",
  "WHATSAPP_TEMPLATE_WAITLIST_OFFER",
  "WHATSAPP_TEMPLATE_CUSTOMER_OTP",
] as const;

function parseWorkerEnv(overrides: Record<string, string | undefined> = {}) {
  vi.stubEnv("DATABASE_URL", "postgresql://app:password@database:5432/app");
  vi.stubEnv("APP_ORIGIN", "https://app.example.test");
  vi.stubEnv("MESSAGING_PROVIDER", "fake");

  for (const field of optionalMessagingFields) vi.stubEnv(field, "");
  for (const [field, value] of Object.entries(overrides)) vi.stubEnv(field, value);

  return getWorkerEnv();
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("worker environment", () => {
  it("accepts empty optional integration values when messaging is fake", () => {
    const config = parseWorkerEnv();

    expect(config.MESSAGING_PROVIDER).toBe("fake");
    for (const field of optionalMessagingFields) {
      expect(config[field]).toBeUndefined();
    }
  });

  it("treats whitespace-only optional values as unset", () => {
    const config = parseWorkerEnv({
      WHATSAPP_ACCESS_TOKEN: "   ",
      WHATSAPP_TEMPLATE_CUSTOMER_OTP: " \t ",
    });

    expect(config.WHATSAPP_ACCESS_TOKEN).toBeUndefined();
    expect(config.WHATSAPP_TEMPLATE_CUSTOMER_OTP).toBeUndefined();
  });

  it("preserves and trims populated optional integration values", () => {
    const config = parseWorkerEnv({
      WHATSAPP_ACCESS_TOKEN: "  example-token  ",
      WHATSAPP_TEMPLATE_CUSTOMER_OTP: "  customer_otp  ",
    });

    expect(config.WHATSAPP_ACCESS_TOKEN).toBe("example-token");
    expect(config.WHATSAPP_TEMPLATE_CUSTOMER_OTP).toBe("customer_otp");
  });

  it("continues to reject invalid required settings", () => {
    expect(() => parseWorkerEnv({ APP_ORIGIN: "invalid-url" })).toThrow();
    expect(() => parseWorkerEnv({ MESSAGING_PROVIDER: "other" })).toThrow();
    expect(() => parseWorkerEnv({ NOTIFICATION_POLL_MS: "0" })).toThrow();
  });
});
