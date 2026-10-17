import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "@/infrastructure/db/executor";
import { notificationJobs } from "@/infrastructure/db/schema";

export type NotificationJobInput = {
  barbershopId: string;
  type:
    | "APPOINTMENT_CREATED"
    | "APPOINTMENT_RESCHEDULED"
    | "APPOINTMENT_REMINDER"
    | "APPOINTMENT_CANCELLED"
    | "WAITLIST_ENTRY_CREATED"
    | "WAITLIST_OFFER"
    | "CUSTOMER_OTP";
  phoneE164: string;
  payload: Record<string, unknown>;
  appointmentId?: string;
  waitlistEntryId?: string;
  waitlistOfferId?: string;
  otpChallengeId?: string;
  dedupeKey: string;
  scheduledAt: Date;
};

export function insertNotificationJobs(executor: DbExecutor, jobs: NotificationJobInput[]) {
  return executor
    .insert(notificationJobs)
    .values(jobs)
    .onConflictDoNothing({ target: notificationJobs.dedupeKey })
    .returning({
      id: notificationJobs.id,
      type: notificationJobs.type,
      scheduledAt: notificationJobs.scheduledAt,
    });
}

export function cancelPendingAppointmentReminder(
  executor: DbExecutor,
  params: { barbershopId: string; appointmentId: string },
) {
  return executor
    .update(notificationJobs)
    .set({ status: "CANCELLED" })
    .where(
      and(
        eq(notificationJobs.barbershopId, params.barbershopId),
        eq(notificationJobs.appointmentId, params.appointmentId),
        eq(notificationJobs.type, "APPOINTMENT_REMINDER"),
        eq(notificationJobs.status, "PENDING"),
      ),
    );
}
