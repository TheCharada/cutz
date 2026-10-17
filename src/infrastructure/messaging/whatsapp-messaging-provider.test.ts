import { describe, expect, it, vi } from "vitest";
import { MessagingProviderError, type OutboundNotification } from "@/modules/notifications";
import { WhatsAppMessagingProvider, type WhatsAppTemplateMap } from "./whatsapp-messaging-provider";

const templates: WhatsAppTemplateMap = {
  APPOINTMENT_CREATED: "appointment_created",
  APPOINTMENT_RESCHEDULED: "appointment_rescheduled",
  APPOINTMENT_REMINDER: "appointment_reminder",
  APPOINTMENT_CANCELLED: "appointment_cancelled",
  WAITLIST_ENTRY_CREATED: "waitlist_entry_created",
  WAITLIST_OFFER: "waitlist_offer",
  CUSTOMER_OTP: "customer_otp",
};

function notification(): OutboundNotification {
  return {
    jobId: "job-123",
    idempotencyKey: "job-123",
    toE164: "+5511999999999",
    timeZone: "America/Sao_Paulo",
    type: "CUSTOMER_OTP",
    payload: {
      type: "CUSTOMER_OTP",
      otpChallengeId: "7a0ee566-2db7-4938-a29c-e9e29b335d19",
      code: "123456",
      expiresAt: "2026-09-05T17:00:00.000Z",
    },
  };
}

function appointmentNotification(
  managementUrl = "https://cutz.example/capabilities/appointments/example-token?from=whatsapp",
): OutboundNotification {
  return {
    jobId: "job-appointment",
    idempotencyKey: "job-appointment",
    toE164: "+5511988887777",
    timeZone: "America/Sao_Paulo",
    type: "APPOINTMENT_CREATED",
    payload: {
      type: "APPOINTMENT_CREATED",
      appointmentId: "0f919153-94cb-48f7-928d-a063d80ca6f7",
      customerName: "Maria",
      serviceName: "Corte",
      staffName: "Profissional Exemplo",
      startsAt: "2026-09-07T12:00:00.000Z",
      managementUrl,
    },
  };
}

function waitlistEntryNotification(): OutboundNotification {
  return {
    jobId: "job-waitlist",
    idempotencyKey: "job-waitlist",
    toE164: "+5511977776666",
    timeZone: "America/Sao_Paulo",
    type: "WAITLIST_ENTRY_CREATED",
    payload: {
      type: "WAITLIST_ENTRY_CREATED",
      waitlistEntryId: "b718995e-8118-48a6-9f25-18bd9e736282",
      customerName: "Maria",
      serviceName: "Corte",
      desiredDate: "2026-09-19",
      earliestTime: "08:00",
      latestTime: "18:00",
      managementUrl: "https://cutz.example/w/example-token",
    },
  };
}

function provider(fetchFn: typeof fetch) {
  return new WhatsAppMessagingProvider(
    {
      accessToken: "example-access-token",
      phoneNumberId: "example-phone-number-id",
      graphApiVersion: "v1.0",
      templateLanguage: "pt_BR",
      templates,
      appOrigin: "https://cutz.example",
      graphBaseUrl: "https://graph.example.test",
    },
    { fetchFn },
  );
}

function successResponse() {
  return new Response(JSON.stringify({ messages: [{ id: "wamid.example" }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function captureProviderError(operation: Promise<unknown>) {
  try {
    await operation;
  } catch (reason) {
    expect(reason).toBeInstanceOf(MessagingProviderError);
    if (reason instanceof MessagingProviderError) return reason;
  }
  throw new Error("expected MessagingProviderError");
}

describe("WhatsAppMessagingProvider", () => {
  it("sends an authentication template with body and copy-code button parameters", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(successResponse());

    await expect(
      provider(fetchFn).send(notification(), { signal: new AbortController().signal }),
    ).resolves.toEqual({ providerMessageId: "wamid.example" });

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://graph.example.test/v1.0/example-phone-number-id/messages");
    expect(init?.headers).toMatchObject({
      authorization: "Bearer example-access-token",
      "content-type": "application/json",
    });
    expect((init?.headers as Record<string, string>)["idempotency-key"]).toBeUndefined();
    expect(JSON.parse(String(init?.body))).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "5511999999999",
      type: "template",
      template: {
        name: "customer_otp",
        language: { code: "pt_BR" },
        components: [
          {
            type: "body",
            parameters: [{ type: "text", text: "123456" }],
          },
          {
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [{ type: "text", text: "123456" }],
          },
        ],
      },
    });
  });

  it("formats appointment timestamps in the tenant timezone", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(successResponse());

    await provider(fetchFn).send(appointmentNotification(), {
      signal: new AbortController().signal,
    });

    const [, init] = fetchFn.mock.calls[0];
    expect(JSON.parse(String(init?.body)).template.components).toEqual([
      {
        type: "body",
        parameters: [
          { type: "text", text: "Maria" },
          { type: "text", text: "Corte" },
          { type: "text", text: "Profissional Exemplo" },
          { type: "text", text: "07/09/2026 às 09:00" },
        ],
      },
      {
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [
          {
            type: "text",
            text: "capabilities/appointments/example-token?from=whatsapp",
          },
        ],
      },
    ]);
  });

  it("formats waitlist local dates without changing the local time window", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(successResponse());

    await provider(fetchFn).send(waitlistEntryNotification(), {
      signal: new AbortController().signal,
    });

    const [, init] = fetchFn.mock.calls[0];
    expect(JSON.parse(String(init?.body)).template.components[0]).toEqual({
      type: "body",
      parameters: [
        { type: "text", text: "Maria" },
        { type: "text", text: "Corte" },
        { type: "text", text: "19/09/2026" },
        { type: "text", text: "08:00" },
        { type: "text", text: "18:00" },
      ],
    });
  });

  it("rejects action URLs outside APP_ORIGIN before contacting Meta", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(successResponse());
    const error = await captureProviderError(
      provider(fetchFn).send(
        appointmentNotification("https://other.example/capabilities/appointments/example-token"),
        { signal: new AbortController().signal },
      ),
    );

    expect(error.retryable).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("treats invalid tenant timezones as permanent provider errors", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(successResponse());
    const invalid = { ...appointmentNotification(), timeZone: "Invalid/Timezone" };
    const error = await captureProviderError(
      provider(fetchFn).send(invalid, { signal: new AbortController().signal }),
    );

    expect(error.retryable).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    [429, true],
    [500, true],
    [503, true],
    [400, false],
    [401, false],
  ])("normalizes HTTP %s as retryable=%s", async (status, retryable) => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("{}", { status, headers: status === 429 ? { "retry-after": "12" } : {} }),
    );

    const error = await captureProviderError(
      provider(fetchFn).send(notification(), { signal: new AbortController().signal }),
    );
    expect(error.retryable).toBe(retryable);
    if (status === 429) expect(error.retryAfterMs).toBe(12_000);
  });

  it("normalizes timeout failures as retryable", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(
      new DOMException("timed out", "TimeoutError"),
    );
    const error = await captureProviderError(
      provider(fetchFn).send(notification(), { signal: AbortSignal.timeout(1) }),
    );
    expect(error.retryable).toBe(true);
  });
});
