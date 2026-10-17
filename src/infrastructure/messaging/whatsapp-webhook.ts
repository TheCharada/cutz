import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { NotificationDeliveryUpdate } from "@/modules/notifications";

const metaStatusSchema = z.enum(["sent", "delivered", "read", "failed", "deleted"]);

const metaErrorSchema = z
  .object({
    code: z.number().int().optional(),
    title: z.string().optional(),
    message: z.string().optional(),
    error_data: z
      .object({
        details: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const metaStatusObjectSchema = z
  .object({
    id: z.string().min(1),
    status: metaStatusSchema,
    timestamp: z.union([z.string(), z.number()]),
    errors: z.array(metaErrorSchema).optional(),
  })
  .passthrough();

const metaWebhookSchema = z
  .object({
    entry: z
      .array(
        z
          .object({
            changes: z
              .array(
                z
                  .object({
                    field: z.string().optional(),
                    value: z
                      .object({
                        statuses: z.array(z.unknown()).optional(),
                      })
                      .passthrough(),
                  })
                  .passthrough(),
              )
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const deliveryStatusMap: Record<z.infer<typeof metaStatusSchema>, NotificationDeliveryUpdate["status"]> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
  deleted: "DELETED",
};

export class WhatsAppWebhookPayloadError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "WhatsAppWebhookPayloadError";
  }
}

export function constantTimeStringEqual(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
) {
  const match = /^sha256=([0-9a-f]{64})$/i.exec(signatureHeader ?? "");
  if (!match) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const received = Buffer.from(match[1], "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function errorMessage(error: z.infer<typeof metaErrorSchema> | undefined) {
  return error?.error_data?.details ?? error?.message ?? error?.title;
}

export function parseWhatsAppStatusWebhook(rawBody: string): NotificationDeliveryUpdate[] {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch (error) {
    throw new WhatsAppWebhookPayloadError("WhatsApp webhook body is not valid JSON", { cause: error });
  }

  const webhook = metaWebhookSchema.safeParse(json);
  if (!webhook.success) return [];

  const updates: NotificationDeliveryUpdate[] = [];
  for (const entry of webhook.data.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;

      for (const candidate of change.value.statuses ?? []) {
        const parsed = metaStatusObjectSchema.safeParse(candidate);
        if (!parsed.success) continue;

        const timestampSeconds = Number(parsed.data.timestamp);
        if (!Number.isFinite(timestampSeconds) || timestampSeconds < 0) continue;

        const occurredAt = new Date(timestampSeconds * 1000);
        if (Number.isNaN(occurredAt.getTime())) continue;

        const firstError = parsed.data.errors?.[0];
        updates.push({
          providerMessageId: parsed.data.id,
          status: deliveryStatusMap[parsed.data.status],
          occurredAt,
          ...(firstError?.code !== undefined ? { errorCode: firstError.code } : {}),
          ...(errorMessage(firstError) ? { errorMessage: errorMessage(firstError) } : {}),
        });
      }
    }
  }

  return updates;
}
