import { getCommonEnv } from "@/config/env";
import { enforceRequestRateLimit, errorResponse, jsonResponse } from "@/infrastructure/http";
import { rejectWaitlistOfferByCapability } from "@/workflows/waitlist-capability";

type RouteContext = { params: Promise<{ token: string }> };

export async function POST(request: Request, context: RouteContext) {
  const rateLimited = enforceRequestRateLimit(request, "MODERATE");
  if (rateLimited) return rateLimited;

  const { token } = await context.params;
  const env = getCommonEnv();
  const result = await rejectWaitlistOfferByCapability(token, { appOrigin: env.APP_ORIGIN });
  if (result.status === "not-found") {
    return errorResponse("NOT_FOUND", "Waitlist offer capability not found", 404);
  }
  if (result.status === "offer-conflict") {
    return errorResponse("OFFER_NOT_AVAILABLE", "Waitlist offer can no longer be rejected", 409);
  }
  if (result.status === "already-rejected") {
    return jsonResponse({
      waitlistOffer: { id: result.offer.id, status: result.offer.status },
      nextOfferCreated: false,
      alreadyRejected: true,
    });
  }

  return jsonResponse({
    waitlistOffer: { id: result.offer.id, status: result.offer.status },
    nextOfferCreated: result.next.status === "offered",
  });
}
