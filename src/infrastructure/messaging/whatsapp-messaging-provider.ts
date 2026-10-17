import {
  MessagingProviderError,
  type MessagingProvider,
  type MessagingSendResult,
  type OutboundNotification,
} from "@/modules/notifications";

export type WhatsAppTemplateMap = Record<OutboundNotification["type"], string>;

export type WhatsAppMessagingProviderConfig = {
  accessToken: string;
  phoneNumberId: string;
  graphApiVersion: string;
  templateLanguage: string;
  templates: WhatsAppTemplateMap;
  appOrigin: string;
  graphBaseUrl?: string;
};

type FetchLike = typeof fetch;

type MetaSendResponse = {
  messages?: Array<{ id?: string }>;
};

type MetaTextParameter = { type: "text"; text: string };
type MetaTemplateComponent =
  | { type: "body"; parameters: MetaTextParameter[] }
  | {
      type: "button";
      sub_type: "url";
      index: "0";
      parameters: MetaTextParameter[];
    };

const dateTimeFormatterCache = new Map<string, Intl.DateTimeFormat>();

function destination(phoneE164: string) {
  return phoneE164.startsWith("+") ? phoneE164.slice(1) : phoneE164;
}

function retryAfterMs(response: Response) {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return undefined;
  return Math.max(0, instant - Date.now());
}

function text(value: string): MetaTextParameter {
  return { type: "text", text: value };
}

function body(...values: string[]): MetaTemplateComponent {
  return { type: "body", parameters: values.map(text) };
}

function button(value: string): MetaTemplateComponent {
  return {
    type: "button",
    sub_type: "url",
    index: "0",
    parameters: [text(value)],
  };
}

function dateTimeFormatter(timeZone: string) {
  const cached = dateTimeFormatterCache.get(timeZone);
  if (cached) return cached;

  try {
    const formatter = new Intl.DateTimeFormat("pt-BR", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    dateTimeFormatterCache.set(timeZone, formatter);
    return formatter;
  } catch (error) {
    throw new MessagingProviderError("WhatsApp notification timezone is invalid", {
      retryable: false,
      cause: error,
    });
  }
}

function localDateTime(value: string, timeZone: string) {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw new MessagingProviderError("WhatsApp notification timestamp is invalid", {
      retryable: false,
    });
  }

  const parts = dateTimeFormatter(timeZone).formatToParts(instant);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const day = values.get("day");
  const month = values.get("month");
  const year = values.get("year");
  const hour = values.get("hour");
  const minute = values.get("minute");

  if (!day || !month || !year || !hour || !minute) {
    throw new MessagingProviderError("WhatsApp notification timestamp could not be formatted", {
      retryable: false,
    });
  }

  return `${day}/${month}/${year} às ${hour}:${minute}`;
}

function localDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new MessagingProviderError("WhatsApp notification local date is invalid", {
      retryable: false,
    });
  }
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function dynamicUrlSuffix(url: string, appOrigin: string) {
  const target = new URL(url);
  const base = new URL(appOrigin);

  if (target.origin !== base.origin) {
    throw new MessagingProviderError("WhatsApp action URL is outside APP_ORIGIN", {
      retryable: false,
    });
  }

  const basePath = base.pathname.replace(/\/+$/, "");
  if (
    basePath &&
    target.pathname !== basePath &&
    !target.pathname.startsWith(`${basePath}/`)
  ) {
    throw new MessagingProviderError("WhatsApp action URL is outside APP_ORIGIN path", {
      retryable: false,
    });
  }

  const relativePath = target.pathname.slice(basePath.length).replace(/^\/+/, "");
  const suffix = `${relativePath}${target.search}${target.hash}`;
  if (!suffix) {
    throw new MessagingProviderError("WhatsApp action URL does not contain a dynamic path", {
      retryable: false,
    });
  }
  return suffix;
}

function actionUrlButton(url: string, appOrigin: string): MetaTemplateComponent {
  return button(dynamicUrlSuffix(url, appOrigin));
}

function templateComponents(
  notification: OutboundNotification,
  appOrigin: string,
): MetaTemplateComponent[] {
  const payload = notification.payload;
  const timeZone = notification.timeZone;

  switch (payload.type) {
    case "APPOINTMENT_CREATED":
      return [
        body(
          payload.customerName,
          payload.serviceName,
          payload.staffName,
          localDateTime(payload.startsAt, timeZone),
        ),
        actionUrlButton(payload.managementUrl, appOrigin),
      ];
    case "APPOINTMENT_RESCHEDULED":
      return [
        body(
          payload.customerName,
          payload.serviceName,
          payload.staffName,
          localDateTime(payload.startsAt, timeZone),
        ),
        actionUrlButton(payload.managementUrl, appOrigin),
      ];
    case "APPOINTMENT_REMINDER":
      return [
        body(
          payload.customerName,
          payload.serviceName,
          payload.staffName,
          localDateTime(payload.startsAt, timeZone),
        ),
      ];
    case "APPOINTMENT_CANCELLED":
      return [
        body(
          payload.customerName,
          payload.serviceName,
          payload.staffName,
          localDateTime(payload.startsAt, timeZone),
          payload.reason ?? "Não informado",
        ),
      ];
    case "WAITLIST_ENTRY_CREATED":
      return [
        body(
          payload.customerName,
          payload.serviceName,
          localDate(payload.desiredDate),
          payload.earliestTime,
          payload.latestTime,
        ),
        actionUrlButton(payload.managementUrl, appOrigin),
      ];
    case "WAITLIST_OFFER":
      return [
        body(
          payload.customerName,
          payload.serviceName,
          payload.staffName,
          localDateTime(payload.startsAt, timeZone),
          localDateTime(payload.endsAt, timeZone),
          localDateTime(payload.expiresAt, timeZone),
        ),
        actionUrlButton(payload.actionUrl, appOrigin),
      ];
    case "CUSTOMER_OTP":
      return [body(payload.code), button(payload.code)];
  }
}

export class WhatsAppMessagingProvider implements MessagingProvider {
  private readonly fetchFn: FetchLike;
  private readonly endpoint: string;

  constructor(
    private readonly config: WhatsAppMessagingProviderConfig,
    options: { fetchFn?: FetchLike } = {},
  ) {
    this.fetchFn = options.fetchFn ?? fetch;
    const base = (config.graphBaseUrl ?? "https://graph.facebook.com").replace(/\/$/, "");
    this.endpoint = `${base}/${config.graphApiVersion}/${config.phoneNumberId}/messages`;
  }

  async send(
    notification: OutboundNotification,
    options: { signal: AbortSignal },
  ): Promise<MessagingSendResult> {
    const templateName = this.config.templates[notification.type];
    if (!templateName) {
      throw new MessagingProviderError("WhatsApp template is not configured", { retryable: false });
    }

    const components = templateComponents(notification, this.config.appOrigin);

    let response: Response;
    try {
      response = await this.fetchFn(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: destination(notification.toE164),
          type: "template",
          template: {
            name: templateName,
            language: { code: this.config.templateLanguage },
            components,
          },
        }),
        signal: options.signal,
      });
    } catch (error) {
      if (error instanceof MessagingProviderError) throw error;
      throw new MessagingProviderError("WhatsApp request failed", {
        retryable: true,
        cause: error,
      });
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw new MessagingProviderError(`WhatsApp request failed with status ${response.status}`, {
        retryable,
        retryAfterMs: retryable ? retryAfterMs(response) : undefined,
      });
    }

    let responseBody: MetaSendResponse;
    try {
      responseBody = (await response.json()) as MetaSendResponse;
    } catch (error) {
      throw new MessagingProviderError("WhatsApp response was invalid", {
        retryable: true,
        cause: error,
      });
    }

    const providerMessageId = responseBody.messages?.[0]?.id;
    if (!providerMessageId) {
      throw new MessagingProviderError("WhatsApp response did not include a message id", {
        retryable: true,
      });
    }

    return { providerMessageId };
  }
}
