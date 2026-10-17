import type { DbExecutor } from "@/infrastructure/db/executor";
import {
  applyNotificationDeliveryUpdate,
  notificationDeliveryStatuses,
  type NotificationDeliveryStatus,
  type NotificationDeliveryUpdate,
} from "./notification-delivery.repository";

export { notificationDeliveryStatuses };
export type { NotificationDeliveryStatus, NotificationDeliveryUpdate };

export function recordNotificationDeliveryStatus(
  executor: DbExecutor,
  update: NotificationDeliveryUpdate,
) {
  return applyNotificationDeliveryUpdate(executor, update);
}
