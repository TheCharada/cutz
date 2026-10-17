import { z } from "zod";
import {
  enforceRequestRateLimit,
  errorResponse,
  jsonResponse,
  serializeCustomerSessionCookie,
  validationFields,
} from "@/infrastructure/http";
import { verifyPublicCustomerOtp } from "@/workflows/customer-otp";

const bodySchema = z
  .object({
    challengeId: z.string().uuid(),
    code: z.string().regex(/^\d{6}$/),
  })
  .strict();

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
    return errorResponse("INVALID_REQUEST", "Invalid OTP verification request", 400, validationFields(parsed.error));
  }

  const { slug } = await context.params;
  const result = await verifyPublicCustomerOtp({ slug, ...parsed.data });
  if (result.status === "barbershop-not-found") {
    return errorResponse("BARBERSHOP_NOT_FOUND", "Barbershop not found", 404);
  }
  if (result.status === "verification-not-enabled") {
    return errorResponse("CUSTOMER_VERIFICATION_NOT_ENABLED", "Phone verification is not enabled", 409);
  }
  if (result.status === "not-found") {
    return errorResponse("OTP_NOT_FOUND", "Verification challenge not found", 404);
  }
  if (result.status === "expired") {
    return errorResponse("OTP_EXPIRED", "Verification code expired", 409);
  }
  if (result.status === "already-used" || result.status === "invalidated") {
    return errorResponse("OTP_INVALIDATED", "Verification challenge is no longer valid", 409);
  }
  if (result.status === "invalid-code") {
    return errorResponse("OTP_INVALID", "Invalid verification code", 400, {
      code: [`${result.attemptsRemaining} attempts remaining`],
    });
  }

  const headers = new Headers();
  headers.set(
    "Set-Cookie",
    serializeCustomerSessionCookie(slug, result.session.token, result.session.expiresAt),
  );
  return jsonResponse(
    {
      customer: {
        name: result.session.principal.name,
        phoneE164: result.session.principal.phoneE164,
      },
      verificationLevel: result.session.principal.verificationLevel,
      expiresAt: result.session.expiresAt.toISOString(),
    },
    { status: 200, headers },
  );
}
