import { errorResponse, hasValidRequestOrigin, readAdminSessionToken } from "@/infrastructure/http";
import type { MembershipRole } from "@/modules/identity";
import { resolveAdminAccess } from "@/workflows/admin-auth";

export async function adminAccess(request: Request, slug: string, requiredRole: MembershipRole = "STAFF") {
  return resolveAdminAccess({
    sessionToken: readAdminSessionToken(request),
    slug,
    requiredRole,
  });
}

export function adminAccessError(status: "authentication-required" | "not-found" | "forbidden") {
  if (status === "authentication-required") {
    return errorResponse("AUTHENTICATION_REQUIRED", "Autenticação necessária.", 401);
  }
  if (status === "not-found") {
    return errorResponse("NOT_FOUND", "Barbearia não encontrada.", 404);
  }
  return errorResponse("FORBIDDEN", "Acesso não permitido.", 403);
}

export function validateAdminMutationOrigin(request: Request) {
  const appOrigin = process.env.APP_ORIGIN;
  if (!appOrigin) throw new Error("APP_ORIGIN is required for admin mutations");
  return hasValidRequestOrigin(request, appOrigin)
    ? null
    : errorResponse("FORBIDDEN", "Origem da requisição não permitida.", 403);
}
