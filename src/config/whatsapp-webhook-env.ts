import { z } from "zod";

const whatsappWebhookEnvSchema = z.object({
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().min(16),
  WHATSAPP_APP_SECRET: z.string().min(1),
});

export function getWhatsAppWebhookEnv() {
  return whatsappWebhookEnvSchema.parse(process.env);
}
