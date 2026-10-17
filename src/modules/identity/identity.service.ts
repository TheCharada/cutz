import * as argon2 from "argon2";
import type { DbExecutor } from "@/infrastructure/db/executor";
import { createOpaqueToken, hashOpaqueToken } from "@/shared/tokens";
import {
  deleteUserSession,
  findMembershipBySlug,
  findUserByEmail,
  findUserSession,
  insertUserSession,
  listMembershipsForUser,
} from "./identity.repository";
import type { AdminPrincipal, IssuedUserSession, MembershipRole } from "./types";

const adminSessionTtlMs = 7 * 24 * 60 * 60 * 1000;

export function normalizeAdminEmail(value: string) {
  return value.trim().toLowerCase();
}

async function principalForUser(executor: DbExecutor, user: { id: string; email: string }) {
  const memberships = await listMembershipsForUser(executor, user.id);
  return { user, memberships } satisfies AdminPrincipal;
}

export async function authenticateAdminUser(
  executor: DbExecutor,
  email: string,
  password: string,
) {
  const user = await findUserByEmail(executor, normalizeAdminEmail(email));
  if (!user) return null;
  const valid = await argon2.verify(user.passwordHash, password);
  if (!valid) return null;
  return principalForUser(executor, { id: user.id, email: user.email });
}

export async function issueAdminSession(
  executor: DbExecutor,
  principal: AdminPrincipal,
  now: Date,
): Promise<IssuedUserSession> {
  const token = createOpaqueToken();
  const expiresAt = new Date(now.getTime() + adminSessionTtlMs);
  await insertUserSession(executor, {
    userId: principal.user.id,
    tokenHash: hashOpaqueToken(token),
    expiresAt,
  });
  return { token, expiresAt, principal };
}

export async function resolveAdminPrincipal(
  executor: DbExecutor,
  token: string,
  now: Date,
): Promise<AdminPrincipal | null> {
  const session = await findUserSession(executor, hashOpaqueToken(token), now);
  if (!session) return null;
  return principalForUser(executor, { id: session.userId, email: session.email });
}

export function revokeAdminSession(executor: DbExecutor, token: string) {
  return deleteUserSession(executor, hashOpaqueToken(token));
}

export function getAdminMembership(
  executor: DbExecutor,
  userId: string,
  slug: string,
) {
  return findMembershipBySlug(executor, userId, slug);
}

export function roleAllows(role: MembershipRole, required: MembershipRole) {
  if (required === "STAFF") return role === "STAFF" || role === "OWNER";
  return role === "OWNER";
}
