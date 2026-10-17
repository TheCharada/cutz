import { enforceRequestRateLimit, errorResponse, jsonResponse } from "@/infrastructure/http";
import { listPublicStaffForBarbershop } from "@/workflows/public-catalog";

type RouteContext = {
  params: Promise<{ slug: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const rateLimited = enforceRequestRateLimit(request, "LOOSE");
  if (rateLimited) return rateLimited;

  const { slug } = await context.params;
  const staff = await listPublicStaffForBarbershop(slug);

  if (!staff) {
    return errorResponse("BARBERSHOP_NOT_FOUND", "Barbershop not found", 404);
  }

  return jsonResponse({ staff });
}
