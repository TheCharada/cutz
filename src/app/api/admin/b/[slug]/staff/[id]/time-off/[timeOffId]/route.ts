import { errorResponse, jsonResponse } from "@/infrastructure/http";
import { deleteTimeOffForAdmin } from "@/workflows/admin-catalog";
import { adminAccess, adminAccessError, validateAdminMutationOrigin } from "@/app/api/admin/_shared";

type RouteContext = { params: Promise<{ slug: string; id: string; timeOffId: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  const originError = validateAdminMutationOrigin(request);
  if (originError) return originError;
  const { slug, id, timeOffId } = await context.params;
  const access = await adminAccess(request, slug, "OWNER");
  if (access.status !== "ok") return adminAccessError(access.status);
  const result = await deleteTimeOffForAdmin({ barbershopId: access.barbershop.id, staffId: id, timeOffId });
  if (result.status !== "ok") return errorResponse("NOT_FOUND", "Indisponibilidade não encontrada.", 404);
  return jsonResponse({ ok: true });
}
