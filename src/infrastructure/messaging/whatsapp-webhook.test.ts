import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  constantTimeStringEqual,
  parseWhatsAppStatusWebhook,
  verifyMetaWebhookSignature,
  WhatsAppWebhookPayloadError,
} from "./whatsapp-webhook";

describe("WhatsApp webhook", () => {
  it("verifies the X-Hub-Signature-256 against the raw request body", () => {
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    const secret = "meta-app-secret";
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

    expect(verifyMetaWebhookSignature(body, signature, secret)).toBe(true);
    expect(verifyMetaWebhookSignature(`${body} `, signature, secret)).toBe(false);
    expect(verifyMetaWebhookSignature(body, "sha256=invalid", secret)).toBe(false);
    expect(verifyMetaWebhookSignature(body, null, secret)).toBe(false);
  });

  it("compares verification tokens without direct string comparison", () => {
    expect(constantTimeStringEqual("verify-token", "verify-token")).toBe(true);
    expect(constantTimeStringEqual("verify-token", "other-token")).toBe(false);
  });

  it("parses a failed delivery status and preserves the provider error", () => {
    const updates = parseWhatsAppStatusWebhook(
      JSON.stringify({
        object: "whatsapp_business_account",
        entry: [
          {
            id: "waba-id",
            changes: [
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  statuses: [
                    {
                      id: "wamid.failed",
                      status: "failed",
                      timestamp: "1788646898",
                      recipient_id: "5514999999999",
                      errors: [
                        {
                          code: 130497,
                          title: "Business account is restricted from messaging users in this country.",
                          message: "Business account is restricted from messaging users in this country.",
                          error_data: {
                            details: "Business account is restricted from messaging users in this country.",
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    );

    expect(updates).toEqual([
      {
        providerMessageId: "wamid.failed",
        status: "FAILED",
        occurredAt: new Date(1788646898 * 1000),
        errorCode: 130497,
        errorMessage: "Business account is restricted from messaging users in this country.",
      },
    ]);
  });

  it("extracts supported message statuses and ignores unrelated or future events", () => {
    const updates = parseWhatsAppStatusWebhook(
      JSON.stringify({
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              {
                field: "messages",
                value: {
                  statuses: [
                    { id: "wamid.sent", status: "sent", timestamp: "100" },
                    { id: "wamid.delivered", status: "delivered", timestamp: "101" },
                    { id: "wamid.future", status: "future_status", timestamp: "102" },
                  ],
                },
              },
              {
                field: "account_update",
                value: { statuses: [{ id: "ignored", status: "failed", timestamp: "103" }] },
              },
            ],
          },
        ],
      }),
    );

    expect(updates.map(({ providerMessageId, status }) => ({ providerMessageId, status }))).toEqual([
      { providerMessageId: "wamid.sent", status: "SENT" },
      { providerMessageId: "wamid.delivered", status: "DELIVERED" },
    ]);
  });

  it("rejects malformed JSON without treating it as a provider event", () => {
    expect(() => parseWhatsAppStatusWebhook("{"))
      .toThrow(WhatsAppWebhookPayloadError);
  });
});
