import { and, eq, gt } from "drizzle-orm";
import type { DbExecutor } from "@/infrastructure/db/executor";
import { barbershopMemberships, barbershops, users, userSessions } from "@/infrastructure/db/schema";

export async function findUserByEmail(executor: DbExecutor, email: string) {
  const [row] = await executor
    .select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return row ?? null;
}

export function listMembershipsForUser(executor: DbExecutor, userId: string) {
  return executor
    .select({
      barbershopId: barbershopMemberships.barbershopId,
      slug: barbershops.slug,
      name: barbershops.name,
      role: barbershopMemberships.role,
    })
    .from(barbershopMemberships)
    .innerJoin(barbershops, eq(barbershops.id, barbershopMemberships.barbershopId))
    .where(eq(barbershopMemberships.userId, userId));
}

export async function findMembershipBySlug(
  executor: DbExecutor,
  userId: string,
  slug: string,
) {
  const [row] = await executor
    .select({
      barbershopId: barbershopMemberships.barbershopId,
      slug: barbershops.slug,
      name: barbershops.name,
      role: barbershopMemberships.role,
    })
    .from(barbershopMemberships)
    .innerJoin(barbershops, eq(barbershops.id, barbershopMemberships.barbershopId))
    .where(and(eq(barbershopMemberships.userId, userId), eq(barbershops.slug, slug)))
    .limit(1);
  return row ?? null;
}

export async function insertUserSession(
  executor: DbExecutor,
  params: { userId: string; tokenHash: string; expiresAt: Date },
) {
  const [row] = await executor.insert(userSessions).values(params).returning({
    id: userSessions.id,
    userId: userSessions.userId,
    expiresAt: userSessions.expiresAt,
  });
  return row;
}

export async function findUserSession(
  executor: DbExecutor,
  tokenHash: string,
  now: Date,
) {
  const [row] = await executor
    .select({
      sessionId: userSessions.id,
      userId: users.id,
      email: users.email,
      expiresAt: userSessions.expiresAt,
    })
    .from(userSessions)
    .innerJoin(users, eq(users.id, userSessions.userId))
    .where(and(eq(userSessions.tokenHash, tokenHash), gt(userSessions.expiresAt, now)))
    .limit(1);
  return row ?? null;
}

export function deleteUserSession(executor: DbExecutor, tokenHash: string) {
  return executor.delete(userSessions).where(eq(userSessions.tokenHash, tokenHash));
}
