import { enforceRequestRateLimit, errorResponse, jsonResponse } from "@/infrastructure/http";
import { getPublicBarbershopForBooking } from "@/workflows/public-catalog";

type RouteContext = {
  params: Promise<{ slug: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const rateLimited = enforceRequestRateLimit(request, "LOOSE");
  if (rateLimited) return rateLimited;

  const { slug } = await context.params;
  const barbershop = await getPublicBarbershopForBooking(slug);

  if (!barbershop) {
    return errorResponse("BARBERSHOP_NOT_FOUND", "Barbershop not found", 404);
  }

  return jsonResponse({ barbershop });
}
