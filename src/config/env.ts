import { z } from "zod";

export const databaseEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
});

export const commonEnvSchema = databaseEnvSchema.extend({
  APP_ORIGIN: z.url(),
  DEFAULT_PHONE_COUNTRY: z.string().length(2).default("BR"),
  OTP_SECRET: z.string().min(32),
});

export function getDatabaseEnv() {
  return databaseEnvSchema.parse(process.env);
}

export function getCommonEnv() {
  return commonEnvSchema.parse(process.env);
}
