import { getDb, type Database } from "@/infrastructure/db/client";
import { resolveBarbershopBySlug } from "@/modules/barbershops";
import {
  createOrReuseCustomer,
  createOtpChallenge,
  customerSessionSatisfiesVerificationMode,
  issueUnverifiedCustomerSession,
  normalizePhoneE164,
  resolveCustomerPrincipal,
  revokeCustomerSession,
} from "@/modules/customers";
import { enqueueCustomerOtpNotification } from "@/modules/notifications";
import { SystemClock, type Clock } from "@/shared/clock";

const systemClock = new SystemClock();

function resolveOtpSecret(explicit?: string) {
  const secret = explicit ?? process.env.OTP_SECRET;
  if (!secret || secret.length < 32) throw new Error("OTP_SECRET must contain at least 32 characters");
  return secret;
}

export async function startPublicCustomerSession(
  params: { slug: string; name: string; phone: string },
  options: { database?: Database; clock?: Clock; defaultPhoneCountry?: string; otpSecret?: string } = {},
) {
  const database = options.database ?? getDb();
  const clock = options.clock ?? systemClock;
  let phoneE164: string;

  try {
    phoneE164 = normalizePhoneE164(
      params.phone,
      options.defaultPhoneCountry ?? process.env.DEFAULT_PHONE_COUNTRY ?? "BR",
    );
  } catch {
    return { status: "invalid-phone" as const };
  }

  return database.transaction(async (tx) => {
    const barbershop = await resolveBarbershopBySlug(tx, params.slug);
    if (!barbershop) return { status: "barbershop-not-found" as const };

    const customer = await createOrReuseCustomer(tx, {
      barbershopId: barbershop.id,
      name: params.name.trim(),
      phoneE164,
    });
    const now = clock.now();

    if (barbershop.customerVerificationMode === "WHATSAPP_OTP") {
      const issued = await createOtpChallenge(tx, {
        barbershopId: barbershop.id,
        phoneE164,
        now,
        secret: resolveOtpSecret(options.otpSecret),
      });
      if (issued.status === "too-soon") {
        return {
          status: "otp-too-soon" as const,
          retryAfterMs: issued.retryAfterMs,
        };
      }

      await enqueueCustomerOtpNotification(tx, {
        barbershopId: barbershop.id,
        otpChallengeId: issued.challenge.id,
        phoneE164,
        now,
        payload: {
          type: "CUSTOMER_OTP",
          otpChallengeId: issued.challenge.id,
          code: issued.code,
          expiresAt: issued.challenge.expiresAt.toISOString(),
        },
      });
      return {
        status: "verification-required" as const,
        challenge: {
          id: issued.challenge.id,
          expiresAt: issued.challenge.expiresAt,
        },
        customer: { id: customer.id, name: customer.name, phoneE164: customer.phoneE164 },
      };
    }

    const session = await issueUnverifiedCustomerSession(tx, customer, now);
    return { status: "ok" as const, session };
  });
}

export async function resolvePublicCustomerSession(
  params: { slug: string; sessionToken: string },
  options: { database?: Database; clock?: Clock } = {},
) {
  const database = options.database ?? getDb();
  const now = (options.clock ?? systemClock).now();
  const barbershop = await resolveBarbershopBySlug(database, params.slug);
  if (!barbershop) return { status: "barbershop-not-found" as const };

  const principal = await resolveCustomerPrincipal(database, {
    barbershopId: barbershop.id,
    token: params.sessionToken,
    now,
  });
  if (!principal) return { status: "invalid-session" as const };
  if (!customerSessionSatisfiesVerificationMode(principal, barbershop.customerVerificationMode)) {
    return { status: "verification-required" as const };
  }

  return { status: "ok" as const, principal };
}

export async function endPublicCustomerSession(
  params: { slug: string; sessionToken: string },
  options: { database?: Database } = {},
) {
  const database = options.database ?? getDb();
  const barbershop = await resolveBarbershopBySlug(database, params.slug);
  if (!barbershop) return { status: "barbershop-not-found" as const };

  await revokeCustomerSession(database, {
    barbershopId: barbershop.id,
    token: params.sessionToken,
  });
  return { status: "ok" as const };
}
