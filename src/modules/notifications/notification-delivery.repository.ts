import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { DbExecutor } from "@/infrastructure/db/executor";
import { notificationJobs } from "@/infrastructure/db/schema";

export const notificationDeliveryStatuses = [
  "ACCEPTED",
  "SENT",
  "DELIVERED",
  "READ",
  "FAILED",
  "DELETED",
] as const;

export type NotificationDeliveryStatus = (typeof notificationDeliveryStatuses)[number];

export type NotificationDeliveryUpdate = {
  providerMessageId: string;
  status: Exclude<NotificationDeliveryStatus, "ACCEPTED">;
  occurredAt: Date;
  errorCode?: number;
  errorMessage?: string;
};

const deliveryStatusRank: Record<NotificationDeliveryStatus, number> = {
  ACCEPTED: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  FAILED: 4,
  DELETED: 5,
};

function currentDeliveryStatusRankSql() {
  return sql<number>`case ${notificationJobs.deliveryStatus}::text
    when 'ACCEPTED' then 0
    when 'SENT' then 1
    when 'DELIVERED' then 2
    when 'READ' then 3
    when 'FAILED' then 4
    when 'DELETED' then 5
    else -1
  end`;
}

export async function applyNotificationDeliveryUpdate(
  executor: DbExecutor,
  update: NotificationDeliveryUpdate,
): Promise<"updated" | "ignored" | "unmatched"> {
  const incomingRank = deliveryStatusRank[update.status];
  const [changed] = await executor
    .update(notificationJobs)
    .set({
      deliveryStatus: update.status,
      deliveryStatusAt: update.occurredAt,
      deliveryErrorCode: update.status === "FAILED" ? (update.errorCode ?? null) : null,
      deliveryErrorMessage: update.status === "FAILED" ? (update.errorMessage ?? null) : null,
    })
    .where(
      and(
        eq(notificationJobs.providerMessageId, update.providerMessageId),
        or(
          isNull(notificationJobs.deliveryStatusAt),
          lt(notificationJobs.deliveryStatusAt, update.occurredAt),
          and(
            eq(notificationJobs.deliveryStatusAt, update.occurredAt),
            sql`${currentDeliveryStatusRankSql()} < ${incomingRank}`,
          ),
        ),
      ),
    )
    .returning({ id: notificationJobs.id });

  if (changed) return "updated";

  const [matched] = await executor
    .select({ id: notificationJobs.id })
    .from(notificationJobs)
    .where(eq(notificationJobs.providerMessageId, update.providerMessageId))
    .limit(1);

  return matched ? "ignored" : "unmatched";
}
