export type TelegramLinkScope = "appointment" | "waitlist";

const capabilityTokenPattern = /^[A-Za-z0-9_-]{43}$/;
const botUsernamePattern = /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/;

export function telegramLinkEndpoint(
  managementUrl: string,
  scope: TelegramLinkScope,
  currentOrigin: string,
) {
  try {
    const url = new URL(managementUrl, currentOrigin);
    if (url.origin !== currentOrigin || url.search || url.hash) return null;
    const prefix = scope === "appointment" ? "a" : "w";
    const segments = url.pathname.split("/");
    if (segments.length !== 3 || segments[1] !== prefix ||
        !capabilityTokenPattern.test(segments[2])) return null;
    const kind = scope === "appointment" ? "appointments" : "waitlist";
    return `/api/capabilities/${kind}/${encodeURIComponent(segments[2])}/telegram-link`;
  } catch {
    return null;
  }
}

/** The deep link is an external destination, so do not trust arbitrary API URLs. */
export function isValidTelegramDeepLink(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    const segments = url.pathname.split("/");
    return url.protocol === "https:" && url.hostname === "t.me" &&
      !url.username && !url.password && !url.port && !url.hash &&
      segments.length === 2 && botUsernamePattern.test(segments[1]) &&
      /bot$/i.test(segments[1]) &&
      url.searchParams.size === 1 &&
      capabilityTokenPattern.test(url.searchParams.get("start") ?? "");
  } catch {
    return false;
  }
}
