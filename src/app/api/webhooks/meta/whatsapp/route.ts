import { getWhatsAppWebhookEnv } from "@/config/whatsapp-webhook-env";
import { jsonResponse } from "@/infrastructure/http";
import { logger } from "@/infrastructure/logging/logger";
import {
  constantTimeStringEqual,
  parseWhatsAppStatusWebhook,
  verifyMetaWebhookSignature,
  WhatsAppWebhookPayloadError,
} from "@/infrastructure/messaging/whatsapp-webhook";
import { processWhatsAppDeliveryStatuses } from "@/workflows/whatsapp-delivery-status";

export const dynamic = "force-dynamic";

function errorName(error: unknown) {
  return error instanceof Error ? error.name : "UnknownError";
}

function webhookEnv() {
  try {
    return getWhatsAppWebhookEnv();
  } catch (error) {
    logger.error({ errorName: errorName(error) }, "WhatsApp webhook is not configured");
    return null;
  }
}

export async function GET(request: Request) {
  const env = webhookEnv();
  if (!env) return new Response("Webhook unavailable", { status: 503 });

  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode") ?? "";
  const verifyToken = url.searchParams.get("hub.verify_token") ?? "";
  const challenge = url.searchParams.get("hub.challenge");

  if (
    mode !== "subscribe" ||
    challenge === null ||
    !constantTimeStringEqual(verifyToken, env.WHATSAPP_WEBHOOK_VERIFY_TOKEN)
  ) {
    return new Response("Forbidden", { status: 403 });
  }

  return new Response(challenge, {
    status: 200,
    headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function POST(request: Request) {
  const env = webhookEnv();
  if (!env) return jsonResponse({ received: false }, { status: 503 });

  const rawBody = await request.text();
  if (
    !verifyMetaWebhookSignature(
      rawBody,
      request.headers.get("x-hub-signature-256"),
      env.WHATSAPP_APP_SECRET,
    )
  ) {
    return jsonResponse({ received: false }, { status: 401 });
  }

  let updates: ReturnType<typeof parseWhatsAppStatusWebhook>;
  try {
    updates = parseWhatsAppStatusWebhook(rawBody);
  } catch (error) {
    if (error instanceof WhatsAppWebhookPayloadError) {
      return jsonResponse({ received: false }, { status: 400 });
    }
    throw error;
  }

  try {
    const result = await processWhatsAppDeliveryStatuses({ updates });
    return jsonResponse({ accepted: true, ...result });
  } catch (error) {
    logger.error(
      { errorName: errorName(error), statusCount: updates.length },
      "WhatsApp delivery status persistence failed",
    );
    return jsonResponse({ received: false }, { status: 500 });
  }
}
