import type { NotificationPayload } from "@/modules/notifications";
import { MessagingProviderError } from "@/modules/notifications";

type TelegramNotification = {
  chatId: string;
  timeZone: string;
  payload: NotificationPayload;
};

type TelegramResponse = {
  ok?: boolean;
  result?: { message_id?: number };
  parameters?: { retry_after?: number };
};

type TelegramMessage = {
  text: string;
  action?: { label: string; url: string };
};

function label(value: string) {
  // Telegram receives plain text, not HTML or Markdown; keep untrusted fields bounded.
  return value.trim().slice(0, 160);
}

function localDateTime(instant: string, timeZone: string) {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) {
    throw new MessagingProviderError("Telegram notification timestamp is invalid", {
      retryable: false,
    });
  }
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(date);
  } catch {
    throw new MessagingProviderError("Telegram notification timezone is invalid", {
      retryable: false,
    });
  }
}

function safeActionUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") return parsed.toString();
  } catch {
    // The job payload may come from older or corrupted persisted data.
  }
  throw new MessagingProviderError("Telegram notification action URL is invalid", {
    retryable: false,
  });
}

export function formatTelegramMessage(
  payload: NotificationPayload,
  timeZone: string,
): TelegramMessage {
  switch (payload.type) {
    case "APPOINTMENT_CREATED":
      return {
        text: [
          "Agendamento confirmado",
          `Cliente: ${label(payload.customerName)}`,
          `Serviço: ${label(payload.serviceName)}`,
          `Profissional: ${label(payload.staffName)}`,
          `Quando: ${localDateTime(payload.startsAt, timeZone)}`,
        ].join("\n"),
        action: { label: "Gerenciar agendamento", url: safeActionUrl(payload.managementUrl) },
      };
    case "APPOINTMENT_RESCHEDULED":
      return {
        text: [
          "Agendamento reagendado",
          `Cliente: ${label(payload.customerName)}`,
          `Serviço: ${label(payload.serviceName)}`,
          `Profissional: ${label(payload.staffName)}`,
          `Novo horário: ${localDateTime(payload.startsAt, timeZone)}`,
        ].join("\n"),
        action: { label: "Gerenciar agendamento", url: safeActionUrl(payload.managementUrl) },
      };
    case "APPOINTMENT_REMINDER":
      return {
        text: [
          "Lembrete de agendamento",
          `Cliente: ${label(payload.customerName)}`,
          `Serviço: ${label(payload.serviceName)}`,
          `Profissional: ${label(payload.staffName)}`,
          `Quando: ${localDateTime(payload.startsAt, timeZone)}`,
        ].join("\n"),
      };
    case "APPOINTMENT_CANCELLED":
      return {
        text: [
          "Agendamento cancelado",
          `Cliente: ${label(payload.customerName)}`,
          `Serviço: ${label(payload.serviceName)}`,
          `Profissional: ${label(payload.staffName)}`,
          `Horário: ${localDateTime(payload.startsAt, timeZone)}`,
          ...(payload.reason ? [`Motivo: ${label(payload.reason)}`] : []),
        ].join("\n"),
      };
    case "WAITLIST_ENTRY_CREATED":
      return {
        text: [
          "Entrada na lista de espera confirmada",
          `Cliente: ${label(payload.customerName)}`,
          `Serviço: ${label(payload.serviceName)}`,
          `Data: ${label(payload.desiredDate)}`,
          `Período: ${label(payload.earliestTime)}–${label(payload.latestTime)}`,
        ].join("\n"),
        action: { label: "Gerenciar lista de espera", url: safeActionUrl(payload.managementUrl) },
      };
    case "WAITLIST_OFFER":
      return {
        text: [
          "Um horário ficou disponível",
          `Cliente: ${label(payload.customerName)}`,
          `Serviço: ${label(payload.serviceName)}`,
          `Profissional: ${label(payload.staffName)}`,
          `Horário: ${localDateTime(payload.startsAt, timeZone)}`,
          `Oferta válida até: ${localDateTime(payload.expiresAt, timeZone)}`,
        ].join("\n"),
        action: { label: "Aceitar ou recusar vaga", url: safeActionUrl(payload.actionUrl) },
      };
    case "CUSTOMER_OTP":
      // Telegram chat binding cannot establish ownership of a phone number.
      throw new MessagingProviderError("Telegram is not a phone verification channel", {
        retryable: false,
      });
  }
}

export class TelegramMessagingProvider {
  constructor(
    private readonly botToken: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    if (!botToken.trim()) throw new Error("Telegram bot token is required");
  }

  async send(
    notification: TelegramNotification,
    options: { signal: AbortSignal },
  ): Promise<{ providerMessageId: string }> {
    if (!/^\d{1,20}$/.test(notification.chatId)) {
      throw new MessagingProviderError("Telegram chat is invalid", { retryable: false });
    }
    const message = formatTelegramMessage(notification.payload, notification.timeZone);
    const body = {
      chat_id: notification.chatId,
      text: message.text,
      link_preview_options: { is_disabled: true },
      ...(message.action
        ? {
            reply_markup: {
              inline_keyboard: [[{ text: message.action.label, url: message.action.url }]],
            },
          }
        : {}),
    };

    let response: Response;
    try {
      response = await this.fetchFn(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: options.signal,
      });
    } catch (cause) {
      throw new MessagingProviderError("Telegram request failed", { retryable: true, cause });
    }

    // Avoid reflecting provider responses, which can contain sensitive identifiers.
    if (!response.ok) {
      let retryAfterMs: number | undefined;
      if (response.status === 429) {
        const details = (await response.json().catch(() => null)) as TelegramResponse | null;
        const seconds = details?.parameters?.retry_after;
        if (typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0) {
          retryAfterMs = seconds * 1000;
        }
      }
      throw new MessagingProviderError(`Telegram request failed with status ${response.status}`, {
        retryable: response.status === 429 || response.status >= 500,
        statusCode: response.status,
        retryAfterMs,
      });
    }

    const result = (await response.json().catch(() => null)) as TelegramResponse | null;
    const messageId = result?.result?.message_id;
    if (result?.ok !== true || !Number.isSafeInteger(messageId) || !messageId || messageId < 1) {
      throw new MessagingProviderError("Telegram response is invalid", { retryable: true });
    }

    // Telegram message_id is unique within a chat, not across all bot chats.
    return { providerMessageId: `telegram:${notification.chatId}:${messageId}` };
  }
}
