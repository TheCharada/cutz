import type { DbExecutor } from "@/infrastructure/db/executor";
import {
  findActiveService,
  findServiceById,
  findStaffById,
  hasStaffService,
  listActiveBookableStaff,
  listActiveServices,
  listEligibleStaffForService,
  listTimeOff,
  listWorkingHours,
  lockBookableStaff,
  lockActiveBookingService as lockActiveBookingServiceRow,
  lockStaffMembersInOrder,
} from "./catalog.repository";
import type { CatalogAvailabilityInput } from "./types";

export function listPublicServices(
  executor: DbExecutor,
  barbershopId: string,
) {
  return listActiveServices(executor, barbershopId);
}

export function listPublicStaff(
  executor: DbExecutor,
  barbershopId: string,
) {
  return listActiveBookableStaff(executor, barbershopId);
}

export function getActiveBookingService(
  executor: DbExecutor,
  barbershopId: string,
  serviceId: string,
) {
  return findActiveService(executor, barbershopId, serviceId);
}

export function getServiceSnapshot(
  executor: DbExecutor,
  barbershopId: string,
  serviceId: string,
) {
  return findServiceById(executor, barbershopId, serviceId);
}

export function lockServicePriceForBooking(
  executor: DbExecutor,
  barbershopId: string,
  serviceId: string,
) {
  return lockActiveBookingServiceRow(executor, barbershopId, serviceId);
}

export function getStaffSnapshot(
  executor: DbExecutor,
  barbershopId: string,
  staffId: string,
) {
  return findStaffById(executor, barbershopId, staffId);
}

export function lockStaffMembersForUpdate(
  executor: DbExecutor,
  barbershopId: string,
  staffIds: string[],
) {
  return lockStaffMembersInOrder(executor, barbershopId, staffIds);
}

export function lockBookableStaffMember(
  executor: DbExecutor,
  barbershopId: string,
  staffId: string,
) {
  return lockBookableStaff(executor, barbershopId, staffId);
}

export function staffPerformsService(
  executor: DbExecutor,
  barbershopId: string,
  staffId: string,
  serviceId: string,
) {
  return hasStaffService(executor, barbershopId, staffId, serviceId);
}

export async function getCatalogAvailabilityInput(
  executor: DbExecutor,
  params: {
    barbershopId: string;
    serviceId: string;
    staffId?: string;
    weekday: number;
    rangeStartsAt: Date;
    rangeEndsAt: Date;
  },
): Promise<CatalogAvailabilityInput | null> {
  const service = await findActiveService(executor, params.barbershopId, params.serviceId);
  if (!service) {
    return null;
  }

  const staff = await listEligibleStaffForService(
    executor,
    params.barbershopId,
    params.serviceId,
    params.staffId,
  );
  const staffIds = staff.map((member) => member.id);
  const hours = await listWorkingHours(executor, staffIds, params.weekday);
  const off = await listTimeOff(
    executor,
    staffIds,
    params.rangeStartsAt,
    params.rangeEndsAt,
  );

  const hoursByStaff = new Map<string, CatalogAvailabilityInput["staff"][number]["workingHours"]>();
  const offByStaff = new Map<string, CatalogAvailabilityInput["staff"][number]["timeOff"]>();

  for (const row of hours) {
    const entries = hoursByStaff.get(row.staffId) ?? [];
    entries.push({ startsAt: row.startsAt, endsAt: row.endsAt });
    hoursByStaff.set(row.staffId, entries);
  }

  for (const row of off) {
    const entries = offByStaff.get(row.staffId) ?? [];
    entries.push({ startsAt: row.startsAt, endsAt: row.endsAt });
    offByStaff.set(row.staffId, entries);
  }

  return {
    service,
    staff: staff.map((member) => ({
      ...member,
      workingHours: hoursByStaff.get(member.id) ?? [],
      timeOff: offByStaff.get(member.id) ?? [],
    })),
  };
}
