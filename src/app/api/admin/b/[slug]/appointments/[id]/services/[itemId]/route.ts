import { z } from "zod";
import { errorResponse, jsonResponse, validationFields } from "@/infrastructure/http";
import { voidAdminAppointmentService } from "@/workflows/admin-appointment-services";
import { adminAccess, adminAccessError, validateAdminMutationOrigin } from "@/app/api/admin/_shared";

type RouteContext = { params: Promise<{ slug: string; id: string; itemId: string }> };
const bodySchema = z.object({ reason: z.string().trim().min(3).max(280) }).strict();

export async function DELETE(request: Request, context: RouteContext) {
  const originError = validateAdminMutationOrigin(request);
  if (originError) return originError;

  const { slug, id, itemId } = await context.params;
  const access = await adminAccess(request, slug);
  if (access.status !== "ok") return adminAccessError(access.status);
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(itemId).success) {
    return errorResponse("NOT_FOUND", "Serviço do atendimento não encontrado.", 404);
  }

  let body: unknown;
  try { body = await request.json(); }
  catch { return errorResponse("VALIDATION_ERROR", "Dados inválidos.", 400); }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return errorResponse(
    "VALIDATION_ERROR", "Dados inválidos.", 400, validationFields(parsed.error),
  );

  const result = await voidAdminAppointmentService({
    barbershop: access.barbershop,
    appointmentId: id,
    itemId,
    userId: access.principal.user.id,
    reason: parsed.data.reason,
  });
  if (result.status === "not-found") {
    return errorResponse("NOT_FOUND", "Serviço do atendimento não encontrado.", 404);
  }
  if (result.status === "booked-service" || result.status === "operation-conflict") {
    return errorResponse("APPOINTMENT_CONFLICT", "Este serviço não pode ser anulado.", 409);
  }
  return jsonResponse({ item: result.item });
}
