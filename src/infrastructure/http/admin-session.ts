export const adminSessionCookieName = "cutz_admin_session";

function parseCookies(header: string | null) {
  const entries = (header ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const separator = item.indexOf("=");
      if (separator < 0) return [item, ""] as const;
      return [item.slice(0, separator), item.slice(separator + 1)] as const;
    });
  return new Map(entries);
}

export function readAdminSessionToken(request: Request) {
  return parseCookies(request.headers.get("cookie")).get(adminSessionCookieName) ?? null;
}

export function serializeAdminSessionCookie(token: string, expiresAt: Date) {
  const parts = [
    `${adminSessionCookieName}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export function serializeClearedAdminSessionCookie() {
  const parts = [
    `${adminSessionCookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}
