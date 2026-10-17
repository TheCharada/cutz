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
import { isValidLocalDate } from "@/shared/time";
import { createPublicWaitlistEntry } from "@/workflows/public-waitlist";

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário local inválido");
const bodySchema = z
  .object({
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

export async function POST(request: Request, context: RouteContext) {
  const { slug } = await context.params;
  const sessionToken = readCustomerSessionToken(request, slug);
  if (!sessionToken) {
    return errorResponse("CUSTOMER_SESSION_REQUIRED", "Identifique-se para entrar na lista de espera.", 401);
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
    return errorResponse("INVALID_REQUEST", "Dados da lista de espera inválidos.", 400, validationFields(parsed.error));
  }

  const result = await createPublicWaitlistEntry(
    { slug, sessionToken, ...parsed.data },
    { appOrigin: env.APP_ORIGIN },
  );
  if (result.status === "barbershop-not-found") {
    return errorResponse("BARBERSHOP_NOT_FOUND", "Barbearia não encontrada.", 404);
  }
  if (result.status === "customer-session-invalid") {
    return errorResponse("CUSTOMER_SESSION_REQUIRED", "Sua identificação expirou ou precisa ser validada novamente.", 401);
  }
  if (result.status === "active-waitlist-limit") {
    return errorResponse("RATE_LIMITED", "Você atingiu o limite de entradas ativas na lista de espera.", 429);
  }
  if (result.status === "service-not-found") {
    return errorResponse("SERVICE_NOT_FOUND", "Serviço não encontrado ou indisponível.", 404);
  }
  if (result.status === "staff-not-found") {
    return errorResponse("STAFF_NOT_FOUND", "Profissional não encontrado ou incompatível com o serviço.", 404);
  }
  if (result.status === "invalid-window") {
    return errorResponse("INVALID_WAITLIST_WINDOW", "A janela informada não é mais válida.", 409);
  }

  return jsonResponse(
    {
      waitlistEntry: {
        id: result.entry.id,
        serviceId: result.entry.serviceId,
        staffId: result.entry.staffId,
        desiredDate: result.entry.desiredDate,
        earliestTime: result.entry.earliestTime,
        latestTime: result.entry.latestTime,
        status: result.entry.status,
      },
      managementUrl: result.managementUrl,
    },
    { status: 201 },
  );
}
