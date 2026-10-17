import { z } from "zod";
import { getDb } from "@/infrastructure/db/client";
import { errorResponse, jsonResponse, validationFields } from "@/infrastructure/http";
import { getStaffSnapshot, getStaffWorkingHours } from "@/modules/catalog";
import { replaceWorkingHoursForAdmin } from "@/workflows/admin-catalog";
import { adminAccess, adminAccessError, validateAdminMutationOrigin } from "@/app/api/admin/_shared";

const hourSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startsAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endsAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
}).strict();
const bodySchema = z.object({ hours: z.array(hourSchema).max(50) }).strict();
type RouteContext = { params: Promise<{ slug: string; id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { slug, id } = await context.params;
  const access = await adminAccess(request, slug, "OWNER");
  if (access.status !== "ok") return adminAccessError(access.status);
  const db = getDb();
  const staff = await getStaffSnapshot(db, access.barbershop.id, id);
  if (!staff) return errorResponse("NOT_FOUND", "Profissional não encontrado.", 404);
  return jsonResponse({ hours: await getStaffWorkingHours(db, id) });
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
  const result = await replaceWorkingHoursForAdmin({
    barbershopId: access.barbershop.id,
    staffId: id,
    timezone: access.barbershop.timezone,
    hours: parsed.data.hours,
  });
  if (result.status === "not-found") return errorResponse("NOT_FOUND", "Profissional não encontrado.", 404);
  if (result.status === "appointment-conflict") return errorResponse("APPOINTMENT_CONFLICT", "A jornada invalidaria agendamentos futuros.", 409);
  if (result.status !== "ok") return errorResponse("VALIDATION_ERROR", "Jornada inválida.", 400);
  return jsonResponse({ hours: result.hours });
}
