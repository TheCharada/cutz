import { describe, expect, it } from "vitest";
import {
  customerSessionSatisfiesVerificationMode,
  PHONE_VERIFIED_CUSTOMER_SESSION_TTL_MS,
  UNVERIFIED_CUSTOMER_SESSION_TTL_MS,
} from "./customer.service";

const unverified = {
  id: "customer",
  barbershopId: "barbershop",
  name: "Cliente",
  phoneE164: "+5514999990001",
  verificationLevel: "UNVERIFIED" as const,
};

const verified = { ...unverified, verificationLevel: "PHONE_VERIFIED" as const };

describe("customer session policy", () => {
  it("remembers NONE-mode customer identity for one year", () => {
    expect(UNVERIFIED_CUSTOMER_SESSION_TTL_MS).toBe(365 * 24 * 60 * 60 * 1000);
    expect(PHONE_VERIFIED_CUSTOMER_SESSION_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("requires phone verification when the tenant enables WHATSAPP_OTP", () => {
    expect(customerSessionSatisfiesVerificationMode(unverified, "NONE")).toBe(true);
    expect(customerSessionSatisfiesVerificationMode(unverified, "WHATSAPP_OTP")).toBe(false);
    expect(customerSessionSatisfiesVerificationMode(verified, "NONE")).toBe(true);
    expect(customerSessionSatisfiesVerificationMode(verified, "WHATSAPP_OTP")).toBe(true);
  });
});
