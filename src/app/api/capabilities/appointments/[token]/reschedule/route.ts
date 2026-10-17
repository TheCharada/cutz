import { z } from "zod";
import { getCommonEnv } from "@/config/env";
import {
  enforceRequestRateLimit,
  errorResponse,
  jsonResponse,
  validationFields,
} from "@/infrastructure/http";
import { rescheduleAppointmentByCapability } from "@/workflows/appointment-capability";

const bodySchema = z
  .object({
    staffId: z.string().uuid(),
    startsAt: z.string().datetime({ offset: true }),
  })
  .strict();

type RouteContext = { params: Promise<{ token: string }> };

export async function POST(request: Request, context: RouteContext) {
  const rateLimited = enforceRequestRateLimit(request, "MODERATE");
  if (rateLimited) return rateLimited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid JSON body", 400);
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", "Invalid reschedule request", 400, validationFields(parsed.error));
  }

  const { token } = await context.params;
  const env = getCommonEnv();
  const result = await rescheduleAppointmentByCapability(
    { token, staffId: parsed.data.staffId, startsAt: new Date(parsed.data.startsAt) },
    { appOrigin: env.APP_ORIGIN },
  );

  if (result.status === "not-found") {
    return errorResponse("NOT_FOUND", "Appointment capability not found", 404);
  }
  if (result.status === "terminal-conflict" || result.status === "appointment-conflict") {
    return errorResponse("APPOINTMENT_CONFLICT", "Requested reschedule is not available", 409);
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
        rescheduledFromId: result.appointment.rescheduledFromId,
      },
      managementUrl: result.managementUrl,
    },
    { status: 201 },
  );
}
