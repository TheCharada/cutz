import { z } from "zod";
import { errorResponse, jsonResponse, validationFields } from "@/infrastructure/http";
import { isValidLocalDate, localDateForInstant } from "@/shared/time";
import { createAdminAppointment, listAdminAgenda } from "@/workflows/admin-appointments";
import { adminAccess, adminAccessError, validateAdminMutationOrigin } from "@/app/api/admin/_shared";

const createSchema = z
  .object({
    customerId: z.string().uuid(),
    serviceId: z.string().uuid(),
    staffId: z.string().uuid(),
    startsAt: z.string().datetime({ offset: true }),
  })
  .strict();

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { slug } = await context.params;
  const access = await adminAccess(request, slug);
  if (access.status !== "ok") return adminAccessError(access.status);

  const url = new URL(request.url);
  const date =
    url.searchParams.get("date") ??
    localDateForInstant(new Date(), access.barbershop.timezone);
  if (!isValidLocalDate(date)) {
    return errorResponse("VALIDATION_ERROR", "Data inválida.", 400);
  }

  const appointments = await listAdminAgenda({ barbershop: access.barbershop, date });
  return jsonResponse({ date, timezone: access.barbershop.timezone, appointments });
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

  const result = await createAdminAppointment({
    barbershop: access.barbershop,
    customerId: parsed.data.customerId,
    serviceId: parsed.data.serviceId,
    staffId: parsed.data.staffId,
    startsAt: new Date(parsed.data.startsAt),
  });
  if (
    result.status === "customer-not-found" ||
    result.status === "service-not-found" ||
    result.status === "staff-not-found"
  ) {
    return errorResponse("NOT_FOUND", "Recurso não encontrado.", 404);
  }
  if (result.status !== "ok") {
    return errorResponse("APPOINTMENT_CONFLICT", "Este horário não está mais disponível.", 409);
  }
  return jsonResponse(
    { appointment: result.appointment, managementUrl: result.managementUrl },
    { status: 201 },
  );
}
