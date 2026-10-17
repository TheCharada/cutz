import { z } from "zod";
import {
  enforceRequestRateLimit,
  errorResponse,
  jsonResponse,
  validationFields,
} from "@/infrastructure/http";
import { resendPublicCustomerOtp } from "@/workflows/customer-otp";

const bodySchema = z.object({ challengeId: z.string().uuid() }).strict();

type RouteContext = { params: Promise<{ slug: string }> };

export async function POST(request: Request, context: RouteContext) {
  const rateLimited = enforceRequestRateLimit(request, "STRICT");
  if (rateLimited) return rateLimited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("INVALID_REQUEST", "Invalid JSON body", 400);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("INVALID_REQUEST", "Invalid OTP resend request", 400, validationFields(parsed.error));
  }

  const { slug } = await context.params;
  const result = await resendPublicCustomerOtp({ slug, ...parsed.data });
  if (result.status === "barbershop-not-found") {
    return errorResponse("BARBERSHOP_NOT_FOUND", "Barbershop not found", 404);
  }
  if (result.status === "verification-not-enabled") {
    return errorResponse("CUSTOMER_VERIFICATION_NOT_ENABLED", "Phone verification is not enabled", 409);
  }
  if (result.status === "not-found") {
    return errorResponse("OTP_NOT_FOUND", "Verification challenge not found", 404);
  }
  if (result.status === "already-used" || result.status === "invalidated") {
    return errorResponse("OTP_INVALIDATED", "Verification challenge is no longer valid", 409);
  }
  if (result.status === "too-soon") {
    return errorResponse("OTP_RESEND_TOO_SOON", "Wait before requesting another code", 429, {
      challengeId: [`Retry in ${Math.ceil(result.retryAfterMs / 1000)} seconds`],
    });
  }

  return jsonResponse({
    challengeId: result.challenge.id,
    expiresAt: result.challenge.expiresAt.toISOString(),
  });
}
