import type {
  MessagingProvider,
  MessagingSendResult,
  OutboundNotification,
} from "@/modules/notifications";

export type FakeMessagingRenderer = (notification: OutboundNotification) => void | Promise<void>;

export class FakeMessagingProvider implements MessagingProvider {
  constructor(private readonly render?: FakeMessagingRenderer) {}

  async send(
    notification: OutboundNotification,
    options: { signal: AbortSignal },
  ): Promise<MessagingSendResult> {
    if (options.signal.aborted) {
      throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    }

    await this.render?.(notification);

    if (options.signal.aborted) {
      throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    }

    return { providerMessageId: `fake:${notification.jobId}` };
  }
}
