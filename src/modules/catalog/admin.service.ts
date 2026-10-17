import type { DbExecutor } from "@/infrastructure/db/executor";
import {
  deleteTenantTimeOff,
  insertAdminService,
  insertAdminStaff,
  insertTimeOff,
  listAdminServices,
  listAdminStaff,
  listAllWorkingHours,
  listStaffServiceIds,
  listStaffTimeOff,
  listTenantServicesByIds,
  replaceStaffServices,
  replaceWorkingHours,
  updateAdminService,
  updateAdminStaff,
} from "./admin.repository";

export const getAdminServices = listAdminServices;
export const createAdminService = insertAdminService;
export const patchAdminService = updateAdminService;
export const getAdminStaff = listAdminStaff;
export const createAdminStaff = insertAdminStaff;
export const patchAdminStaff = updateAdminStaff;
export const getTenantServicesByIds = listTenantServicesByIds;
export const setStaffServices = replaceStaffServices;
export const getStaffServiceIds = listStaffServiceIds;
export const setStaffWorkingHours = replaceWorkingHours;
export const getStaffTimeOff = listStaffTimeOff;
export const createStaffTimeOff = insertTimeOff;
export const deleteStaffTimeOff = deleteTenantTimeOff;

export async function getStaffWorkingHours(executor: DbExecutor, staffId: string) {
  const rows = await listAllWorkingHours(executor, staffId);
  return rows.map((row) => ({
    ...row,
    startsAt: row.startsAt.slice(0, 5),
    endsAt: row.endsAt.slice(0, 5),
  }));
}

export function validateWorkingHours(hours: Array<{ weekday: number; startsAt: string; endsAt: string }>) {
  const normalized = [...hours].sort((a, b) => a.weekday - b.weekday || a.startsAt.localeCompare(b.startsAt));
  for (const row of normalized) {
    if (!Number.isInteger(row.weekday) || row.weekday < 0 || row.weekday > 6) return false;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(row.startsAt) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.endsAt)) return false;
    if (row.endsAt <= row.startsAt) return false;
  }
  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1];
    const current = normalized[index];
    if (previous.weekday === current.weekday && current.startsAt < previous.endsAt) return false;
  }
  return true;
}
