import { z } from "zod";
import { errorResponse, jsonResponse, validationFields } from "@/infrastructure/http";
import { listStockMovementsForAdmin, registerStockForAdmin } from "@/workflows/admin-products";
import { adminAccess, adminAccessError, validateAdminMutationOrigin } from "@/app/api/admin/_shared";

const schema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("IN"), operationId: z.uuid(),
    quantity: z.number().int().positive().max(1_000_000), reason: z.string().trim().min(3).max(280),
  }).strict(),
  z.object({
    kind: z.literal("OUT"), operationId: z.uuid(),
    quantity: z.number().int().positive().max(1_000_000), reason: z.string().trim().min(3).max(280),
  }).strict(),
  z.object({
    kind: z.literal("ADJUSTMENT"), operationId: z.uuid(),
    newQuantity: z.number().int().nonnegative().max(1_000_000),
    reason: z.string().trim().min(3).max(280),
  }).strict(),
]);
type Context = { params: Promise<{ slug: string; id: string }> };

export async function GET(request: Request, context: Context) {
  const { slug, id } = await context.params;
  const access = await adminAccess(request, slug, "OWNER");
  if (access.status !== "ok") return adminAccessError(access.status);
  if (!z.uuid().safeParse(id).success) return errorResponse("NOT_FOUND", "Produto não encontrado.", 404);
  const query = new URL(request.url).searchParams;
  const limit = Number(query.get("limit") ?? 50);
  const offset = Number(query.get("offset") ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 ||
      !Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000)
    return errorResponse("VALIDATION_ERROR", "Paginação inválida.", 400);
  const movements = await listStockMovementsForAdmin({
    barbershopId: access.barbershop.id, productId: id, limit, offset,
  });
  return movements
    ? jsonResponse({ movements, limit, offset })
    : errorResponse("NOT_FOUND", "Produto não encontrado.", 404);
}

export async function POST(request: Request, context: Context) {
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
  const result = await registerStockForAdmin({
    ...parsed.data,
    barbershopId: access.barbershop.id,
    productId: id,
    userId: access.principal.user.id,
  });
  if (result.status === "not-found") return errorResponse("NOT_FOUND", "Produto não encontrado.", 404);
  if (result.status === "operation-conflict") return errorResponse("STOCK_OPERATION_CONFLICT", "Operação já utilizada com dados diferentes.", 409);
  if (result.status === "insufficient-stock") return errorResponse("INSUFFICIENT_STOCK", "Estoque insuficiente.", 409, { availableQuantity: result.availableQuantity });
  return jsonResponse({ movement: result.movement, stockQuantity: result.stockQuantity },
    { status: result.status === "already-recorded" ? 200 : 201 });
}
