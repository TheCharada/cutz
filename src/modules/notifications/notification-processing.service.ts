import type { DbExecutor } from "@/infrastructure/db/executor";
import {
  claimDueNotificationJobs,
  markNotificationJobCancelled,
  markNotificationJobFailed,
  markNotificationJobSent,
  recoverExpiredNotificationJobLeases,
  scheduleNotificationJobRetry,
} from "./notification-processing.repository";

export type { NotificationJobRecord } from "./notification-processing.repository";

export function claimNotificationJobs(
  executor: DbExecutor,
  params: { now: Date; limit: number },
) {
  return claimDueNotificationJobs(executor, params);
}

export function completeNotificationJob(
  executor: DbExecutor,
  params: Parameters<typeof markNotificationJobSent>[1],
) {
  return markNotificationJobSent(executor, params);
}

export function cancelNotificationJob(
  executor: DbExecutor,
  params: Parameters<typeof markNotificationJobCancelled>[1],
) {
  return markNotificationJobCancelled(executor, params);
}

export function failNotificationJob(
  executor: DbExecutor,
  params: Parameters<typeof markNotificationJobFailed>[1],
) {
  return markNotificationJobFailed(executor, params);
}

export function retryNotificationJob(
  executor: DbExecutor,
  params: Parameters<typeof scheduleNotificationJobRetry>[1],
) {
  return scheduleNotificationJobRetry(executor, params);
}

export function recoverNotificationJobLeases(
  executor: DbExecutor,
  params: Parameters<typeof recoverExpiredNotificationJobLeases>[1],
) {
  return recoverExpiredNotificationJobLeases(executor, params);
}
