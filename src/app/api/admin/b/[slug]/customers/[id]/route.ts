import { getDb } from "@/infrastructure/db/client";
import { errorResponse, jsonResponse } from "@/infrastructure/http";
import { getAdminCustomer } from "@/modules/customers";
import { adminAccess, adminAccessError } from "@/app/api/admin/_shared";

type RouteContext = { params: Promise<{ slug: string; id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { slug, id } = await context.params;
  const access = await adminAccess(request, slug);
  if (access.status !== "ok") return adminAccessError(access.status);
  const customer = await getAdminCustomer(getDb(), access.barbershop.id, id);
  if (!customer) return errorResponse("NOT_FOUND", "Cliente não encontrado.", 404);
  return jsonResponse({ customer });
}
