import { cache } from "react";
import { cookies } from "next/headers";
import { adminSessionCookieName } from "@/infrastructure/http";
import { resolveAdminAccess, resolveAdminSession } from "@/workflows/admin-auth";

type AdminRole = "OWNER" | "STAFF";

async function readServerSessionToken() {
  const store = await cookies();
  return store.get(adminSessionCookieName)?.value ?? null;
}

const cachedAccess = cache(
  (sessionToken: string | null, slug: string, requiredRole: AdminRole) =>
    resolveAdminAccess({ sessionToken, slug, requiredRole }),
);

const cachedSession = cache((sessionToken: string | null) => resolveAdminSession(sessionToken));

export async function resolveServerAdminAccess(slug: string, requiredRole: AdminRole = "STAFF") {
  return cachedAccess(await readServerSessionToken(), slug, requiredRole);
}

export async function resolveServerAdminSession() {
  return cachedSession(await readServerSessionToken());
}
