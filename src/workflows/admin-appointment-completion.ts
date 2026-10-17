import { getDb, type Database } from "@/infrastructure/db/client";
import { lockStaffMembersForUpdate } from "@/modules/catalog";
import { cancelPendingAppointmentReminder } from "@/modules/notifications";
import {
  finishScheduledAppointmentInTransaction,
  getAppointmentById,
  lockAppointmentForUpdate,
} from "@/modules/scheduling";
import type { BarbershopContext } from "@/modules/barbershops";
import { SystemClock, type Clock } from "@/shared/clock";
import { localDateForInstant } from "@/shared/time";

const systemClock = new SystemClock();

function canCompleteAt(startsAt: Date, now: Date, timezone: string) {
  if (now >= startsAt) return true;
  return localDateForInstant(now, timezone) === localDateForInstant(startsAt, timezone);
}

export async function completeAdminAppointment(
  params: { barbershop: BarbershopContext; appointmentId: string },
  options: { database?: Database; clock?: Clock } = {},
) {
  const database = options.database ?? getDb();
  const now = (options.clock ?? systemClock).now();
  const visible = await getAppointmentById(database, params.barbershop.id, params.appointmentId);
  if (!visible) return { status: "not-found" as const };
  if (
    visible.status !== "SCHEDULED" ||
    !canCompleteAt(visible.startsAt, now, params.barbershop.timezone)
  ) {
    return { status: "appointment-conflict" as const };
  }

  return database.transaction(async (tx) => {
    await lockStaffMembersForUpdate(tx, params.barbershop.id, [visible.staffId]);
    const appointment = await lockAppointmentForUpdate(tx, params.barbershop.id, params.appointmentId);
    if (!appointment) return { status: "not-found" as const };
    if (
      appointment.status !== "SCHEDULED" ||
      !canCompleteAt(appointment.startsAt, now, params.barbershop.timezone)
    ) {
      return { status: "appointment-conflict" as const };
    }

    const updated = await finishScheduledAppointmentInTransaction(tx, {
      barbershopId: params.barbershop.id,
      appointmentId: appointment.id,
      status: "COMPLETED",
      now,
    });
    if (!updated) return { status: "appointment-conflict" as const };

    await cancelPendingAppointmentReminder(tx, {
      barbershopId: params.barbershop.id,
      appointmentId: appointment.id,
    });
    return { status: "ok" as const, appointment: updated };
  });
}
