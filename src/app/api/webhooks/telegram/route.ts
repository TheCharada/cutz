import { logger } from "@/infrastructure/logging/logger";
import {
  parseTelegramWebhookCommand,
  readTelegramWebhookBody,
  verifyTelegramWebhookSecret,
} from "@/infrastructure/messaging/telegram-webhook";
import { disableTelegramChat, redeemTelegramLink, verifyTelegramContact } from "@/workflows/telegram-link";
import { describeTelegramResource } from "@/workflows/telegram-resource-summary";

export const dynamic = "force-dynamic";

function botResponse(chatId: string, text: string, replyMarkup?: Record<string, unknown>) {
  // Telegram accepts an outgoing Bot API method as the webhook JSON response.
  // This does not confirm delivery, so it is not persisted as a notification.
  return Response.json(
    { method: "sendMessage", chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) },
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
    if (command.action === "contact") {
      const result = await verifyTelegramContact({
        chatId: command.chatId,
        telegramUserId: command.telegramUserId,
        contactUserId: command.contactUserId,
        phoneNumber: command.phoneNumber,
      });
      return botResponse(
        command.chatId,
        result === "verified"
          ? "Pronto! Este Telegram receberá os próximos avisos dos seus agendamentos e listas de espera neste estabelecimento."
          : result === "mismatch"
            ? "O telefone compartilhado não corresponde ao cadastro. A vinculação permanece limitada ao agendamento ou lista de espera original."
            : "A confirmação expirou. Gere um novo link no Cutz para tentar novamente.",
        { remove_keyboard: true },
      );
    }

    const result = await redeemTelegramLink({ token: command.token, chatId: command.chatId });
    if (result !== "linked") {
      return botResponse(command.chatId, "Não foi possível vincular. Gere um novo link pelo Cutz.");
    }

    const summary = await describeTelegramResource(command.token, command.chatId);
    return botResponse(
      command.chatId,
      `${summary ?? "Agendamento ou lista de espera vinculado."}\n\nPara receber automaticamente avisos dos próximos agendamentos deste estabelecimento, compartilhe seu próprio telefone com o botão abaixo. É opcional: sem isso, os avisos ficam limitados a este registro.`,
      { keyboard: [[{ text: "Compartilhar meu telefone", request_contact: true }]],
        resize_keyboard: true, one_time_keyboard: true },
    );
  } catch (error) {
    logger.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Telegram webhook persistence failed",
    );
    return new Response(null, { status: 500 });
  }
}
