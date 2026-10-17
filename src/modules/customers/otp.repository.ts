import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { DbExecutor } from "@/infrastructure/db/executor";
import { otpChallenges } from "@/infrastructure/db/schema";

const otpSelection = {
  id: otpChallenges.id,
  barbershopId: otpChallenges.barbershopId,
  phoneE164: otpChallenges.phoneE164,
  codeHash: otpChallenges.codeHash,
  expiresAt: otpChallenges.expiresAt,
  attempts: otpChallenges.attempts,
  consumedAt: otpChallenges.consumedAt,
  invalidatedAt: otpChallenges.invalidatedAt,
  createdAt: otpChallenges.createdAt,
};

export async function lockOtpIssuanceForPhone(
  executor: DbExecutor,
  barbershopId: string,
  phoneE164: string,
) {
  await executor.execute(
    sql`select pg_advisory_xact_lock(hashtext(${barbershopId}), hashtext(${phoneE164}))`,
  );
}

export async function findLatestOtpChallengeByPhone(
  executor: DbExecutor,
  barbershopId: string,
  phoneE164: string,
) {
  const [row] = await executor
    .select(otpSelection)
    .from(otpChallenges)
    .where(and(eq(otpChallenges.barbershopId, barbershopId), eq(otpChallenges.phoneE164, phoneE164)))
    .orderBy(desc(otpChallenges.createdAt), desc(otpChallenges.id))
    .limit(1);

  return row ?? null;
}

export async function findOtpChallengeById(
  executor: DbExecutor,
  barbershopId: string,
  challengeId: string,
) {
  const [row] = await executor
    .select(otpSelection)
    .from(otpChallenges)
    .where(and(eq(otpChallenges.barbershopId, barbershopId), eq(otpChallenges.id, challengeId)))
    .limit(1);

  return row ?? null;
}

export async function lockOtpChallengeById(
  executor: DbExecutor,
  barbershopId: string,
  challengeId: string,
) {
  const [row] = await executor
    .select(otpSelection)
    .from(otpChallenges)
    .where(and(eq(otpChallenges.barbershopId, barbershopId), eq(otpChallenges.id, challengeId)))
    .limit(1)
    .for("update");

  return row ?? null;
}

export async function insertOtpChallenge(
  executor: DbExecutor,
  params: {
    id: string;
    barbershopId: string;
    phoneE164: string;
    codeHash: string;
    expiresAt: Date;
    createdAt: Date;
  },
) {
  const [row] = await executor
    .insert(otpChallenges)
    .values(params)
    .returning(otpSelection);
  return row;
}

export function invalidateOpenOtpChallenges(
  executor: DbExecutor,
  params: { barbershopId: string; phoneE164: string; invalidatedAt: Date },
) {
  return executor
    .update(otpChallenges)
    .set({ invalidatedAt: params.invalidatedAt })
    .where(
      and(
        eq(otpChallenges.barbershopId, params.barbershopId),
        eq(otpChallenges.phoneE164, params.phoneE164),
        isNull(otpChallenges.consumedAt),
        isNull(otpChallenges.invalidatedAt),
      ),
    );
}

export function updateOtpChallengeAttempts(
  executor: DbExecutor,
  params: { barbershopId: string; challengeId: string; attempts: number; invalidatedAt?: Date },
) {
  return executor
    .update(otpChallenges)
    .set({ attempts: params.attempts, invalidatedAt: params.invalidatedAt })
    .where(and(eq(otpChallenges.barbershopId, params.barbershopId), eq(otpChallenges.id, params.challengeId)));
}

export function consumeOtpChallenge(
  executor: DbExecutor,
  params: { barbershopId: string; challengeId: string; consumedAt: Date },
) {
  return executor
    .update(otpChallenges)
    .set({ consumedAt: params.consumedAt })
    .where(and(eq(otpChallenges.barbershopId, params.barbershopId), eq(otpChallenges.id, params.challengeId)));
}

export function invalidateOtpChallenge(
  executor: DbExecutor,
  params: { barbershopId: string; challengeId: string; invalidatedAt: Date },
) {
  return executor
    .update(otpChallenges)
    .set({ invalidatedAt: params.invalidatedAt })
    .where(and(eq(otpChallenges.barbershopId, params.barbershopId), eq(otpChallenges.id, params.challengeId)));
}
