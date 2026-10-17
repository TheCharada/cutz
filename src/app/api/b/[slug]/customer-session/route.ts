import { z } from "zod";
import { getCommonEnv } from "@/config/env";
import {
  enforceRequestRateLimit,
  errorResponse,
  hasValidRequestOrigin,
  jsonResponse,
  readCustomerSessionToken,
  serializeClearedCustomerSessionCookie,
  serializeCustomerSessionCookie,
  validationFields,
} from "@/infrastructure/http";
import { normalizePhoneE164 } from "@/modules/customers";
import { endPublicCustomerSession, startPublicCustomerSession } from "@/workflows/customer-session";

const bodySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().min(1).max(32),
  })
  .strict();

type RouteContext = { params: Promise<{ slug: string }> };

export async function POST(request: Request, context: RouteContext) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("INVALID_REQUEST", "Corpo JSON inválido.", 400);
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("INVALID_REQUEST", "Informe um nome e telefone válidos.", 400, validationFields(parsed.error));
  }

  let phoneE164: string | undefined;
  try {
    phoneE164 = normalizePhoneE164(
      parsed.data.phone,
      process.env.DEFAULT_PHONE_COUNTRY ?? "BR",
    );
  } catch {
    // The workflow owns the validation response; IP limiting still applies below.
  }
  const rateLimited = enforceRequestRateLimit(request, "MODERATE", { phoneE164 });
  if (rateLimited) return rateLimited;

  const { slug } = await context.params;
  const result = await startPublicCustomerSession({ slug, ...parsed.data });

  if (result.status === "barbershop-not-found") {
    return errorResponse("BARBERSHOP_NOT_FOUND", "Barbearia não encontrada.", 404);
  }
  if (result.status === "invalid-phone") {
    return errorResponse("INVALID_REQUEST", "Informe um telefone válido.", 400, {
      phone: ["Informe um telefone válido."],
    });
  }
  if (result.status === "otp-too-soon") {
    return errorResponse("OTP_RESEND_TOO_SOON", "Aguarde antes de solicitar outro código.", 429, {
      phone: [`Tente novamente em ${Math.ceil(result.retryAfterMs / 1000)} segundos.`],
    });
  }
  if (result.status === "verification-required") {
    return jsonResponse(
      {
        verificationRequired: true,
        challengeId: result.challenge.id,
        expiresAt: result.challenge.expiresAt.toISOString(),
      },
      { status: 202 },
    );
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
    { status: 201, headers },
  );
}

export async function DELETE(request: Request, context: RouteContext) {
  const env = getCommonEnv();
  if (!hasValidRequestOrigin(request, env.APP_ORIGIN)) {
    return errorResponse("INVALID_ORIGIN", "Origem da requisição inválida.", 403);
  }

  const { slug } = await context.params;
  const sessionToken = readCustomerSessionToken(request, slug);
  if (sessionToken) {
    await endPublicCustomerSession({ slug, sessionToken });
  }

  const headers = new Headers();
  headers.set("Set-Cookie", serializeClearedCustomerSessionCookie(slug));
  return jsonResponse({ cleared: true }, { headers });
}
