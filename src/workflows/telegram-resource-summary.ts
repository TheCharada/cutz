import { and, eq, isNull } from "drizzle-orm";
import { getDb, type Database } from "@/infrastructure/db/client";
import {
  appointments, barbershops, services, staffMembers,
  telegramChatLinks, telegramLinkTokens, waitlistEntries,
} from "@/infrastructure/db/schema";
import { hashOpaqueToken } from "@/shared/tokens";

/** Confirm the linked booking without disclosing a management capability URL. */
export async function describeTelegramResource(
  token: string,
  chatId: string,
  database: Database = getDb(),
): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !/^\d{1,20}$/.test(chatId)) return null;
  const [link] = await database.select().from(telegramLinkTokens)
    .where(eq(telegramLinkTokens.tokenHash, hashOpaqueToken(token))).limit(1);
  if (!link?.consumedAt) return null;
  const scope = link.appointmentId
    ? eq(telegramChatLinks.appointmentId, link.appointmentId)
    : link.waitlistEntryId
      ? eq(telegramChatLinks.waitlistEntryId, link.waitlistEntryId)
      : null;
  if (!scope) return null;
  const [bound] = await database.select({ id: telegramChatLinks.id })
    .from(telegramChatLinks)
    .where(and(eq(telegramChatLinks.barbershopId, link.barbershopId),
      eq(telegramChatLinks.chatId, chatId), scope, isNull(telegramChatLinks.revokedAt)))
    .limit(1);
  if (!bound) return null;

  if (link.appointmentId) {
    const [record] = await database.select({
      startsAt: appointments.startsAt,
      serviceName: services.name,
      staffName: staffMembers.name,
      timezone: barbershops.timezone,
    }).from(appointments)
      .innerJoin(services, eq(appointments.serviceId, services.id))
      .innerJoin(staffMembers, eq(appointments.staffId, staffMembers.id))
      .innerJoin(barbershops, eq(appointments.barbershopId, barbershops.id))
      .where(and(eq(appointments.barbershopId, link.barbershopId),
        eq(appointments.id, link.appointmentId))).limit(1);
    if (!record) return null;
    const when = new Intl.DateTimeFormat("pt-BR", {
      timeZone: record.timezone, dateStyle: "short", timeStyle: "short",
    }).format(record.startsAt);
    return `Agendamento confirmado: ${record.serviceName.slice(0, 120)} com ${record.staffName.slice(0, 120)}, em ${when}.`;
  }
  const [entry] = await database.select({
    desiredDate: waitlistEntries.desiredDate,
    serviceName: services.name,
  }).from(waitlistEntries)
    .innerJoin(services, eq(waitlistEntries.serviceId, services.id))
    .where(and(eq(waitlistEntries.barbershopId, link.barbershopId),
      eq(waitlistEntries.id, link.waitlistEntryId!))).limit(1);
  return entry
    ? `Lista de espera vinculada: ${entry.serviceName.slice(0, 120)} para ${entry.desiredDate}.`
    : null;
}
