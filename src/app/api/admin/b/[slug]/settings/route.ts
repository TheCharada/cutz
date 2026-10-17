import { z } from "zod";
import { errorResponse, jsonResponse, validationFields } from "@/infrastructure/http";
import { getAdminSettings, updateAdminSettings } from "@/workflows/admin-settings";
import { adminAccess, adminAccessError, validateAdminMutationOrigin } from "../../../_shared";

const patchSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    bookingIntervalMinutes: z.number().int().positive().optional(),
    customerVerificationMode: z.enum(["NONE", "WHATSAPP_OTP"]).optional(),
    waitlistOfferTtlMinutes: z.number().int().positive().optional(),
    reminderOffsetMinutes: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "Informe ao menos uma configuração." });

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { slug } = await context.params;
  const access = await adminAccess(request, slug, "OWNER");
  if (access.status !== "ok") return adminAccessError(access.status);

  const settings = await getAdminSettings(access.barbershop.id);
  if (!settings) return errorResponse("NOT_FOUND", "Barbearia não encontrada.", 404);
  return jsonResponse({ settings });
}

export async function PATCH(request: Request, context: RouteContext) {
  const originError = validateAdminMutationOrigin(request);
  if (originError) return originError;

  const { slug } = await context.params;
  const access = await adminAccess(request, slug, "OWNER");
  if (access.status !== "ok") return adminAccessError(access.status);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Dados inválidos.", 400);
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", "Dados inválidos.", 400, validationFields(parsed.error));
  }

  const settings = await updateAdminSettings({ barbershopId: access.barbershop.id, ...parsed.data });
  if (!settings) return errorResponse("NOT_FOUND", "Barbearia não encontrada.", 404);
  return jsonResponse({ settings });
}
