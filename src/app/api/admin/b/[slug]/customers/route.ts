import { errorResponse, jsonResponse } from "@/infrastructure/http";
import { getAdminCustomers } from "@/modules/customers";
import { adminAccess, adminAccessError } from "@/app/api/admin/_shared";

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { slug } = await context.params;
  const access = await adminAccess(request, slug);
  if (access.status !== "ok") return adminAccessError(access.status);
  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "50");
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    return errorResponse("VALIDATION_ERROR", "Paginação inválida.", 400);
  }
  const result = await getAdminCustomers((await import("@/infrastructure/db/client")).getDb(), {
    barbershopId: access.barbershop.id,
    query: url.searchParams.get("q") ?? undefined,
    page,
    pageSize,
  });
  return jsonResponse({ page, pageSize, total: result.total, customers: result.rows });
}
