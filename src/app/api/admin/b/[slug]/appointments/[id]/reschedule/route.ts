import { z } from "zod";
import { errorResponse, jsonResponse, validationFields } from "@/infrastructure/http";
import { rescheduleAdminAppointment } from "@/workflows/admin-appointments";
import { adminAccess, adminAccessError, validateAdminMutationOrigin } from "@/app/api/admin/_shared";

const bodySchema = z.object({
  staffId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
}).strict();
type RouteContext = { params: Promise<{ slug: string; id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const originError = validateAdminMutationOrigin(request);
  if (originError) return originError;
  const { slug, id } = await context.params;
  const access = await adminAccess(request, slug);
  if (access.status !== "ok") return adminAccessError(access.status);
  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("VALIDATION_ERROR", "Dados inválidos.", 400); }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return errorResponse("VALIDATION_ERROR", "Dados inválidos.", 400, validationFields(parsed.error));
  const result = await rescheduleAdminAppointment({
    barbershop: access.barbershop,
    appointmentId: id,
    staffId: parsed.data.staffId,
    startsAt: new Date(parsed.data.startsAt),
  });
  if (result.status === "not-found") return errorResponse("NOT_FOUND", "Agendamento não encontrado.", 404);
  if (result.status !== "ok") return errorResponse("APPOINTMENT_CONFLICT", "O novo horário não está disponível.", 409);
  return jsonResponse({ appointment: result.appointment, managementUrl: result.managementUrl }, { status: 201 });
}
