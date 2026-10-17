import { errorResponse, jsonResponse } from "@/infrastructure/http";
import { completeAdminAppointment } from "@/workflows/admin-appointment-completion";
import { adminAccess, adminAccessError, validateAdminMutationOrigin } from "@/app/api/admin/_shared";

type RouteContext = { params: Promise<{ slug: string; id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const originError = validateAdminMutationOrigin(request);
  if (originError) return originError;
  const { slug, id } = await context.params;
  const access = await adminAccess(request, slug);
  if (access.status !== "ok") return adminAccessError(access.status);
  const result = await completeAdminAppointment({
    barbershop: access.barbershop,
    appointmentId: id,
  });
  if (result.status === "not-found") return errorResponse("NOT_FOUND", "Agendamento não encontrado.", 404);
  if (result.status !== "ok") return errorResponse("APPOINTMENT_CONFLICT", "O agendamento não pode ser concluído neste momento.", 409);
  return jsonResponse({ appointment: result.appointment });
}
