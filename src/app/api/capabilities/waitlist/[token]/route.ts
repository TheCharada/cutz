import { errorResponse, jsonResponse } from "@/infrastructure/http";
import { getWaitlistEntryCapability } from "@/workflows/waitlist-capability";

type RouteContext = { params: Promise<{ token: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { token } = await context.params;
  const result = await getWaitlistEntryCapability(token);
  if (result.status === "not-found") {
    return errorResponse("NOT_FOUND", "Waitlist capability not found", 404);
  }

  return jsonResponse({
    barbershop: { slug: result.barbershop.slug, timezone: result.barbershop.timezone },
    customer: { name: result.customer.name },
    service: {
      id: result.service.id,
      name: result.service.name,
      durationMinutes: result.service.durationMinutes,
    },
    staff: result.staff ? { id: result.staff.id, name: result.staff.name } : null,
    waitlistEntry: {
      id: result.entry.id,
      desiredDate: result.entry.desiredDate,
      earliestTime: result.entry.earliestTime,
      latestTime: result.entry.latestTime,
      status: result.entry.status,
    },
    pendingOffer: result.pendingOffer
      ? {
          id: result.pendingOffer.id,
          startsAt: result.pendingOffer.startsAt.toISOString(),
          endsAt: result.pendingOffer.endsAt.toISOString(),
          expiresAt: result.pendingOffer.expiresAt.toISOString(),
        }
      : null,
  });
}
