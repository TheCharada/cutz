import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "password",
      "token",
      "code",
      "payload.actionUrl",
      "payload.managementUrl",
      "payload.code",
    ],
    censor: "[redacted]",
  },
});
