import { z } from "zod";

export const appointmentCreatedPayloadSchema = z
  .object({
    type: z.literal("APPOINTMENT_CREATED"),
    appointmentId: z.string().uuid(),
    customerName: z.string().min(1),
    serviceName: z.string().min(1),
    staffName: z.string().min(1),
    startsAt: z.string().datetime(),
    managementUrl: z.string().url(),
  })
  .strict();

export const appointmentRescheduledPayloadSchema = z
  .object({
    type: z.literal("APPOINTMENT_RESCHEDULED"),
    appointmentId: z.string().uuid(),
    previousAppointmentId: z.string().uuid(),
    customerName: z.string().min(1),
    serviceName: z.string().min(1),
    staffName: z.string().min(1),
    startsAt: z.string().datetime(),
    managementUrl: z.string().url(),
  })
  .strict();

export const appointmentReminderPayloadSchema = z
  .object({
    type: z.literal("APPOINTMENT_REMINDER"),
    appointmentId: z.string().uuid(),
    customerName: z.string().min(1),
    serviceName: z.string().min(1),
    staffName: z.string().min(1),
    startsAt: z.string().datetime(),
  })
  .strict();

export const appointmentCancelledPayloadSchema = z
  .object({
    type: z.literal("APPOINTMENT_CANCELLED"),
    appointmentId: z.string().uuid(),
    customerName: z.string().min(1),
    serviceName: z.string().min(1),
    staffName: z.string().min(1),
    startsAt: z.string().datetime(),
    reason: z.string().min(1).optional(),
  })
  .strict();

export const waitlistEntryCreatedPayloadSchema = z
  .object({
    type: z.literal("WAITLIST_ENTRY_CREATED"),
    waitlistEntryId: z.string().uuid(),
    customerName: z.string().min(1),
    serviceName: z.string().min(1),
    desiredDate: z.string(),
    earliestTime: z.string(),
    latestTime: z.string(),
    managementUrl: z.string().url(),
  })
  .strict();

export const waitlistOfferPayloadSchema = z
  .object({
    type: z.literal("WAITLIST_OFFER"),
    waitlistOfferId: z.string().uuid(),
    customerName: z.string().min(1),
    serviceName: z.string().min(1),
    staffName: z.string().min(1),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    actionUrl: z.string().url(),
  })
  .strict();

export const customerOtpPayloadSchema = z
  .object({
    type: z.literal("CUSTOMER_OTP"),
    otpChallengeId: z.string().uuid(),
    code: z.string().min(4).max(12),
    expiresAt: z.string().datetime(),
  })
  .strict();

export const notificationPayloadSchema = z.discriminatedUnion("type", [
  appointmentCreatedPayloadSchema,
  appointmentRescheduledPayloadSchema,
  appointmentReminderPayloadSchema,
  appointmentCancelledPayloadSchema,
  waitlistEntryCreatedPayloadSchema,
  waitlistOfferPayloadSchema,
  customerOtpPayloadSchema,
]);

export type AppointmentCreatedPayload = z.infer<typeof appointmentCreatedPayloadSchema>;
export type AppointmentRescheduledPayload = z.infer<typeof appointmentRescheduledPayloadSchema>;
export type AppointmentReminderPayload = z.infer<typeof appointmentReminderPayloadSchema>;
export type AppointmentCancelledPayload = z.infer<typeof appointmentCancelledPayloadSchema>;
export type WaitlistEntryCreatedPayload = z.infer<typeof waitlistEntryCreatedPayloadSchema>;
export type WaitlistOfferPayload = z.infer<typeof waitlistOfferPayloadSchema>;
export type CustomerOtpPayload = z.infer<typeof customerOtpPayloadSchema>;
export type NotificationPayload = z.infer<typeof notificationPayloadSchema>;
