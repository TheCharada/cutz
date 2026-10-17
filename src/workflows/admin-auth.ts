import { getDb, type Database } from "@/infrastructure/db/client";
import { resolveBarbershopById } from "@/modules/barbershops";
import {
  getAdminMembership,
  resolveAdminPrincipal,
  roleAllows,
  type MembershipRole,
} from "@/modules/identity";
import { SystemClock, type Clock } from "@/shared/clock";

const systemClock = new SystemClock();

type AdminAuthOptions = { database?: Database; clock?: Clock };

export async function resolveAdminSession(
  sessionToken: string | null,
  options: AdminAuthOptions = {},
) {
  if (!sessionToken) return null;
  const database = options.database ?? getDb();
  const now = (options.clock ?? systemClock).now();
  return resolveAdminPrincipal(database, sessionToken, now);
}

export async function resolveAdminAccess(
  params: { sessionToken: string | null; slug: string; requiredRole?: MembershipRole },
  options: AdminAuthOptions = {},
) {
  if (!params.sessionToken) return { status: "authentication-required" as const };
  const database = options.database ?? getDb();
  const clock = options.clock ?? systemClock;
  const principal = await resolveAdminSession(params.sessionToken, { database, clock });
  if (!principal) return { status: "authentication-required" as const };

  const membership = await getAdminMembership(database, principal.user.id, params.slug);
  if (!membership) return { status: "not-found" as const };
  if (params.requiredRole && !roleAllows(membership.role, params.requiredRole)) {
    return { status: "forbidden" as const };
  }

  const barbershop = await resolveBarbershopById(database, membership.barbershopId);
  if (!barbershop || barbershop.slug !== params.slug) return { status: "not-found" as const };

  return { status: "ok" as const, principal, membership, barbershop };
}
