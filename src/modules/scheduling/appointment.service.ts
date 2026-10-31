import type { DbExecutor } from "@/infrastructure/db/executor";
import {
  countFutureScheduledAppointmentsForCustomer,
  findAppointmentById,
  findAppointmentByManagementTokenHash,
  findScheduledAppointmentBlocks,
  insertScheduledAppointment,
  listAppointmentsByCustomer,
  listAppointmentsInRange,
  listFutureScheduledAppointmentsForStaff,
  lockAppointmentById,
  lockAppointmentByManagementTokenHash,
  lockAppointmentCreationForCustomer,
  updateScheduledAppointmentAsCancelled,
  updateScheduledAppointmentStatus,
} from "./appointment.repository";
import type { ScheduledAppointmentBlock } from "./types";
import type { BookedServiceSnapshot } from "./appointment-services.repository";

export function getAppointmentById(executor: DbExecutor, barbershopId: string, appointmentId: string) {
  return findAppointmentById(executor, barbershopId, appointmentId);
}
export function lockAppointmentForUpdate(executor: DbExecutor, barbershopId: string, appointmentId: string) {
  return lockAppointmentById(executor, barbershopId, appointmentId);
}
export function listAppointmentsForRange(executor: DbExecutor, params: { barbershopId: string; rangeStartsAt: Date; rangeEndsAt: Date }) {
  return listAppointmentsInRange(executor, params);
}
export function listCustomerAppointments(executor: DbExecutor, barbershopId: string, customerId: string) {
  return listAppointmentsByCustomer(executor, barbershopId, customerId);
}
export function listFutureAppointmentsForStaff(executor: DbExecutor, params: { barbershopId: string; staffId: string; after: Date }) {
  return listFutureScheduledAppointmentsForStaff(executor, params);
}
export function lockCustomerAppointmentCreation(executor: DbExecutor, barbershopId: string, customerId: string) {
  return lockAppointmentCreationForCustomer(executor, barbershopId, customerId);
}
export function countCustomerFutureAppointments(executor: DbExecutor, params: { barbershopId: string; customerId: string; after: Date }) {
  return countFutureScheduledAppointmentsForCustomer(executor, params);
}
export function getAppointmentByManagementTokenHash(executor: DbExecutor, tokenHash: string) {
  return findAppointmentByManagementTokenHash(executor, tokenHash);
}
export function lockAppointmentByManagementToken(executor: DbExecutor, tokenHash: string) {
  return lockAppointmentByManagementTokenHash(executor, tokenHash);
}
export function listScheduledAppointmentBlocks(executor: DbExecutor, params: { barbershopId: string; staffIds: string[]; rangeStartsAt: Date; rangeEndsAt: Date; excludeAppointmentId?: string }): Promise<ScheduledAppointmentBlock[]> {
  return findScheduledAppointmentBlocks(executor, params);
}
export function createAppointmentInTransaction(executor: DbExecutor, params: { barbershopId: string; customerId: string; staffId: string; serviceId: string; startsAt: Date; endsAt: Date; managementTokenHash: string; rescheduledFromId?: string; bookedSnapshot?: BookedServiceSnapshot }) {
  return insertScheduledAppointment(executor, params);
}
export function cancelScheduledAppointmentInTransaction(executor: DbExecutor, params: { appointmentId: string; cancelledAt: Date; cancelledBy: "CUSTOMER" | "STAFF"; cancellationKind: "CANCELLATION" | "RESCHEDULED"; cancellationReason?: string }) {
  return updateScheduledAppointmentAsCancelled(executor, params);
}
export function finishScheduledAppointmentInTransaction(executor: DbExecutor, params: { barbershopId: string; appointmentId: string; status: "COMPLETED" | "NO_SHOW"; now: Date }) {
  return updateScheduledAppointmentStatus(executor, params);
}
