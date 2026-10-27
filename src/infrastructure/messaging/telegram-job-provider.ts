import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@/infrastructure/db/client";
import { appointments, telegramChatLinks, telegramCustomerLinks, waitlistEntries } from "@/infrastructure/db/schema";
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
 * An active, phone-verified customer subscription covers future resources.
 * Without that proof, only the exact resource capability can authorize delivery.
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

    const customerSource = notification.type === "WAITLIST_OFFER" ||
      notification.type === "WAITLIST_ENTRY_CREATED"
      ? waitlistEntries
      : appointments;
    // Do not resolve recipients by phone: a customer record can be reused by
    // unverified browser sessions. Subscriptions require Telegram phone proof.
    const [customer] = customerSource === appointments && notification.appointmentId
      ? await this.database.select({ customerId: appointments.customerId })
          .from(appointments).where(and(
            eq(appointments.barbershopId, notification.barbershopId),
            eq(appointments.id, notification.appointmentId),
          )).limit(1)
      : notification.waitlistEntryId
        ? await this.database.select({ customerId: waitlistEntries.customerId })
            .from(waitlistEntries).where(and(
              eq(waitlistEntries.barbershopId, notification.barbershopId),
              eq(waitlistEntries.id, notification.waitlistEntryId),
            )).limit(1)
        : [];

    if (!customer) throw new MessagingRecipientUnavailableError();
    const [subscription] = await this.database
      .select({ chatId: telegramCustomerLinks.chatId })
      .from(telegramCustomerLinks)
      .where(and(
        eq(telegramCustomerLinks.barbershopId, notification.barbershopId),
        eq(telegramCustomerLinks.customerId, customer.customerId),
        isNull(telegramCustomerLinks.revokedAt),
      )).limit(1);

    let chatId = subscription?.chatId;
    if (!chatId) {
      const [link] = await this.database
        .select({ chatId: telegramChatLinks.chatId })
        .from(telegramChatLinks)
        .where(and(
          eq(telegramChatLinks.barbershopId, notification.barbershopId),
          lookup,
          isNull(telegramChatLinks.revokedAt),
        ))
        .limit(1);
      chatId = link?.chatId;
    }
    if (!chatId) throw new MessagingRecipientUnavailableError();

    try {
      return await this.transport.send(
        { chatId, timeZone: notification.timeZone, payload: notification.payload },
        options,
      );
    } catch (error) {
      if (error instanceof MessagingProviderError && error.statusCode === 403) {
        await disableTelegramChat(chatId, { database: this.database });
      }
      throw error;
    }
  }
}
