import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const telegramUpdateSchema = z.object({
  update_id: z.number().int().safe(),
  message: z.object({
    chat: z.object({
      id: z.number().int().safe(),
      type: z.string(),
    }).passthrough(),
    from: z.object({
      id: z.number().int().safe(),
      is_bot: z.boolean().optional(),
    }).passthrough().optional(),
    text: z.string().max(256).optional(),
  }).passthrough().optional(),
}).passthrough();

export type TelegramWebhookCommand =
  | { action: "link"; token: string; chatId: string }
  | { action: "stop"; chatId: string }
  | { action: "ignore" };

export function verifyTelegramWebhookSecret(received: string | null, expected: string) {
  if (!received || !expected) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(received), digest(expected));
}

export function parseTelegramWebhookCommand(rawBody: string): TelegramWebhookCommand {
  const decoded: unknown = JSON.parse(rawBody);
  const parsed = telegramUpdateSchema.parse(decoded);
  const message = parsed.message;
  if (
    !message ||
    message.chat.type !== "private" ||
    message.from?.is_bot ||
    message.from?.id !== message.chat.id ||
    message.chat.id <= 0 ||
    !message.text
  ) {
    return { action: "ignore" };
  }
  const chatId = String(message.chat.id);
  if (message.text === "/stop") return { action: "stop", chatId };
  const link = /^\/start ([A-Za-z0-9_-]{43})$/.exec(message.text);
  if (link) return { action: "link", token: link[1], chatId };
  return { action: "ignore" };
}

export async function readTelegramWebhookBody(request: Request, maxBytes = 16384) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
