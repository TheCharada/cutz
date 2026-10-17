import { z } from "zod";
import { getDb } from "@/infrastructure/db/client";
import { errorResponse, jsonResponse, validationFields } from "@/infrastructure/http";
import { getStaffServiceIds, getStaffSnapshot } from "@/modules/catalog";
import { replaceStaffServicesForAdmin } from "@/workflows/admin-catalog";
import { adminAccess, adminAccessError, validateAdminMutationOrigin } from "@/app/api/admin/_shared";

const bodySchema = z.object({ serviceIds: z.array(z.string().uuid()).max(100) }).strict();
type RouteContext = { params: Promise<{ slug: string; id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { slug, id } = await context.params;
  const access = await adminAccess(request, slug, "OWNER");
  if (access.status !== "ok") return adminAccessError(access.status);
  const db = getDb();
  const staff = await getStaffSnapshot(db, access.barbershop.id, id);
  if (!staff) return errorResponse("NOT_FOUND", "Profissional não encontrado.", 404);
  const rows = await getStaffServiceIds(db, id);
  return jsonResponse({ serviceIds: rows.map((row) => row.serviceId) });
}

export async function PUT(request: Request, context: RouteContext) {
  const originError = validateAdminMutationOrigin(request);
  if (originError) return originError;
  const { slug, id } = await context.params;
  const access = await adminAccess(request, slug, "OWNER");
  if (access.status !== "ok") return adminAccessError(access.status);
  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("VALIDATION_ERROR", "Dados inválidos.", 400); }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return errorResponse("VALIDATION_ERROR", "Dados inválidos.", 400, validationFields(parsed.error));
  const result = await replaceStaffServicesForAdmin({ barbershopId: access.barbershop.id, staffId: id, serviceIds: parsed.data.serviceIds });
  if (result.status === "not-found") return errorResponse("NOT_FOUND", "Profissional não encontrado.", 404);
  if (result.status !== "ok") return errorResponse("VALIDATION_ERROR", "Há serviços inválidos para esta barbearia.", 400);
  return jsonResponse({ serviceIds: result.serviceIds });
}
