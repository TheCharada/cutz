import { describe, expect, it } from "vitest";
import { isValidTelegramDeepLink, telegramLinkEndpoint } from "./telegram-link-utils";

const token = "A".repeat(43);
const origin = "https://app.example.test";

describe("Telegram capability URL validation", () => {
  it("extracts endpoints from valid same-origin appointment and waitlist capabilities", () => {
    expect(telegramLinkEndpoint(`${origin}/a/${token}`, "appointment", origin))
      .toBe(`/api/capabilities/appointments/${token}/telegram-link`);
    expect(telegramLinkEndpoint(`/w/${token}`, "waitlist", origin))
      .toBe(`/api/capabilities/waitlist/${token}/telegram-link`);
  });

  it("rejects foreign origins, wrong scopes, fragments and non-token paths", () => {
    expect(telegramLinkEndpoint(`https://evil.example/a/${token}`, "appointment", origin)).toBeNull();
    expect(telegramLinkEndpoint(`/w/${token}`, "appointment", origin)).toBeNull();
    expect(telegramLinkEndpoint(`/a/${token}?redirect=evil`, "appointment", origin)).toBeNull();
    expect(telegramLinkEndpoint(`/a/${token}#fragment`, "appointment", origin)).toBeNull();
    expect(telegramLinkEndpoint("/a/not-a-valid-token", "appointment", origin)).toBeNull();
    expect(telegramLinkEndpoint("javascript:alert(1)", "appointment", origin)).toBeNull();
  });
});

describe("Telegram bot deep-link validation", () => {
  it("accepts only an HTTPS bot deep link carrying one valid start token", () => {
    expect(isValidTelegramDeepLink(`https://t.me/CutzExampleBot?start=${token}`)).toBe(true);
    expect(isValidTelegramDeepLink(`https://t.me/CutzExampleBot?start=${token}&track=1`)).toBe(false);
    expect(isValidTelegramDeepLink(`https://t.me/CutzExampleBot?start=${token}#secret`)).toBe(false);
    expect(isValidTelegramDeepLink(`http://t.me/CutzExampleBot?start=${token}`)).toBe(false);
    expect(isValidTelegramDeepLink(`https://t.me.evil.test/CutzExampleBot?start=${token}`)).toBe(false);
    expect(isValidTelegramDeepLink(`https://t.me/NotABot?start=short`)).toBe(false);
    expect(isValidTelegramDeepLink("javascript:alert(1)")).toBe(false);
    expect(isValidTelegramDeepLink(null)).toBe(false);
  });
});
