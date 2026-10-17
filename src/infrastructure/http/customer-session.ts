export function customerSessionCookieName(slug: string) {
  return `cutz_customer_session_${slug}`;
}

function parseCookies(header: string | null) {
  const entries = (header ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const separator = item.indexOf("=");
      if (separator < 0) {
        return [item, ""] as const;
      }
      return [item.slice(0, separator), item.slice(separator + 1)] as const;
    });

  return new Map(entries);
}

export function readCustomerSessionToken(request: Request, slug: string) {
  return parseCookies(request.headers.get("cookie")).get(customerSessionCookieName(slug)) ?? null;
}

function customerSessionCookieParts(slug: string, value: string) {
  const parts = [
    `${customerSessionCookieName(slug)}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];

  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }

  return parts;
}

export function serializeCustomerSessionCookie(slug: string, token: string, expiresAt: Date) {
  return [...customerSessionCookieParts(slug, token), `Expires=${expiresAt.toUTCString()}`].join("; ");
}

export function serializeClearedCustomerSessionCookie(slug: string) {
  return [
    ...customerSessionCookieParts(slug, ""),
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Max-Age=0",
  ].join("; ");
}
