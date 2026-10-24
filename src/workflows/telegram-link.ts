import { and, eq, isNull } from "drizzle-orm";
import { getDb, type Database } from "@/infrastructure/db/client";
import { telegramChatLinks, telegramLinkTokens } from "@/infrastructure/db/schema";
import { getAppointmentByManagementTokenHash, getAppointmentById } from "@/modules/scheduling";
import { getWaitlistEntryById, getWaitlistEntryByManagementTokenHash } from "@/modules/waitlist";
import { createOpaqueToken, hashOpaqueToken } from "@/shared/tokens";

export const telegramLinkLifetimeMs = 10 * 60 * 1000;

type Scope = { barbershopId: string; appointmentId: string; waitlistEntryId?: never }
  | { barbershopId: string; appointmentId?: never; waitlistEntryId: string };

type LinkScopeKind = "appointment" | "waitlist";

function validBotUsername(name: string | undefined): name is string {
  return !!name && /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(name) && /bot$/i.test(name);
}

export async function issueTelegramLink(
  params: { scope: LinkScopeKind; capabilityToken: string },
  options: { database?: Database; botUsername?: string; now?: Date } = {},
) {
  const database = options.database ?? getDb();
  const botUsername = options.botUsername ?? process.env.TELEGRAM_BOT_USERNAME;
  if (!validBotUsername(botUsername)) return { status: "unavailable" as const };
  if (!/^[A-Za-z0-9_-]{43}$/.test(params.capabilityToken)) {
    return { status: "not-found" as const };
  }

  let scope: Scope;
  if (params.scope === "appointment") {
    const appointment = await getAppointmentByManagementTokenHash(
      database,
      hashOpaqueToken(params.capabilityToken),
    );
    if (!appointment) return { status: "not-found" as const };
    if (appointment.status !== "SCHEDULED") return { status: "not-active" as const };
    scope = { barbershopId: appointment.barbershopId, appointmentId: appointment.id };
  } else {
    const entry = await getWaitlistEntryByManagementTokenHash(
      database,
      hashOpaqueToken(params.capabilityToken),
    );
    if (!entry) return { status: "not-found" as const };
    if (entry.status !== "ACTIVE") return { status: "not-active" as const };
    scope = { barbershopId: entry.barbershopId, waitlistEntryId: entry.id };
  }

  const token = createOpaqueToken();
  const now = options.now ?? new Date();
  const expiresAt = new Date(now.getTime() + telegramLinkLifetimeMs);
  await database.insert(telegramLinkTokens).values({
    barbershopId: scope.barbershopId,
    appointmentId: scope.appointmentId ?? null,
    waitlistEntryId: scope.waitlistEntryId ?? null,
    tokenHash: hashOpaqueToken(token),
    expiresAt,
  });

  return {
    status: "ok" as const,
    url: `https://t.me/${botUsername}?start=${token}`,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function redeemTelegramLink(
  params: { token: string; chatId: string },
  options: { database?: Database; now?: Date } = {},
): Promise<"linked" | "invalid"> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(params.token) || !/^\d{1,20}$/.test(params.chatId)) {
    return "invalid";
  }

  const database = options.database ?? getDb();
  const now = options.now ?? new Date();
  return database.transaction(async (tx) => {
    const [link] = await tx
      .select()
      .from(telegramLinkTokens)
      .where(eq(telegramLinkTokens.tokenHash, hashOpaqueToken(params.token)))
      .for("update")
      .limit(1);
    if (!link || link.consumedAt || link.expiresAt <= now) return "invalid";

    if (link.appointmentId) {
      const appointment = await getAppointmentById(tx, link.barbershopId, link.appointmentId);
      if (!appointment || appointment.status !== "SCHEDULED") return "invalid";
      await tx.insert(telegramChatLinks).values({
        barbershopId: link.barbershopId,
        appointmentId: link.appointmentId,
        chatId: params.chatId,
      }).onConflictDoUpdate({
        target: telegramChatLinks.appointmentId,
        set: { chatId: params.chatId, revokedAt: null, updatedAt: now },
      });
    } else if (link.waitlistEntryId) {
      const entry = await getWaitlistEntryById(tx, link.barbershopId, link.waitlistEntryId);
      if (!entry || entry.status !== "ACTIVE") return "invalid";
      await tx.insert(telegramChatLinks).values({
        barbershopId: link.barbershopId,
        waitlistEntryId: link.waitlistEntryId,
        chatId: params.chatId,
      }).onConflictDoUpdate({
        target: telegramChatLinks.waitlistEntryId,
        set: { chatId: params.chatId, revokedAt: null, updatedAt: now },
      });
    } else {
      return "invalid";
    }

    await tx.update(telegramLinkTokens)
      .set({ consumedAt: now })
      .where(eq(telegramLinkTokens.id, link.id));

    return "linked";
  });
}

export async function disableTelegramChat(
  chatId: string,
  options: { database?: Database; now?: Date } = {},
) {
  if (!/^\d{1,20}$/.test(chatId)) return 0;
  const database = options.database ?? getDb();
  const rows = await database
    .update(telegramChatLinks)
    .set({ revokedAt: options.now ?? new Date(), updatedAt: options.now ?? new Date() })
    .where(and(eq(telegramChatLinks.chatId, chatId), isNull(telegramChatLinks.revokedAt)))
    .returning({ id: telegramChatLinks.id });
  return rows.length;
}
