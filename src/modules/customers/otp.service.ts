import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { DbExecutor } from "@/infrastructure/db/executor";
import {
  consumeOtpChallenge,
  findLatestOtpChallengeByPhone,
  findOtpChallengeById,
  insertOtpChallenge,
  invalidateOpenOtpChallenges,
  invalidateOtpChallenge,
  lockOtpChallengeById,
  lockOtpIssuanceForPhone,
  updateOtpChallengeAttempts,
} from "./otp.repository";

export const OTP_TTL_MS = 10 * 60_000;
export const OTP_RESEND_INTERVAL_MS = 60_000;
export const OTP_MAX_ATTEMPTS = 5;

function hashOtp(secret: string, challengeId: string, code: string) {
  return createHmac("sha256", secret).update(`${challengeId}:${code}`).digest("hex");
}

function matchesOtp(actualHash: string, expectedHash: string) {
  const actual = Buffer.from(actualHash, "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function getOtpChallengeById(
  executor: DbExecutor,
  barbershopId: string,
  challengeId: string,
) {
  return findOtpChallengeById(executor, barbershopId, challengeId);
}

async function createOtpChallengeAfterPhoneLock(
  executor: DbExecutor,
  params: {
    barbershopId: string;
    phoneE164: string;
    now: Date;
    secret: string;
    invalidateExisting?: boolean;
  },
) {
  const latest = await findLatestOtpChallengeByPhone(
    executor,
    params.barbershopId,
    params.phoneE164,
  );
  if (latest) {
    const nextIssueAt = latest.createdAt.getTime() + OTP_RESEND_INTERVAL_MS;
    if (params.now.getTime() < nextIssueAt) {
      return {
        status: "too-soon" as const,
        retryAfterMs: nextIssueAt - params.now.getTime(),
      };
    }
  }

  if (params.invalidateExisting !== false) {
    await invalidateOpenOtpChallenges(executor, {
      barbershopId: params.barbershopId,
      phoneE164: params.phoneE164,
      invalidatedAt: params.now,
    });
  }

  const id = randomUUID();
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const expiresAt = new Date(params.now.getTime() + OTP_TTL_MS);
  const challenge = await insertOtpChallenge(executor, {
    id,
    barbershopId: params.barbershopId,
    phoneE164: params.phoneE164,
    codeHash: hashOtp(params.secret, id, code),
    expiresAt,
    createdAt: params.now,
  });

  return { status: "ok" as const, challenge, code };
}

export async function createOtpChallenge(
  executor: DbExecutor,
  params: {
    barbershopId: string;
    phoneE164: string;
    now: Date;
    secret: string;
  },
) {
  await lockOtpIssuanceForPhone(executor, params.barbershopId, params.phoneE164);
  return createOtpChallengeAfterPhoneLock(executor, params);
}

export async function verifyOtpChallenge(
  executor: DbExecutor,
  params: { barbershopId: string; challengeId: string; code: string; now: Date; secret: string },
) {
  const challenge = await lockOtpChallengeById(executor, params.barbershopId, params.challengeId);
  if (!challenge) return { status: "not-found" as const };
  if (challenge.consumedAt) return { status: "already-used" as const };
  if (challenge.invalidatedAt) return { status: "invalidated" as const };
  if (challenge.expiresAt <= params.now) {
    await invalidateOtpChallenge(executor, {
      barbershopId: params.barbershopId,
      challengeId: params.challengeId,
      invalidatedAt: params.now,
    });
    return { status: "expired" as const };
  }
  if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
    await invalidateOtpChallenge(executor, {
      barbershopId: params.barbershopId,
      challengeId: params.challengeId,
      invalidatedAt: params.now,
    });
    return { status: "invalidated" as const };
  }

  const expectedHash = hashOtp(params.secret, challenge.id, params.code);
  if (!matchesOtp(challenge.codeHash, expectedHash)) {
    const attempts = challenge.attempts + 1;
    const invalidatedAt = attempts >= OTP_MAX_ATTEMPTS ? params.now : undefined;
    await updateOtpChallengeAttempts(executor, {
      barbershopId: params.barbershopId,
      challengeId: params.challengeId,
      attempts,
      invalidatedAt,
    });
    return {
      status: "invalid-code" as const,
      attemptsRemaining: Math.max(0, OTP_MAX_ATTEMPTS - attempts),
    };
  }

  await consumeOtpChallenge(executor, {
    barbershopId: params.barbershopId,
    challengeId: params.challengeId,
    consumedAt: params.now,
  });
  return { status: "ok" as const, phoneE164: challenge.phoneE164 };
}

export async function resendOtpChallenge(
  executor: DbExecutor,
  params: { barbershopId: string; challengeId: string; now: Date; secret: string },
) {
  const existing = await findOtpChallengeById(executor, params.barbershopId, params.challengeId);
  if (!existing) return { status: "not-found" as const };

  await lockOtpIssuanceForPhone(executor, params.barbershopId, existing.phoneE164);
  const challenge = await lockOtpChallengeById(executor, params.barbershopId, params.challengeId);
  if (!challenge) return { status: "not-found" as const };
  if (challenge.consumedAt) return { status: "already-used" as const };
  if (challenge.invalidatedAt) return { status: "invalidated" as const };

  const resendAt = new Date(challenge.createdAt.getTime() + OTP_RESEND_INTERVAL_MS);
  if (params.now < resendAt) {
    return { status: "too-soon" as const, retryAfterMs: resendAt.getTime() - params.now.getTime() };
  }

  await invalidateOtpChallenge(executor, {
    barbershopId: params.barbershopId,
    challengeId: params.challengeId,
    invalidatedAt: params.now,
  });

  const next = await createOtpChallengeAfterPhoneLock(executor, {
    barbershopId: params.barbershopId,
    phoneE164: challenge.phoneE164,
    now: params.now,
    secret: params.secret,
    invalidateExisting: false,
  });
  if (next.status !== "ok") return next;
  return { status: "ok" as const, challenge: next.challenge, code: next.code };
}
