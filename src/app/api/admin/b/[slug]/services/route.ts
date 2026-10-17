import { z } from "zod";
import { getDb } from "@/infrastructure/db/client";
import { errorResponse, jsonResponse, validationFields } from "@/infrastructure/http";
import { getAdminServices } from "@/modules/catalog";
import { createServiceForAdmin } from "@/workflows/admin-catalog";
import { adminAccess, adminAccessError, validateAdminMutationOrigin } from "@/app/api/admin/_shared";

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  durationMinutes: z.number().int().positive().max(1440),
  priceCents: z.number().int().nonnegative().nullable().optional(),
}).strict();
type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { slug } = await context.params;
  const access = await adminAccess(request, slug, "OWNER");
  if (access.status !== "ok") return adminAccessError(access.status);
  return jsonResponse({ services: await getAdminServices(getDb(), access.barbershop.id) });
}

export async function POST(request: Request, context: RouteContext) {
  const originError = validateAdminMutationOrigin(request);
  if (originError) return originError;
  const { slug } = await context.params;
  const access = await adminAccess(request, slug, "OWNER");
  if (access.status !== "ok") return adminAccessError(access.status);
  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("VALIDATION_ERROR", "Dados inválidos.", 400); }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return errorResponse("VALIDATION_ERROR", "Dados inválidos.", 400, validationFields(parsed.error));
  const service = await createServiceForAdmin({ barbershopId: access.barbershop.id, ...parsed.data });
  return jsonResponse({ service }, { status: 201 });
}
