import { pgEnum } from "drizzle-orm/pg-core";

export const customerVerificationModeEnum = pgEnum("customer_verification_mode", [
  "NONE",
  "WHATSAPP_OTP",
]);

export const customerVerificationLevelEnum = pgEnum("customer_verification_level", [
  "UNVERIFIED",
  "PHONE_VERIFIED",
]);

export const membershipRoleEnum = pgEnum("membership_role", ["OWNER", "STAFF"]);

export const appointmentStatusEnum = pgEnum("appointment_status", [
  "SCHEDULED",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
]);

export const appointmentCancelledByEnum = pgEnum("appointment_cancelled_by", [
  "CUSTOMER",
  "STAFF",
]);

export const appointmentCancellationKindEnum = pgEnum("appointment_cancellation_kind", [
  "CANCELLATION",
  "RESCHEDULED",
]);

export const waitlistEntryStatusEnum = pgEnum("waitlist_entry_status", [
  "ACTIVE",
  "FULFILLED",
  "CANCELLED",
  "EXPIRED",
]);

export const waitlistOfferStatusEnum = pgEnum("waitlist_offer_status", [
  "PENDING",
  "ACCEPTED",
  "REJECTED",
  "EXPIRED",
]);

export const notificationJobStatusEnum = pgEnum("notification_job_status", [
  "PENDING",
  "PROCESSING",
  "SENT",
  "FAILED",
  "CANCELLED",
]);

export const notificationDeliveryStatusEnum = pgEnum("notification_delivery_status", [
  "ACCEPTED",
  "SENT",
  "DELIVERED",
  "READ",
  "FAILED",
  "DELETED",
]);

export const notificationJobTypeEnum = pgEnum("notification_job_type", [
  "APPOINTMENT_CREATED",
  "APPOINTMENT_RESCHEDULED",
  "APPOINTMENT_REMINDER",
  "APPOINTMENT_CANCELLED",
  "WAITLIST_ENTRY_CREATED",
  "WAITLIST_OFFER",
  "CUSTOMER_OTP",
]);
