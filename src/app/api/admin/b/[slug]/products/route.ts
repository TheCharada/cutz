import { z } from "zod";
import { errorResponse, jsonResponse, validationFields } from "@/infrastructure/http";
import { createProductForAdmin, listProductsForAdmin } from "@/workflows/admin-products";
import { adminAccess, adminAccessError, validateAdminMutationOrigin } from "@/app/api/admin/_shared";

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  priceCents: z.number().int().nonnegative().max(1_000_000_000),
  minimumStock: z.number().int().nonnegative().max(1_000_000).optional(),
}).strict();
type Context = { params: Promise<{ slug: string }> };

export async function GET(request: Request, context: Context) {
  const { slug } = await context.params;
  const access = await adminAccess(request, slug, "OWNER");
  if (access.status !== "ok") return adminAccessError(access.status);
  return jsonResponse({ products: await listProductsForAdmin(access.barbershop.id) });
}

export async function POST(request: Request, context: Context) {
  const originError = validateAdminMutationOrigin(request);
  if (originError) return originError;
  const { slug } = await context.params;
  const access = await adminAccess(request, slug, "OWNER");
  if (access.status !== "ok") return adminAccessError(access.status);
  let body: unknown;
  try { body = await request.json(); }
  catch { return errorResponse("VALIDATION_ERROR", "Dados inválidos.", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorResponse("VALIDATION_ERROR", "Dados inválidos.", 400, validationFields(parsed.error));
  const product = await createProductForAdmin({ barbershopId: access.barbershop.id, ...parsed.data });
  return jsonResponse({ product }, { status: 201 });
}
