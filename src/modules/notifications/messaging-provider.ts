import type { NotificationPayload } from "./payloads";

export type OutboundNotification = {
  jobId: string;
  barbershopId?: string;
  appointmentId?: string | null;
  waitlistEntryId?: string | null;
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
  readonly statusCode?: number;

  constructor(
    message: string,
    options: { retryable: boolean; retryAfterMs?: number; statusCode?: number; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = "MessagingProviderError";
    this.retryable = options.retryable;
    this.retryAfterMs = options.retryAfterMs;
    this.statusCode = options.statusCode;
  }
}

/** The selected channel has no authorized destination for this job. */
export class MessagingRecipientUnavailableError extends Error {
  constructor() {
    super("No authorized messaging destination");
    this.name = "MessagingRecipientUnavailableError";
  }
}
