import { getCommonEnv } from "@/config/env";
import { enforceRequestRateLimit, errorResponse, jsonResponse } from "@/infrastructure/http";
import { acceptWaitlistOfferByCapability } from "@/workflows/waitlist-capability";

type RouteContext = { params: Promise<{ token: string }> };

export async function POST(request: Request, context: RouteContext) {
  const rateLimited = enforceRequestRateLimit(request, "MODERATE");
  if (rateLimited) return rateLimited;

  const { token } = await context.params;
  const env = getCommonEnv();
  const result = await acceptWaitlistOfferByCapability(token, { appOrigin: env.APP_ORIGIN });
  if (result.status === "not-found") {
    return errorResponse("NOT_FOUND", "Waitlist offer capability not found", 404);
  }
  if (result.status === "offer-expired") {
    return errorResponse("OFFER_EXPIRED", "Waitlist offer has expired", 410);
  }
  if (result.status === "offer-conflict") {
    return errorResponse("OFFER_NOT_AVAILABLE", "Waitlist offer can no longer be accepted", 409);
  }
  if (result.status === "entry-conflict") {
    return errorResponse("WAITLIST_NOT_ACTIVE", "Waitlist entry is no longer active", 409);
  }
  if (result.status === "appointment-conflict") {
    return errorResponse("APPOINTMENT_CONFLICT", "The offered slot can no longer be booked", 409);
  }
  if (result.status === "already-accepted") {
    return jsonResponse({ appointmentId: result.appointmentId, alreadyAccepted: true });
  }

  return jsonResponse(
    {
      appointment: {
        id: result.appointment.id,
        staffId: result.appointment.staffId,
        serviceId: result.appointment.serviceId,
        startsAt: result.appointment.startsAt.toISOString(),
        endsAt: result.appointment.endsAt.toISOString(),
        status: result.appointment.status,
      },
      managementUrl: result.managementUrl,
    },
    { status: 201 },
  );
}
