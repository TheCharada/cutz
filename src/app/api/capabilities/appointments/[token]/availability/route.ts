import { z } from "zod";
import { errorResponse, jsonResponse, validationFields } from "@/infrastructure/http";
import { isValidLocalDate } from "@/shared/time";
import { getRescheduleAvailabilityByCapability } from "@/workflows/appointment-capability";

const querySchema = z
  .object({
    staffId: z.string().uuid(),
    date: z.string().refine(isValidLocalDate, "Invalid local date"),
  })
  .strict();

type RouteContext = {
  params: Promise<{ token: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return errorResponse(
      "VALIDATION_ERROR",
      "Invalid reschedule availability query",
      400,
      validationFields(parsed.error),
    );
  }

  const { token } = await context.params;
  const result = await getRescheduleAvailabilityByCapability({ token, ...parsed.data });

  if (result.status === "not-found") {
    return errorResponse("NOT_FOUND", "Appointment capability not found", 404);
  }
  if (result.status === "terminal-conflict" || result.status === "appointment-conflict") {
    return errorResponse(
      "APPOINTMENT_CONFLICT",
      "Appointment cannot be rescheduled with the requested criteria",
      409,
    );
  }

  return jsonResponse({ slots: result.slots });
}
