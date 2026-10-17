import { z } from "zod";
import { getCommonEnv } from "@/config/env";
import {
  enforceRequestRateLimit,
  errorResponse,
  hasValidRequestOrigin,
  jsonResponse,
  readCustomerSessionToken,
  validationFields,
} from "@/infrastructure/http";
import { createPublicAppointment } from "@/workflows/public-appointment";

const bodySchema = z
  .object({
    serviceId: z.string().uuid(),
    staffId: z.string().uuid(),
    startsAt: z.string().datetime({ offset: true }),
  })
  .strict();

type RouteContext = { params: Promise<{ slug: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { slug } = await context.params;
  const sessionToken = readCustomerSessionToken(request, slug);
  if (!sessionToken) {
    return errorResponse("CUSTOMER_SESSION_REQUIRED", "Identifique-se para concluir o agendamento.", 401);
  }

  const env = getCommonEnv();
  if (!hasValidRequestOrigin(request, env.APP_ORIGIN)) {
    return errorResponse("INVALID_ORIGIN", "Origem da requisição inválida.", 403);
  }
  const rateLimited = enforceRequestRateLimit(request, "MODERATE");
  if (rateLimited) return rateLimited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("INVALID_REQUEST", "Corpo JSON inválido.", 400);
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("INVALID_REQUEST", "Dados do agendamento inválidos.", 400, validationFields(parsed.error));
  }

  const result = await createPublicAppointment(
    {
      slug,
      sessionToken,
      serviceId: parsed.data.serviceId,
      staffId: parsed.data.staffId,
      startsAt: new Date(parsed.data.startsAt),
    },
    { appOrigin: env.APP_ORIGIN },
  );

  if (result.status === "barbershop-not-found") {
    return errorResponse("BARBERSHOP_NOT_FOUND", "Barbearia não encontrada.", 404);
  }
  if (result.status === "customer-session-invalid") {
    return errorResponse("CUSTOMER_SESSION_REQUIRED", "Sua identificação expirou ou precisa ser validada novamente.", 401);
  }
  if (result.status === "future-appointment-limit") {
    return errorResponse("RATE_LIMITED", "Você atingiu o limite de agendamentos futuros.", 429);
  }
  if (result.status === "service-not-found") {
    return errorResponse("SERVICE_NOT_FOUND", "Serviço não encontrado ou indisponível.", 404);
  }
  if (result.status === "staff-not-found") {
    return errorResponse("STAFF_NOT_FOUND", "Profissional não encontrado ou indisponível.", 404);
  }
  if (result.status === "schedule-conflict") {
    return errorResponse("SCHEDULE_CONFLICT", "O horário escolhido não faz mais parte da agenda disponível.", 409);
  }
  if (result.status === "appointment-conflict") {
    return errorResponse("APPOINTMENT_CONFLICT", "O horário escolhido acabou de ficar indisponível.", 409);
  }

  return jsonResponse(
    {
      appointment: {
        id: result.appointment.id,
        staffId: result.appointment.staffId,
        serviceId: result.appointment.serviceId,
        startsAt: result.appointment.startsAt.toISOString(),
        endsAt: result.appointment.endsAt.toISOString(),
        status: result.appointment.status,
      },
      managementUrl: result.managementUrl,
    },
    { status: 201 },
  );
}
