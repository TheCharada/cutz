import { errorResponse, jsonResponse } from "@/infrastructure/http";
import { getAppointmentCapability } from "@/workflows/appointment-capability";
import { serializeAppointmentCapability } from "../serialize";

type RouteContext = {
  params: Promise<{ token: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { token } = await context.params;
  const result = await getAppointmentCapability(token);

  if (result.status === "not-found") {
    return errorResponse("NOT_FOUND", "Appointment capability not found", 404);
  }

  return jsonResponse(serializeAppointmentCapability(result));
}
