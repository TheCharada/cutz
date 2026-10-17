import { getCommonEnv } from "@/config/env";
import { enforceRequestRateLimit, errorResponse, jsonResponse } from "@/infrastructure/http";
import { cancelWaitlistEntryByCapability } from "@/workflows/waitlist-capability";

type RouteContext = { params: Promise<{ token: string }> };

export async function POST(request: Request, context: RouteContext) {
  const rateLimited = enforceRequestRateLimit(request, "MODERATE");
  if (rateLimited) return rateLimited;

  const { token } = await context.params;
  const env = getCommonEnv();
  const result = await cancelWaitlistEntryByCapability(token, { appOrigin: env.APP_ORIGIN });
  if (result.status === "not-found") {
    return errorResponse("NOT_FOUND", "Waitlist capability not found", 404);
  }
  if (result.status === "entry-conflict") {
    return errorResponse("WAITLIST_NOT_ACTIVE", "Waitlist entry can no longer be cancelled", 409);
  }

  return jsonResponse({
    changed: result.changed,
    waitlistEntry: { id: result.entry.id, status: result.entry.status },
  });
}
