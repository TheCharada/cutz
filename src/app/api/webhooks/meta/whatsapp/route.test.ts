import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "./route";

const originalVerifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
const originalAppSecret = process.env.WHATSAPP_APP_SECRET;

beforeEach(() => {
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = "test-webhook-verify-token";
  process.env.WHATSAPP_APP_SECRET = "test-meta-app-secret";
});

afterEach(() => {
  if (originalVerifyToken === undefined) delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  else process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = originalVerifyToken;

  if (originalAppSecret === undefined) delete process.env.WHATSAPP_APP_SECRET;
  else process.env.WHATSAPP_APP_SECRET = originalAppSecret;
});

describe("Meta WhatsApp webhook route", () => {
  it("returns the Meta verification challenge for the configured verify token", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=test-webhook-verify-token&hub.challenge=challenge-123",
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("challenge-123");
  });

  it("rejects webhook verification with the wrong token", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=challenge-123",
      ),
    );

    expect(response.status).toBe(403);
  });

  it("rejects unsigned status callbacks before parsing or touching the database", async () => {
    const response = await POST(
      new Request("http://localhost/api/webhooks/meta/whatsapp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ object: "whatsapp_business_account", entry: [] }),
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ received: false });
  });
});
