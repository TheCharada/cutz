import { z } from "zod";
import { errorResponse, jsonResponse, validationFields } from "@/infrastructure/http";
import { cancelAdminAppointment } from "@/workflows/admin-appointments";
import { adminAccess, adminAccessError, validateAdminMutationOrigin } from "@/app/api/admin/_shared";

const bodySchema = z.object({ reason: z.string().trim().min(1).max(500).optional() }).strict();
type RouteContext = { params: Promise<{ slug: string; id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const originError = validateAdminMutationOrigin(request);
  if (originError) return originError;
  const { slug, id } = await context.params;
  const access = await adminAccess(request, slug);
  if (access.status !== "ok") return adminAccessError(access.status);
  let body: unknown = {};
  const text = await request.text();
  if (text.trim()) {
    try { body = JSON.parse(text); } catch { return errorResponse("VALIDATION_ERROR", "Dados inválidos.", 400); }
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return errorResponse("VALIDATION_ERROR", "Dados inválidos.", 400, validationFields(parsed.error));
  const result = await cancelAdminAppointment({ barbershop: access.barbershop, appointmentId: id, reason: parsed.data.reason });
  if (result.status === "not-found") return errorResponse("NOT_FOUND", "Agendamento não encontrado.", 404);
  if (result.status !== "ok") return errorResponse("APPOINTMENT_CONFLICT", "O agendamento não pode mais ser cancelado.", 409);
  return jsonResponse({ changed: result.changed, appointment: result.appointment });
}
