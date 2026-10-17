import { z } from "zod";
import { getDb } from "@/infrastructure/db/client";
import {
  enforceRequestRateLimit,
  errorResponse,
  hasValidRequestOrigin,
  jsonResponse,
  serializeAdminSessionCookie,
  validationFields,
} from "@/infrastructure/http";
import { authenticateAdminUser, issueAdminSession } from "@/modules/identity";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
}).strict();

export async function POST(request: Request) {
  const appOrigin = process.env.APP_ORIGIN;
  if (!appOrigin) throw new Error("APP_ORIGIN is required for admin authentication");
  if (!hasValidRequestOrigin(request, appOrigin)) {
    return errorResponse("FORBIDDEN", "Origem da requisição não permitida.", 403);
  }
  const rateLimited = enforceRequestRateLimit(request, "STRICT");
  if (rateLimited) return rateLimited;

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Dados inválidos.", 400);
  }
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", "Dados inválidos.", 400, validationFields(parsed.error));
  }

  const db = getDb();
  const principal = await authenticateAdminUser(db, parsed.data.email, parsed.data.password);
  if (!principal) {
    return errorResponse("INVALID_CREDENTIALS", "E-mail ou senha inválidos.", 401);
  }

  const issued = await issueAdminSession(db, principal, new Date());
  return jsonResponse(
    { user: issued.principal.user, memberships: issued.principal.memberships },
    { headers: { "Set-Cookie": serializeAdminSessionCookie(issued.token, issued.expiresAt) } },
  );
}
