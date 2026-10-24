import { describe, expect, it, vi } from "vitest";
import type { NotificationPayload } from "@/modules/notifications";
import {
  formatTelegramMessage,
  TelegramMessagingProvider,
} from "./telegram-messaging-provider";

const appointment: NotificationPayload = {
  type: "APPOINTMENT_CREATED",
  appointmentId: "4677b197-7cba-4dca-913d-f69e872f36fb",
  customerName: "Cliente <Exemplo>",
  serviceName: "Corte",
  staffName: "Profissional",
  startsAt: "2026-10-26T12:30:00.000Z",
  managementUrl: "https://app.example.test/a/capability-token",
};

function outgoing(payload: NotificationPayload = appointment) {
  return { chatId: "123456789", timeZone: "America/Sao_Paulo", payload };
}

function success() {
  return new Response(JSON.stringify({ ok: true, result: { message_id: 75 } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("TelegramMessagingProvider", () => {
  it("sends an appointment with localized time, plain text and action button", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(success());
    const provider = new TelegramMessagingProvider("test-bot-token", send);

    await expect(provider.send(outgoing(), { signal: new AbortController().signal }))
      .resolves.toEqual({ providerMessageId: "telegram:123456789:75" });

    expect(send).toHaveBeenCalledOnce();
    const [url, init] = send.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bottest-bot-token/sendMessage");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      chat_id: "123456789",
      link_preview_options: { is_disabled: true },
      reply_markup: {
        inline_keyboard: [[{
          text: "Gerenciar agendamento",
          url: "https://app.example.test/a/capability-token",
        }]],
      },
    });
    expect(body.text).toContain("26/10/2026");
    expect(body.text).toContain("09:30");
    expect(body.text).toContain("Cliente <Exemplo>");
    expect(body.parse_mode).toBeUndefined();
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("formats the supported appointment and waitlist notification types", () => {
    const reminder: NotificationPayload = {
      type: "APPOINTMENT_REMINDER",
      appointmentId: appointment.appointmentId,
      customerName: "Cliente",
      serviceName: "Corte",
      staffName: "Profissional",
      startsAt: "2026-10-26T12:30:00.000Z",
    };
    const offer: NotificationPayload = {
      type: "WAITLIST_OFFER",
      waitlistOfferId: "f334c1dc-e7ac-400f-950a-7166503a22b7",
      customerName: "Cliente",
      serviceName: "Corte",
      staffName: "Profissional",
      startsAt: "2026-10-26T12:30:00.000Z",
      endsAt: "2026-10-26T13:00:00.000Z",
      expiresAt: "2026-10-26T12:00:00.000Z",
      actionUrl: "https://app.example.test/o/accept-token",
    };
    expect(formatTelegramMessage(reminder, "America/Sao_Paulo").action).toBeUndefined();
    expect(formatTelegramMessage(offer, "America/Sao_Paulo").action?.url)
      .toBe("https://app.example.test/o/accept-token");
    expect(formatTelegramMessage({
      type: "APPOINTMENT_CANCELLED",
      appointmentId: appointment.appointmentId,
      customerName: "Cliente",
      serviceName: "Corte",
      staffName: "Profissional",
      startsAt: "2026-10-26T12:30:00.000Z",
      reason: "A pedido do cliente",
    }, "America/Sao_Paulo").text).toContain("A pedido do cliente");
    expect(formatTelegramMessage({
      type: "APPOINTMENT_RESCHEDULED",
      appointmentId: appointment.appointmentId,
      previousAppointmentId: "2247bbd6-b1da-468b-bc22-8cfcd6196dd3",
      customerName: "Cliente",
      serviceName: "Corte",
      staffName: "Profissional",
      startsAt: "2026-10-26T12:30:00.000Z",
      managementUrl: "https://app.example.test/a/updated",
    }, "America/Sao_Paulo").action?.url).toBe("https://app.example.test/a/updated");
    expect(formatTelegramMessage({
      type: "WAITLIST_ENTRY_CREATED",
      waitlistEntryId: "dbdb9f40-d15d-4d30-915d-31570363116d",
      customerName: "Cliente",
      serviceName: "Corte",
      desiredDate: "2026-10-27",
      earliestTime: "09:00",
      latestTime: "12:00",
      managementUrl: "https://app.example.test/w/capability",
    }, "America/Sao_Paulo").action?.url).toBe("https://app.example.test/w/capability");
  });

  it("respects Telegram retry_after when rate limited", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, parameters: { retry_after: 7 } }), {
        status: 429,
      }),
    );
    await expect(new TelegramMessagingProvider("token", send)
      .send(outgoing(), { signal: new AbortController().signal }))
      .rejects.toMatchObject({ retryable: true, retryAfterMs: 7000 });
  });

  it.each([403, 400, 500, 503])(
    "classifies Telegram HTTP %i without leaking response bodies",
    async (status) => {
      const send = vi.fn<typeof fetch>().mockResolvedValue(
        new Response("sensitive provider response", { status }),
      );
      const error = await new TelegramMessagingProvider("token", send)
        .send(outgoing(), { signal: new AbortController().signal })
        .catch((reason: unknown) => reason);
      expect(error).toMatchObject({
        retryable: status >= 500,
        message: `Telegram request failed with status ${status}`,
      });
    },
  );

  it("does not treat Telegram chat ownership as phone verification", async () => {
    const send = vi.fn<typeof fetch>();
    const payload: NotificationPayload = {
      type: "CUSTOMER_OTP",
      otpChallengeId: "e126d15a-275d-4311-af3b-7fcff9b7c39b",
      code: "123456",
      expiresAt: "2026-10-26T12:30:00.000Z",
    };
    await expect(new TelegramMessagingProvider("token", send)
      .send(outgoing(payload), { signal: new AbortController().signal }))
      .rejects.toMatchObject({ retryable: false });
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects invalid chat IDs and unsafe action URLs without sending", async () => {
    const send = vi.fn<typeof fetch>();
    const provider = new TelegramMessagingProvider("token", send);
    await expect(provider.send({ ...outgoing(), chatId: "-100123" }, {
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ retryable: false });
    await expect(provider.send(outgoing({
      ...appointment,
      managementUrl: "javascript:alert(1)",
    }), { signal: new AbortController().signal })).rejects.toMatchObject({ retryable: false });
    expect(send).not.toHaveBeenCalled();
  });

  it("reports unexpected responses and network errors as retryable", async () => {
    const bad = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 }),
    );
    await expect(new TelegramMessagingProvider("token", bad)
      .send(outgoing(), { signal: new AbortController().signal }))
      .rejects.toMatchObject({ retryable: true });

    const network = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("network failed"));
    await expect(new TelegramMessagingProvider("token", network)
      .send(outgoing(), { signal: new AbortController().signal }))
      .rejects.toMatchObject({ retryable: true, message: "Telegram request failed" });
  });

  it("bounds dynamic text fields before sending", () => {
    const payload: NotificationPayload = {
      ...appointment,
      customerName: "X".repeat(8000),
    };
    const message = formatTelegramMessage(payload, "America/Sao_Paulo");
    expect(message.text.length).toBeLessThan(4096);
    expect(message.text).not.toContain("X".repeat(161));
  });
});
