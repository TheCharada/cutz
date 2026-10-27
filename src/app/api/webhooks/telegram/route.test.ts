import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { disableTelegramChat, redeemTelegramLink, verifyTelegramContact } from "@/workflows/telegram-link";
import { describeTelegramResource } from "@/workflows/telegram-resource-summary";

vi.mock("@/workflows/telegram-link", () => ({
  disableTelegramChat: vi.fn(),
  redeemTelegramLink: vi.fn(),
  verifyTelegramContact: vi.fn(),
}));

vi.mock("@/workflows/telegram-resource-summary", () => ({
  describeTelegramResource: vi.fn(),
}));

const webhookSecret = "test_telegram_webhook_secret";
const token = "A".repeat(43);

function request(text: string, secret: string | null = webhookSecret) {
  return new Request("https://app.example.test/api/webhooks/telegram", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { "x-telegram-bot-api-secret-token": secret } : {}),
    },
    body: JSON.stringify({
      update_id: 101,
      message: { chat: { id: 123456, type: "private" }, from: { id: 123456 }, text },
    }),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("Telegram webhook route", () => {
  it("rejects unauthenticated requests before touching persistence", async () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", webhookSecret);
    const response = await POST(request(`/start ${token}`, "wrong"));
    expect(response.status).toBe(401);
    expect(redeemTelegramLink).not.toHaveBeenCalled();
  });

  it("does not activate without a configured webhook secret", async () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "");
    expect((await POST(request(`/start ${token}`))).status).toBe(503);
    expect(redeemTelegramLink).not.toHaveBeenCalled();
  });

  it("redeems one scoped token and confirms linking in the Telegram webhook reply", async () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", webhookSecret);
    vi.mocked(redeemTelegramLink).mockResolvedValue("linked");
    vi.mocked(describeTelegramResource).mockResolvedValue("Agendamento confirmado.");
    const response = await POST(request(`/start ${token}`));
    expect(response.status).toBe(200);
    expect(redeemTelegramLink).toHaveBeenCalledWith({ token, chatId: "123456" });
    expect(await response.json()).toMatchObject({
      method: "sendMessage",
      chat_id: "123456",
      text: expect.stringContaining("Agendamento confirmado."),
      reply_markup: { keyboard: [[{ text: "Compartilhar meu telefone", request_contact: true }]] },
    });
  });

  it("returns a generic message for an expired or reused link", async () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", webhookSecret);
    vi.mocked(redeemTelegramLink).mockResolvedValue("invalid");
    const response = await POST(request(`/start ${token}`));
    expect(response.status).toBe(200);
    expect((await response.json()).text).toContain("Gere um novo link");
  });

  it("revokes chat subscriptions through stop, without trusting phone numbers", async () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", webhookSecret);
    vi.mocked(disableTelegramChat).mockResolvedValue(2);
    const response = await POST(request("/stop"));
    expect(response.status).toBe(200);
    expect(disableTelegramChat).toHaveBeenCalledWith("123456");
  });


  it("activates a customer subscription only after phone verification", async () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", webhookSecret);
    vi.mocked(verifyTelegramContact).mockResolvedValue("verified");
    const response = await POST(new Request("https://app.example.test/api/webhooks/telegram", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": webhookSecret,
      },
      body: JSON.stringify({
        update_id: 201,
        message: { chat: { id: 123456, type: "private" },
          from: { id: 123456 },
          contact: { user_id: 123456, phone_number: "+5511999990001" } },
      }),
    }));
    expect(response.status).toBe(200);
    expect(verifyTelegramContact).toHaveBeenCalledWith({
      chatId: "123456", telegramUserId: "123456",
      contactUserId: "123456", phoneNumber: "+5511999990001",
    });
    const reply = await response.json();
    expect(reply.reply_markup).toMatchObject({ remove_keyboard: true });
    expect(reply.text).toContain("próximos avisos");
  });

  it("rejects oversized or non-JSON payloads", async () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", webhookSecret);
    const big = new Request("https://app.example.test/api/webhooks/telegram", {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": webhookSecret },
      body: "X".repeat(17000),
    });
    expect((await POST(big)).status).toBe(413);
    const wrongType = new Request("https://app.example.test/api/webhooks/telegram", {
      method: "POST",
      headers: { "content-type": "text/plain", "x-telegram-bot-api-secret-token": webhookSecret },
      body: "hello",
    });
    expect((await POST(wrongType)).status).toBe(415);
  });
});
