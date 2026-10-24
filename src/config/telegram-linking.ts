/** Only surface chat linking when both the bot address and webhook are configured. */
export function isTelegramLinkingEnabled() {
  const username = process.env.TELEGRAM_BOT_USERNAME;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  return !!username && /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(username) &&
    /bot$/i.test(username) && !!secret;
}
