import { z } from "zod";

const positiveInteger = z.coerce.number().int().positive();
const nonNegativeInteger = z.coerce.number().int().nonnegative();
const booleanEnv = z.enum(["true", "false"]).transform((value) => value === "true").default(false);

const antiAbuseEnvSchema = z.object({
  RATE_LIMIT_TRUSTED_PROXY_HOPS: nonNegativeInteger.default(0),
  RATE_LIMIT_TRUST_X_REAL_IP: booleanEnv,
  RATE_LIMIT_STRICT_MAX: positiveInteger.default(10),
  RATE_LIMIT_STRICT_WINDOW_MS: positiveInteger.default(60_000),
  RATE_LIMIT_MODERATE_MAX: positiveInteger.default(30),
  RATE_LIMIT_MODERATE_WINDOW_MS: positiveInteger.default(60_000),
  RATE_LIMIT_LOOSE_MAX: positiveInteger.default(120),
  RATE_LIMIT_LOOSE_WINDOW_MS: positiveInteger.default(60_000),
  MAX_FUTURE_APPOINTMENTS_PER_CUSTOMER: positiveInteger.default(5),
  MAX_ACTIVE_WAITLIST_ENTRIES_PER_CUSTOMER: positiveInteger.default(5),
});

export type RateLimitClass = "STRICT" | "MODERATE" | "LOOSE";

export function getAntiAbuseEnv() {
  return antiAbuseEnvSchema.parse(process.env);
}

export function getRateLimitPolicy(rateClass: RateLimitClass) {
  const env = getAntiAbuseEnv();
  switch (rateClass) {
    case "STRICT":
      return { max: env.RATE_LIMIT_STRICT_MAX, windowMs: env.RATE_LIMIT_STRICT_WINDOW_MS };
    case "MODERATE":
      return { max: env.RATE_LIMIT_MODERATE_MAX, windowMs: env.RATE_LIMIT_MODERATE_WINDOW_MS };
    case "LOOSE":
      return { max: env.RATE_LIMIT_LOOSE_MAX, windowMs: env.RATE_LIMIT_LOOSE_WINDOW_MS };
  }
}
