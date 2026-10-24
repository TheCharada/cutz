import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@/infrastructure/db/client";
import { telegramChatLinks } from "@/infrastructure/db/schema";
import {
  MessagingProviderError,
  MessagingRecipientUnavailableError,
  type MessagingProvider,
  type MessagingSendResult,
  type OutboundNotification,
} from "@/modules/notifications";
import { disableTelegramChat } from "@/workflows/telegram-link";
import { TelegramMessagingProvider } from "./telegram-messaging-provider";

type Sender = Pick<TelegramMessagingProvider, "send">;

/**
 * The phone number on the queued job is never used to identify a Telegram chat.
 * Only an active link for this exact tenant and resource can authorize delivery.
 */
export class TelegramJobMessagingProvider implements MessagingProvider {
  constructor(
    private readonly database: Database,
    private readonly transport: Sender,
  ) {}

  async send(
    notification: OutboundNotification,
    options: { signal: AbortSignal },
  ): Promise<MessagingSendResult> {
    // A Telegram account is not evidence of ownership of a telephone number.
    if (notification.type === "CUSTOMER_OTP") {
      throw new MessagingProviderError("Telegram cannot verify a phone number", {
        retryable: false,
      });
    }

    if (!notification.barbershopId) throw new MessagingRecipientUnavailableError();

    const lookup =
      notification.type === "WAITLIST_OFFER" || notification.type === "WAITLIST_ENTRY_CREATED"
        ? notification.waitlistEntryId
          ? eq(telegramChatLinks.waitlistEntryId, notification.waitlistEntryId)
          : null
        : notification.appointmentId
          ? eq(telegramChatLinks.appointmentId, notification.appointmentId)
          : null;

    if (!lookup) throw new MessagingRecipientUnavailableError();

    const [link] = await this.database
      .select({ chatId: telegramChatLinks.chatId })
      .from(telegramChatLinks)
      .where(and(
        eq(telegramChatLinks.barbershopId, notification.barbershopId),
        lookup,
        isNull(telegramChatLinks.revokedAt),
      ))
      .limit(1);

    if (!link) throw new MessagingRecipientUnavailableError();

    try {
      return await this.transport.send(
        { chatId: link.chatId, timeZone: notification.timeZone, payload: notification.payload },
        options,
      );
    } catch (error) {
      if (error instanceof MessagingProviderError && error.statusCode === 403) {
        // Telegram no longer permits sending to this chat; do not retry it.
        await disableTelegramChat(link.chatId, { database: this.database });
      }
      throw error;
    }
  }
}
