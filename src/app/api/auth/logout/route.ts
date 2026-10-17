import { getDb } from "@/infrastructure/db/client";
import {
  errorResponse,
  hasValidRequestOrigin,
  jsonResponse,
  readAdminSessionToken,
  serializeClearedAdminSessionCookie,
} from "@/infrastructure/http";
import { revokeAdminSession } from "@/modules/identity";

export async function POST(request: Request) {
  const appOrigin = process.env.APP_ORIGIN;
  if (!appOrigin) throw new Error("APP_ORIGIN is required for admin authentication");
  if (!hasValidRequestOrigin(request, appOrigin)) {
    return errorResponse("FORBIDDEN", "Origem da requisição não permitida.", 403);
  }

  const token = readAdminSessionToken(request);
  if (token) await revokeAdminSession(getDb(), token);
  return jsonResponse(
    { ok: true },
    { headers: { "Set-Cookie": serializeClearedAdminSessionCookie() } },
  );
}
