import { enforceRequestRateLimit, errorResponse, jsonResponse } from "@/infrastructure/http";
import { listPublicProductsForBarbershop } from "@/workflows/public-products";

type Context = { params: Promise<{ slug: string }> };

export async function GET(request: Request, context: Context) {
  const rateLimited = enforceRequestRateLimit(request, "LOOSE");
  if (rateLimited) return rateLimited;
  const { slug } = await context.params;
  const products = await listPublicProductsForBarbershop(slug);
  return products
    ? jsonResponse({ products })
    : errorResponse("BARBERSHOP_NOT_FOUND", "Barbearia não encontrada.", 404);
}
