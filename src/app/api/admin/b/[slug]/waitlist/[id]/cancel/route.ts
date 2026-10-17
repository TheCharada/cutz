import { z } from "zod";
import { errorResponse, jsonResponse } from "@/infrastructure/http";
import { cancelAdminWaitlistEntry } from "@/workflows/admin-waitlist";
import { adminAccess, adminAccessError, validateAdminMutationOrigin } from "../../../../../_shared";

type RouteContext = { params: Promise<{ slug: string; id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const originError = validateAdminMutationOrigin(request);
  if (originError) return originError;

  const { slug, id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return errorResponse("NOT_FOUND", "Entrada da lista de espera não encontrada.", 404);
  }

  const access = await adminAccess(request, slug);
  if (access.status !== "ok") return adminAccessError(access.status);

  const result = await cancelAdminWaitlistEntry({ barbershop: access.barbershop, entryId: id });
  if (result.status === "not-found") {
    return errorResponse("NOT_FOUND", "Entrada da lista de espera não encontrada.", 404);
  }
  if (result.status !== "ok") {
    return errorResponse("WAITLIST_CONFLICT", "A entrada não pode mais ser cancelada.", 409);
  }

  return jsonResponse({ waitlistEntry: result.entry, changed: result.changed });
}
