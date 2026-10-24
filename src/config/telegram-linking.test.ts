import { afterEach, describe, expect, it, vi } from "vitest";
import { isTelegramLinkingEnabled } from "./telegram-linking";

afterEach(() => vi.unstubAllEnvs());

describe("Telegram linking availability", () => {
  it("stays hidden without both bot address and webhook secret", () => {
    vi.stubEnv("TELEGRAM_BOT_USERNAME", "");
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "");
    expect(isTelegramLinkingEnabled()).toBe(false);
    vi.stubEnv("TELEGRAM_BOT_USERNAME", "CutzExampleBot");
    expect(isTelegramLinkingEnabled()).toBe(false);
  });

  it("rejects an invalid bot username and enables only when fully configured", () => {
    vi.stubEnv("TELEGRAM_BOT_USERNAME", "not-a-bot");
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "secret");
    expect(isTelegramLinkingEnabled()).toBe(false);
    vi.stubEnv("TELEGRAM_BOT_USERNAME", "CutzExampleBot");
    expect(isTelegramLinkingEnabled()).toBe(true);
  });
});
