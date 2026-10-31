import { z } from "zod";
import { errorResponse, jsonResponse, validationFields } from "@/infrastructure/http";
import {
  getAdminAppointmentServices,
  recordAdminAppointmentService,
} from "@/workflows/admin-appointment-services";
import { adminAccess, adminAccessError, validateAdminMutationOrigin } from "@/app/api/admin/_shared";

type RouteContext = { params: Promise<{ slug: string; id: string }> };

const requestSchema = z.object({
  serviceId: z.string().uuid(),
  unitPriceCents: z.number().int().nonnegative().max(1_000_000_000).nullable(),
  performedAt: z.iso.datetime({ offset: true }).nullable().optional(),
  priceAdjustmentReason: z.string().trim().min(3).max(280).nullable().optional(),
  operationId: z.string().uuid(),
}).strict();

export async function GET(request: Request, context: RouteContext) {
  const { slug, id } = await context.params;
  const access = await adminAccess(request, slug);
  if (access.status !== "ok") return adminAccessError(access.status);
  if (!z.uuid().safeParse(id).success) return errorResponse("NOT_FOUND", "Atendimento não encontrado.", 404);

  const result = await getAdminAppointmentServices({
    barbershop: access.barbershop,
    appointmentId: id,
  });
  if (result.status === "not-found") {
    return errorResponse("NOT_FOUND", "Atendimento não encontrado.", 404);
  }
  return jsonResponse(result);
}

export async function POST(request: Request, context: RouteContext) {
  const originError = validateAdminMutationOrigin(request);
  if (originError) return originError;
  const { slug, id } = await context.params;
  const access = await adminAccess(request, slug);
  if (access.status !== "ok") return adminAccessError(access.status);
  if (!z.uuid().safeParse(id).success) return errorResponse("NOT_FOUND", "Atendimento não encontrado.", 404);

  let body: unknown;
  try { body = await request.json(); }
  catch { return errorResponse("VALIDATION_ERROR", "Dados inválidos.", 400); }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return errorResponse(
    "VALIDATION_ERROR", "Dados inválidos.", 400, validationFields(parsed.error),
  );

  const result = await recordAdminAppointmentService({
    barbershop: access.barbershop,
    appointmentId: id,
    serviceId: parsed.data.serviceId,
    unitPriceCents: parsed.data.unitPriceCents,
    performedAt: parsed.data.performedAt ? new Date(parsed.data.performedAt) : null,
    priceAdjustmentReason: parsed.data.priceAdjustmentReason ?? null,
    operationId: parsed.data.operationId,
    userId: access.principal.user.id,
  });

  if (result.status === "not-found" || result.status === "service-not-found") {
    return errorResponse("NOT_FOUND", "Atendimento ou serviço não encontrado.", 404);
  }
  if (result.status === "invalid-performed-at" || result.status === "price-reason-required") {
    return errorResponse("VALIDATION_ERROR", result.status === "invalid-performed-at"
      ? "A realização do serviço não pode ter uma data futura."
      : "Informe um motivo para o preço diferente do catálogo.", 400);
  }
  if (result.status === "appointment-conflict" || result.status === "operation-conflict") {
    return errorResponse("APPOINTMENT_CONFLICT", "O serviço não pode ser registrado neste atendimento.", 409);
  }
  return jsonResponse({ item: result.item }, { status: result.status === "already-recorded" ? 200 : 201 });
}
