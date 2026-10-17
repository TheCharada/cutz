import type { NotificationPayload } from "./payloads";

export type OutboundNotification = {
  jobId: string;
  type: NotificationPayload["type"];
  toE164: string;
  timeZone: string;
  payload: NotificationPayload;
  idempotencyKey: string;
};

export type MessagingSendResult = {
  providerMessageId?: string;
};

export interface MessagingProvider {
  send(
    notification: OutboundNotification,
    options: { signal: AbortSignal },
  ): Promise<MessagingSendResult>;
}

export class MessagingProviderError extends Error {
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    options: { retryable: boolean; retryAfterMs?: number; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = "MessagingProviderError";
    this.retryable = options.retryable;
    this.retryAfterMs = options.retryAfterMs;
  }
}
