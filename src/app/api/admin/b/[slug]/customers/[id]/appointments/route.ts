import { getDb } from "@/infrastructure/db/client";
import { errorResponse, jsonResponse } from "@/infrastructure/http";
import { getAdminCustomer } from "@/modules/customers";
import { listCustomerAppointments } from "@/modules/scheduling";
import { adminAccess, adminAccessError } from "@/app/api/admin/_shared";

type RouteContext = { params: Promise<{ slug: string; id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { slug, id } = await context.params;
  const access = await adminAccess(request, slug);
  if (access.status !== "ok") return adminAccessError(access.status);
  const db = getDb();
  const customer = await getAdminCustomer(db, access.barbershop.id, id);
  if (!customer) return errorResponse("NOT_FOUND", "Cliente não encontrado.", 404);
  const appointments = await listCustomerAppointments(db, access.barbershop.id, id);
  return jsonResponse({ customer, appointments, timezone: access.barbershop.timezone });
}
