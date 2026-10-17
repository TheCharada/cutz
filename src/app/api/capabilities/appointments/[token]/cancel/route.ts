import { z } from "zod";
import {
  enforceRequestRateLimit,
  errorResponse,
  jsonResponse,
  validationFields,
} from "@/infrastructure/http";
import { cancelAppointmentByCapability } from "@/workflows/appointment-capability";
import { serializeAppointmentCapability } from "../../serialize";

const bodySchema = z
  .object({
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

type RouteContext = {
  params: Promise<{ token: string }>;
};

async function readBody(request: Request) {
  const text = await request.text();
  if (!text.trim()) return {};
  return JSON.parse(text) as unknown;
}

export async function POST(request: Request, context: RouteContext) {
  const rateLimited = enforceRequestRateLimit(request, "MODERATE");
  if (rateLimited) return rateLimited;

  let body: unknown;
  try {
    body = await readBody(request);
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid JSON body", 400);
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      "VALIDATION_ERROR",
      "Invalid cancellation request",
      400,
      validationFields(parsed.error),
    );
  }

  const { token } = await context.params;
  const result = await cancelAppointmentByCapability({ token, reason: parsed.data.reason });

  if (result.status === "not-found") {
    return errorResponse("NOT_FOUND", "Appointment capability not found", 404);
  }
  if (result.status === "terminal-conflict") {
    return errorResponse("APPOINTMENT_CONFLICT", "Appointment can no longer be cancelled", 409);
  }

  return jsonResponse({ changed: result.changed, ...serializeAppointmentCapability(result) });
}
