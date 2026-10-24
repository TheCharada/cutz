import { logger } from "@/infrastructure/logging/logger";
import {
  parseTelegramWebhookCommand,
  readTelegramWebhookBody,
  verifyTelegramWebhookSecret,
} from "@/infrastructure/messaging/telegram-webhook";
import { disableTelegramChat, redeemTelegramLink } from "@/workflows/telegram-link";

export const dynamic = "force-dynamic";

function botResponse(chatId: string, text: string) {
  // Telegram accepts an outgoing Bot API method as the webhook JSON response.
  // This does not confirm delivery, so it is not persisted as a notification.
  return Response.json(
    { method: "sendMessage", chat_id: chatId, text },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return new Response(null, { status: 503 });
  if (!verifyTelegramWebhookSecret(
    request.headers.get("x-telegram-bot-api-secret-token"),
    secret,
  )) {
    return new Response(null, { status: 401 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return new Response(null, { status: 415 });
  }

  let command: ReturnType<typeof parseTelegramWebhookCommand>;
  try {
    const rawBody = await readTelegramWebhookBody(request);
    if (rawBody === null) return new Response(null, { status: 413 });
    command = parseTelegramWebhookCommand(rawBody);
  } catch {
    return new Response(null, { status: 400 });
  }

  if (command.action === "ignore") return new Response(null, { status: 200 });

  try {
    if (command.action === "stop") {
      await disableTelegramChat(command.chatId);
      return botResponse(command.chatId, "As notificações do Cutz foram desativadas neste chat.");
    }
    const result = await redeemTelegramLink(command);
    return botResponse(
      command.chatId,
      result === "linked"
        ? "Telegram vinculado a este agendamento ou entrada na lista de espera."
        : "Não foi possível vincular. Gere um novo link pelo Cutz.",
    );
  } catch (error) {
    logger.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Telegram webhook persistence failed",
    );
    return new Response(null, { status: 500 });
  }
}
