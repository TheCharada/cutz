import { getDb } from "@/infrastructure/db/client";
import { errorResponse, jsonResponse, readAdminSessionToken } from "@/infrastructure/http";
import { resolveAdminPrincipal } from "@/modules/identity";

export async function GET(request: Request) {
  const token = readAdminSessionToken(request);
  if (!token) return errorResponse("AUTHENTICATION_REQUIRED", "Autenticação necessária.", 401);
  const principal = await resolveAdminPrincipal(getDb(), token, new Date());
  if (!principal) return errorResponse("AUTHENTICATION_REQUIRED", "Autenticação necessária.", 401);
  return jsonResponse(principal);
}
