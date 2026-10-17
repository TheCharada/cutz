import { getDb, type Database } from "@/infrastructure/db/client";
import { resolveBarbershopBySlug } from "@/modules/barbershops";
import {
  getCustomerByPhone,
  issuePhoneVerifiedCustomerSession,
  resendOtpChallenge,
  verifyOtpChallenge,
} from "@/modules/customers";
import { enqueueCustomerOtpNotification } from "@/modules/notifications";
import { SystemClock, type Clock } from "@/shared/clock";

const systemClock = new SystemClock();

function resolveOtpSecret(explicit?: string) {
  const secret = explicit ?? process.env.OTP_SECRET;
  if (!secret || secret.length < 32) throw new Error("OTP_SECRET must contain at least 32 characters");
  return secret;
}

export async function verifyPublicCustomerOtp(
  params: { slug: string; challengeId: string; code: string },
  options: { database?: Database; clock?: Clock; otpSecret?: string } = {},
) {
  const database = options.database ?? getDb();
  const now = (options.clock ?? systemClock).now();

  return database.transaction(async (tx) => {
    const barbershop = await resolveBarbershopBySlug(tx, params.slug);
    if (!barbershop) return { status: "barbershop-not-found" as const };
    if (barbershop.customerVerificationMode !== "WHATSAPP_OTP") {
      return { status: "verification-not-enabled" as const };
    }

    const verification = await verifyOtpChallenge(tx, {
      barbershopId: barbershop.id,
      challengeId: params.challengeId,
      code: params.code,
      now,
      secret: resolveOtpSecret(options.otpSecret),
    });
    if (verification.status !== "ok") return verification;

    const customer = await getCustomerByPhone(tx, barbershop.id, verification.phoneE164);
    if (!customer) throw new Error("OTP challenge points to a missing customer");
    const session = await issuePhoneVerifiedCustomerSession(tx, customer, now);
    return { status: "ok" as const, session };
  });
}

export async function resendPublicCustomerOtp(
  params: { slug: string; challengeId: string },
  options: { database?: Database; clock?: Clock; otpSecret?: string } = {},
) {
  const database = options.database ?? getDb();
  const now = (options.clock ?? systemClock).now();

  return database.transaction(async (tx) => {
    const barbershop = await resolveBarbershopBySlug(tx, params.slug);
    if (!barbershop) return { status: "barbershop-not-found" as const };
    if (barbershop.customerVerificationMode !== "WHATSAPP_OTP") {
      return { status: "verification-not-enabled" as const };
    }

    const result = await resendOtpChallenge(tx, {
      barbershopId: barbershop.id,
      challengeId: params.challengeId,
      now,
      secret: resolveOtpSecret(options.otpSecret),
    });
    if (result.status !== "ok") return result;

    await enqueueCustomerOtpNotification(tx, {
      barbershopId: barbershop.id,
      otpChallengeId: result.challenge.id,
      phoneE164: result.challenge.phoneE164,
      now,
      payload: {
        type: "CUSTOMER_OTP",
        otpChallengeId: result.challenge.id,
        code: result.code,
        expiresAt: result.challenge.expiresAt.toISOString(),
      },
    });

    return {
      status: "ok" as const,
      challenge: { id: result.challenge.id, expiresAt: result.challenge.expiresAt },
    };
  });
}
