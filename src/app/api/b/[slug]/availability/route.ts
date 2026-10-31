import { z } from "zod";
import {
  enforceRequestRateLimit,
  errorResponse,
  jsonResponse,
  validationFields,
} from "@/infrastructure/http";
import { isValidLocalDate } from "@/shared/time";
import { getPublicAvailabilityForBarbershop } from "@/workflows/public-catalog";

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário local inválido");

const querySchema = z.object({
  serviceId: z.string().uuid(),
  date: z.string().refine(isValidLocalDate, "Data local inválida"),
  staffId: z.string().uuid().optional(),
  earliestTime: timeSchema.optional(),
  latestTime: timeSchema.optional(),
}).refine(
  ({ earliestTime, latestTime }) =>
    (earliestTime === undefined && latestTime === undefined) ||
    (earliestTime !== undefined && latestTime !== undefined && earliestTime < latestTime),
  { path: ["latestTime"], message: "Informe uma janela de horários válida" },
);

type RouteContext = {
  params: Promise<{ slug: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const rateLimited = enforceRequestRateLimit(request, "LOOSE");
  if (rateLimited) return rateLimited;

  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return errorResponse(
      "INVALID_REQUEST",
      "Consulta de disponibilidade inválida.",
      400,
      validationFields(parsed.error),
    );
  }

  const { slug } = await context.params;
  const result = await getPublicAvailabilityForBarbershop({ slug, ...parsed.data });

  if (result.status === "barbershop-not-found") {
    return errorResponse("BARBERSHOP_NOT_FOUND", "Barbearia não encontrada.", 404);
  }

  if (result.status === "invalid-window") {
    return errorResponse("INVALID_REQUEST", "Janela de horários inválida para a data escolhida.", 400);
  }

  if (result.status === "service-not-found") {
    return errorResponse("SERVICE_NOT_FOUND", "Serviço não encontrado ou indisponível.", 404);
  }

  return jsonResponse({ slots: result.slots });
}
