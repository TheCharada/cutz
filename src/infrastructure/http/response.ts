import type { ZodError } from "zod";

export function jsonResponse(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");

  return Response.json(body, { ...init, headers });
}

export function errorResponse(
  code: string,
  message: string,
  status: number,
  fields?: unknown,
) {
  return jsonResponse(
    {
      error: {
        code,
        message,
        ...(fields === undefined ? {} : { fields }),
      },
    },
    { status },
  );
}

export function validationFields(error: ZodError) {
  return error.flatten().fieldErrors;
}
