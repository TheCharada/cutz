import { getCommonEnv } from "@/config/env";
import { enforceRequestRateLimit, errorResponse, hasValidRequestOrigin, jsonResponse } from "@/infrastructure/http";
import { issueTelegramLink } from "@/workflows/telegram-link";

export async function issueTelegramLinkFromCapability(
  request: Request,
  token: string,
  scope: "appointment" | "waitlist",
) {
  const origin = getCommonEnv().APP_ORIGIN;
  if (!hasValidRequestOrigin(request, origin)) {
    return errorResponse("FORBIDDEN", "Invalid request origin", 403);
  }
  const rateLimited = enforceRequestRateLimit(request, "STRICT");
  if (rateLimited) return rateLimited;

  const result = await issueTelegramLink({ scope, capabilityToken: token });
  if (result.status === "unavailable") {
    return errorResponse("UNAVAILABLE", "Telegram linking is not configured", 503);
  }
  if (result.status === "not-found") {
    return errorResponse("NOT_FOUND", "Capability not found", 404);
  }
  if (result.status === "not-active") {
    return errorResponse("CONFLICT", "Capability is not active", 409);
  }
  return jsonResponse(
    { url: result.url, expiresAt: result.expiresAt },
    { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } },
  );
}
