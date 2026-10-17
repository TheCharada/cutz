import { z } from "zod";
import { getDb } from "@/infrastructure/db/client";
import { errorResponse, jsonResponse, validationFields } from "@/infrastructure/http";
import { getStaffTimeOff, getStaffSnapshot } from "@/modules/catalog";
import { createTimeOffForAdmin } from "@/workflows/admin-catalog";
import { adminAccess, adminAccessError, validateAdminMutationOrigin } from "@/app/api/admin/_shared";

const bodySchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(1).max(500).optional(),
}).strict();
type RouteContext = { params: Promise<{ slug: string; id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { slug, id } = await context.params;
  const access = await adminAccess(request, slug, "OWNER");
  if (access.status !== "ok") return adminAccessError(access.status);
  const db = getDb();
  const staff = await getStaffSnapshot(db, access.barbershop.id, id);
  if (!staff) return errorResponse("NOT_FOUND", "Profissional não encontrado.", 404);
  return jsonResponse({ timeOff: await getStaffTimeOff(db, id) });
}

export async function POST(request: Request, context: RouteContext) {
  const originError = validateAdminMutationOrigin(request);
  if (originError) return originError;
  const { slug, id } = await context.params;
  const access = await adminAccess(request, slug, "OWNER");
  if (access.status !== "ok") return adminAccessError(access.status);
  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("VALIDATION_ERROR", "Dados inválidos.", 400); }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return errorResponse("VALIDATION_ERROR", "Dados inválidos.", 400, validationFields(parsed.error));
  const result = await createTimeOffForAdmin({
    barbershopId: access.barbershop.id,
    staffId: id,
    startsAt: new Date(parsed.data.startsAt),
    endsAt: new Date(parsed.data.endsAt),
    reason: parsed.data.reason,
  });
  if (result.status === "not-found") return errorResponse("NOT_FOUND", "Profissional não encontrado.", 404);
  if (result.status === "appointment-conflict") return errorResponse("APPOINTMENT_CONFLICT", "A indisponibilidade conflita com um agendamento.", 409);
  if (result.status !== "ok") return errorResponse("VALIDATION_ERROR", "Intervalo inválido.", 400);
  return jsonResponse({ timeOff: result.timeOff }, { status: 201 });
}
