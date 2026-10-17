import { getDb, type Database } from "@/infrastructure/db/client";
import {
  recordNotificationDeliveryStatus,
  type NotificationDeliveryUpdate,
} from "@/modules/notifications";

export async function processWhatsAppDeliveryStatuses(options: {
  updates: NotificationDeliveryUpdate[];
  database?: Database;
}) {
  const database = options.database ?? getDb();

  return database.transaction(async (tx) => {
    let updated = 0;
    let ignored = 0;
    let unmatched = 0;

    for (const update of options.updates) {
      const result = await recordNotificationDeliveryStatus(tx, update);
      if (result === "updated") updated += 1;
      else if (result === "ignored") ignored += 1;
      else unmatched += 1;
    }

    return { received: options.updates.length, updated, ignored, unmatched };
  });
}
