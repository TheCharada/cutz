import type { DbExecutor } from "@/infrastructure/db/executor";
import {
  cancelPendingAppointmentReminder as cancelPendingAppointmentReminderRow,
  insertNotificationJobs,
  type NotificationJobInput,
} from "./notification.repository";
import {
  appointmentCancelledPayloadSchema,
  appointmentCreatedPayloadSchema,
  appointmentReminderPayloadSchema,
  appointmentRescheduledPayloadSchema,
  customerOtpPayloadSchema,
  waitlistEntryCreatedPayloadSchema,
  waitlistOfferPayloadSchema,
  type AppointmentCancelledPayload,
  type AppointmentCreatedPayload,
  type AppointmentReminderPayload,
  type AppointmentRescheduledPayload,
  type CustomerOtpPayload,
  type WaitlistEntryCreatedPayload,
  type WaitlistOfferPayload,
} from "./payloads";

function reminderJob(params: {
  barbershopId: string;
  appointmentId: string;
  phoneE164: string;
  now: Date;
  startsAt: Date;
  reminderOffsetMinutes: number;
  payload: AppointmentReminderPayload;
}): NotificationJobInput | null {
  const reminderAt = new Date(params.startsAt.getTime() - params.reminderOffsetMinutes * 60_000);
  if (reminderAt <= params.now) {
    return null;
  }

  return {
    barbershopId: params.barbershopId,
    type: "APPOINTMENT_REMINDER",
    phoneE164: params.phoneE164,
    payload: appointmentReminderPayloadSchema.parse(params.payload),
    appointmentId: params.appointmentId,
    dedupeKey: `appointment:${params.appointmentId}:reminder`,
    scheduledAt: reminderAt,
  };
}

export function enqueueAppointmentNotifications(
  executor: DbExecutor,
  params: {
    barbershopId: string;
    appointmentId: string;
    phoneE164: string;
    now: Date;
    startsAt: Date;
    reminderOffsetMinutes: number;
    createdPayload: AppointmentCreatedPayload;
    reminderPayload: AppointmentReminderPayload;
  },
) {
  const jobs: NotificationJobInput[] = [
    {
      barbershopId: params.barbershopId,
      type: "APPOINTMENT_CREATED",
      phoneE164: params.phoneE164,
      payload: appointmentCreatedPayloadSchema.parse(params.createdPayload),
      appointmentId: params.appointmentId,
      dedupeKey: `appointment:${params.appointmentId}:created`,
      scheduledAt: params.now,
    },
  ];

  const reminder = reminderJob({ ...params, payload: params.reminderPayload });
  if (reminder) jobs.push(reminder);
  return insertNotificationJobs(executor, jobs);
}

export function cancelPendingAppointmentReminder(
  executor: DbExecutor,
  params: { barbershopId: string; appointmentId: string },
) {
  return cancelPendingAppointmentReminderRow(executor, params);
}

export function enqueueAppointmentCancelledNotification(
  executor: DbExecutor,
  params: {
    barbershopId: string;
    appointmentId: string;
    phoneE164: string;
    now: Date;
    payload: AppointmentCancelledPayload;
  },
) {
  return insertNotificationJobs(executor, [
    {
      barbershopId: params.barbershopId,
      type: "APPOINTMENT_CANCELLED",
      phoneE164: params.phoneE164,
      payload: appointmentCancelledPayloadSchema.parse(params.payload),
      appointmentId: params.appointmentId,
      dedupeKey: `appointment:${params.appointmentId}:cancelled`,
      scheduledAt: params.now,
    },
  ]);
}

export function enqueueAppointmentRescheduledNotifications(
  executor: DbExecutor,
  params: {
    barbershopId: string;
    appointmentId: string;
    phoneE164: string;
    now: Date;
    startsAt: Date;
    reminderOffsetMinutes: number;
    rescheduledPayload: AppointmentRescheduledPayload;
    reminderPayload: AppointmentReminderPayload;
  },
) {
  const jobs: NotificationJobInput[] = [
    {
      barbershopId: params.barbershopId,
      type: "APPOINTMENT_RESCHEDULED",
      phoneE164: params.phoneE164,
      payload: appointmentRescheduledPayloadSchema.parse(params.rescheduledPayload),
      appointmentId: params.appointmentId,
      dedupeKey: `appointment:${params.appointmentId}:rescheduled`,
      scheduledAt: params.now,
    },
  ];

  const reminder = reminderJob({ ...params, payload: params.reminderPayload });
  if (reminder) jobs.push(reminder);
  return insertNotificationJobs(executor, jobs);
}

export function enqueueWaitlistEntryCreatedNotification(
  executor: DbExecutor,
  params: {
    barbershopId: string;
    waitlistEntryId: string;
    phoneE164: string;
    now: Date;
    payload: WaitlistEntryCreatedPayload;
  },
) {
  return insertNotificationJobs(executor, [
    {
      barbershopId: params.barbershopId,
      type: "WAITLIST_ENTRY_CREATED",
      phoneE164: params.phoneE164,
      payload: waitlistEntryCreatedPayloadSchema.parse(params.payload),
      waitlistEntryId: params.waitlistEntryId,
      dedupeKey: `waitlist-entry:${params.waitlistEntryId}:created`,
      scheduledAt: params.now,
    },
  ]);
}

export function enqueueWaitlistOfferNotification(
  executor: DbExecutor,
  params: {
    barbershopId: string;
    waitlistEntryId: string;
    waitlistOfferId: string;
    phoneE164: string;
    now: Date;
    payload: WaitlistOfferPayload;
  },
) {
  return insertNotificationJobs(executor, [
    {
      barbershopId: params.barbershopId,
      type: "WAITLIST_OFFER",
      phoneE164: params.phoneE164,
      payload: waitlistOfferPayloadSchema.parse(params.payload),
      waitlistEntryId: params.waitlistEntryId,
      waitlistOfferId: params.waitlistOfferId,
      dedupeKey: `waitlist-offer:${params.waitlistOfferId}`,
      scheduledAt: params.now,
    },
  ]);
}

export function enqueueCustomerOtpNotification(
  executor: DbExecutor,
  params: {
    barbershopId: string;
    otpChallengeId: string;
    phoneE164: string;
    now: Date;
    payload: CustomerOtpPayload;
  },
) {
  return insertNotificationJobs(executor, [
    {
      barbershopId: params.barbershopId,
      type: "CUSTOMER_OTP",
      phoneE164: params.phoneE164,
      payload: customerOtpPayloadSchema.parse(params.payload),
      otpChallengeId: params.otpChallengeId,
      dedupeKey: `customer-otp:${params.otpChallengeId}`,
      scheduledAt: params.now,
    },
  ]);
}
