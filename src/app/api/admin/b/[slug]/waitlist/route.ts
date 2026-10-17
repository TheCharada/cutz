import { z } from "zod";
import { errorResponse, jsonResponse, validationFields } from "@/infrastructure/http";
import { isValidLocalDate } from "@/shared/time";
import { createAdminWaitlistEntry, listAdminWaitlist } from "@/workflows/admin-waitlist";
import { adminAccess, adminAccessError, validateAdminMutationOrigin } from "../../../_shared";

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário local inválido");
const createSchema = z
  .object({
    customerId: z.string().uuid(),
    serviceId: z.string().uuid(),
    staffId: z.string().uuid().optional(),
    desiredDate: z.string().refine(isValidLocalDate, "Data local inválida"),
    earliestTime: timeSchema,
    latestTime: timeSchema,
  })
  .strict()
  .refine((value) => value.latestTime > value.earliestTime, {
    path: ["latestTime"],
    message: "O horário final deve ser posterior ao inicial",
  });

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { slug } = await context.params;
  const access = await adminAccess(request, slug);
  if (access.status !== "ok") return adminAccessError(access.status);
  return jsonResponse({ items: await listAdminWaitlist(access.barbershop.id) });
}

export async function POST(request: Request, context: RouteContext) {
  const originError = validateAdminMutationOrigin(request);
  if (originError) return originError;

  const { slug } = await context.params;
  const access = await adminAccess(request, slug);
  if (access.status !== "ok") return adminAccessError(access.status);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Dados inválidos.", 400);
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", "Dados inválidos.", 400, validationFields(parsed.error));
  }

  const result = await createAdminWaitlistEntry({ barbershop: access.barbershop, ...parsed.data });
  if (
    result.status === "customer-not-found" ||
    result.status === "service-not-found" ||
    result.status === "staff-not-found"
  ) {
    return errorResponse("NOT_FOUND", "Recurso não encontrado.", 404);
  }
  if (result.status === "invalid-window") {
    return errorResponse("INVALID_WAITLIST_WINDOW", "A janela da lista de espera não é mais válida.", 409);
  }

  return jsonResponse(
    { waitlistEntry: result.entry, managementUrl: result.managementUrl },
    { status: 201 },
  );
}
