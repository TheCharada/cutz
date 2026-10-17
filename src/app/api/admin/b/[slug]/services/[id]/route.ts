import { z } from "zod";
import { errorResponse, jsonResponse, validationFields } from "@/infrastructure/http";
import { updateServiceForAdmin } from "@/workflows/admin-catalog";
import { adminAccess, adminAccessError, validateAdminMutationOrigin } from "@/app/api/admin/_shared";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  durationMinutes: z.number().int().positive().max(1440).optional(),
  priceCents: z.number().int().nonnegative().nullable().optional(),
  active: z.boolean().optional(),
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
  const service = await updateServiceForAdmin({ barbershopId: access.barbershop.id, serviceId: id, ...parsed.data });
  if (!service) return errorResponse("NOT_FOUND", "Serviço não encontrado.", 404);
  return jsonResponse({ service });
}
