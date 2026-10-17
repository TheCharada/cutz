import { errorResponse, jsonResponse, validationFields } from "@/infrastructure/http";
import { getAdminWaitlistAnalytics } from "@/workflows/admin-analytics";
import { adminAccess, adminAccessError } from "../../../../_shared";
import { parseAnalyticsRange } from "../_shared";

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { slug } = await context.params;
  const access = await adminAccess(request, slug, "OWNER");
  if (access.status !== "ok") return adminAccessError(access.status);

  const parsed = parseAnalyticsRange(request);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", "Período inválido.", 400, validationFields(parsed.error));
  }

  return jsonResponse(await getAdminWaitlistAnalytics({ barbershop: access.barbershop, ...parsed.data }));
}
