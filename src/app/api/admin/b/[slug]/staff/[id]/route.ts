import { z } from "zod";
import { errorResponse, jsonResponse, validationFields } from "@/infrastructure/http";
import { updateStaffForAdmin } from "@/workflows/admin-catalog";
import { adminAccess, adminAccessError, validateAdminMutationOrigin } from "@/app/api/admin/_shared";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  userId: z.string().uuid().nullable().optional(),
  active: z.boolean().optional(),
  acceptsAppointments: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0);
type RouteContext = { params: Promise<{ slug: string; id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const originError = validateAdminMutationOrigin(request);
  if (originError) return originError;
  const { slug, id } = await context.params;
  const access = await adminAccess(request, slug, "OWNER");
  if (access.status !== "ok") return adminAccessError(access.status);
  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("VALIDATION_ERROR", "Dados inválidos.", 400); }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return errorResponse("VALIDATION_ERROR", "Dados inválidos.", 400, validationFields(parsed.error));
  const staff = await updateStaffForAdmin({ barbershopId: access.barbershop.id, staffId: id, ...parsed.data });
  if (!staff) return errorResponse("NOT_FOUND", "Profissional não encontrado.", 404);
  return jsonResponse({ staff });
}
