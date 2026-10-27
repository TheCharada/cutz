import { describe, expect, it } from "vitest";
import {
  parseTelegramWebhookCommand,
  readTelegramWebhookBody,
  verifyTelegramWebhookSecret,
} from "./telegram-webhook";

const token = "A".repeat(43);

function update(message: Record<string, unknown>) {
  return JSON.stringify({ update_id: 123, message });
}

function privateMessage(text: string) {
  return { chat: { id: 1234567, type: "private" }, from: { id: 1234567 }, text };
}

describe("Telegram webhook validation", () => {
  it("requires the configured secret and compares it without timing-sensitive string matching", () => {
    expect(verifyTelegramWebhookSecret("test-secret", "test-secret")).toBe(true);
    expect(verifyTelegramWebhookSecret("different", "test-secret")).toBe(false);
    expect(verifyTelegramWebhookSecret(null, "test-secret")).toBe(false);
    expect(verifyTelegramWebhookSecret("test-secret", "")).toBe(false);
  });

  it("accepts private start and stop commands", () => {
    expect(parseTelegramWebhookCommand(update(privateMessage(`/start ${token}`))))
      .toEqual({ action: "link", token, chatId: "1234567" });
    expect(parseTelegramWebhookCommand(update(privateMessage("/stop"))))
      .toEqual({ action: "stop", chatId: "1234567" });
  });

  it("ignores group chats, bots, unrelated users and unsupported commands", () => {
    expect(parseTelegramWebhookCommand(update({
      ...privateMessage(`/start ${token}`),
      chat: { id: -100123, type: "supergroup" },
    }))).toEqual({ action: "ignore" });
    expect(parseTelegramWebhookCommand(update({
      ...privateMessage(`/start ${token}`),
      from: { id: 444 },
    }))).toEqual({ action: "ignore" });
    expect(parseTelegramWebhookCommand(update({
      ...privateMessage(`/start ${token}`),
      from: { id: 1234567, is_bot: true },
    }))).toEqual({ action: "ignore" });
    expect(parseTelegramWebhookCommand(update(privateMessage("/start"))))
      .toEqual({ action: "ignore" });
    expect(parseTelegramWebhookCommand(JSON.stringify({ update_id: 456 })))
      .toEqual({ action: "ignore" });
  });

  it("accepts contact only from the private Telegram account itself", () => {
    const matching = { chat: { id: 1234567, type: "private" },
      from: { id: 1234567 },
      contact: { user_id: 1234567, phone_number: "+5511999990001" } };
    expect(parseTelegramWebhookCommand(update(matching))).toEqual({
      action: "contact", chatId: "1234567", telegramUserId: "1234567",
      contactUserId: "1234567", phoneNumber: "+5511999990001",
    });
    expect(parseTelegramWebhookCommand(update({
      ...matching, from: { id: 1234 },
    }))).toEqual({ action: "ignore" });
    expect(parseTelegramWebhookCommand(update({
      ...matching, chat: { id: -10023, type: "group" },
    }))).toEqual({ action: "ignore" });
    expect(parseTelegramWebhookCommand(update({
      ...matching, contact: { phone_number: "+5511999990001" },
    }))).toEqual({ action: "ignore" });
  });

  it("rejects invalid JSON and unsafe numeric chat identifiers", () => {
    expect(() => parseTelegramWebhookCommand("{broken-json")).toThrow();
    expect(() => parseTelegramWebhookCommand(update({
      chat: { id: Number.MAX_SAFE_INTEGER + 1, type: "private" },
      from: { id: Number.MAX_SAFE_INTEGER + 1 },
      text: `/start ${token}`,
    }))).toThrow();
  });

  it("caps webhook bodies even without a content-length header", async () => {
    const ok = new Request("https://app.example/api/webhooks/telegram", {
      method: "POST",
      body: update(privateMessage(`/start ${token}`)),
    });
    expect(await readTelegramWebhookBody(ok, 1024)).toContain("/start");

    const large = new Request("https://app.example/api/webhooks/telegram", {
      method: "POST",
      body: "x".repeat(5000),
    });
    expect(await readTelegramWebhookBody(large, 256)).toBeNull();
  });
});
