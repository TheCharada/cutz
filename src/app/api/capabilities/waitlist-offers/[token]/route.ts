import { errorResponse, jsonResponse } from "@/infrastructure/http";
import { getWaitlistOfferCapability } from "@/workflows/waitlist-capability";

type RouteContext = { params: Promise<{ token: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { token } = await context.params;
  const result = await getWaitlistOfferCapability(token);
  if (result.status === "not-found") {
    return errorResponse("NOT_FOUND", "Waitlist offer capability not found", 404);
  }

  return jsonResponse({
    barbershop: { slug: result.barbershop.slug, timezone: result.barbershop.timezone },
    customer: { name: result.customer.name },
    service: {
      id: result.service.id,
      name: result.service.name,
      durationMinutes: result.service.durationMinutes,
    },
    staff: { id: result.staff.id, name: result.staff.name },
    waitlistOffer: {
      id: result.offer.id,
      startsAt: result.offer.startsAt.toISOString(),
      endsAt: result.offer.endsAt.toISOString(),
      status: result.offer.status,
      expiresAt: result.offer.expiresAt.toISOString(),
      appointmentId: result.offer.appointmentId,
    },
    waitlistEntry: { id: result.entry.id, status: result.entry.status },
  });
}
