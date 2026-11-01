import { z } from "zod";
import { errorResponse, jsonResponse, validationFields } from "@/infrastructure/http";
import { getProductForAdmin, updateProductForAdmin } from "@/workflows/admin-products";
import { adminAccess, adminAccessError, validateAdminMutationOrigin } from "@/app/api/admin/_shared";

const schema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  priceCents: z.number().int().nonnegative().max(1_000_000_000).optional(),
  minimumStock: z.number().int().nonnegative().max(1_000_000).optional(),
  active: z.boolean().optional(),
}).strict().refine((obj) => Object.keys(obj).length > 0);
type Context = { params: Promise<{ slug: string; id: string }> };

export async function GET(request: Request, context: Context) {
  const { slug, id } = await context.params;
  const access = await adminAccess(request, slug, "OWNER");
  if (access.status !== "ok") return adminAccessError(access.status);
  if (!z.uuid().safeParse(id).success) return errorResponse("NOT_FOUND", "Produto não encontrado.", 404);
  const product = await getProductForAdmin(access.barbershop.id, id);
  return product ? jsonResponse({ product }) : errorResponse("NOT_FOUND", "Produto não encontrado.", 404);
}

export async function PATCH(request: Request, context: Context) {
  const originError = validateAdminMutationOrigin(request);
  if (originError) return originError;
  const { slug, id } = await context.params;
  const access = await adminAccess(request, slug, "OWNER");
  if (access.status !== "ok") return adminAccessError(access.status);
  if (!z.uuid().safeParse(id).success) return errorResponse("NOT_FOUND", "Produto não encontrado.", 404);
  let body: unknown;
  try { body = await request.json(); }
  catch { return errorResponse("VALIDATION_ERROR", "Dados inválidos.", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorResponse("VALIDATION_ERROR", "Dados inválidos.", 400, validationFields(parsed.error));
  const product = await updateProductForAdmin({ barbershopId: access.barbershop.id, productId: id, ...parsed.data });
  return product ? jsonResponse({ product }) : errorResponse("NOT_FOUND", "Produto não encontrado.", 404);
}
