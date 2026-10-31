import { and, asc, eq, gt, inArray, lt } from "drizzle-orm";
import type { DbExecutor } from "@/infrastructure/db/executor";
import { services, staffMembers, staffServices, timeOff, workingHours } from "@/infrastructure/db/schema";

export async function findActiveService(
  executor: DbExecutor,
  barbershopId: string,
  serviceId: string,
) {
  const [service] = await executor
    .select({
      id: services.id,
      name: services.name,
      durationMinutes: services.durationMinutes,
    })
    .from(services)
    .where(
      and(
        eq(services.id, serviceId),
        eq(services.barbershopId, barbershopId),
        eq(services.active, true),
      ),
    )
    .limit(1);

  return service ?? null;
}

export async function lockActiveBookingService(
  executor: DbExecutor,
  barbershopId: string,
  serviceId: string,
) {
  const [service] = await executor
    .select({
      id: services.id,
      name: services.name,
      durationMinutes: services.durationMinutes,
      priceCents: services.priceCents,
    })
    .from(services)
    .where(and(
      eq(services.id, serviceId),
      eq(services.barbershopId, barbershopId),
      eq(services.active, true),
    ))
    .limit(1)
    .for("share");

  return service ?? null;
}

export async function findServiceById(
  executor: DbExecutor,
  barbershopId: string,
  serviceId: string,
) {
  const [service] = await executor
    .select({
      id: services.id,
      name: services.name,
      durationMinutes: services.durationMinutes,
      priceCents: services.priceCents,
      active: services.active,
    })
    .from(services)
    .where(and(eq(services.id, serviceId), eq(services.barbershopId, barbershopId)))
    .limit(1);

  return service ?? null;
}

export async function findStaffById(
  executor: DbExecutor,
  barbershopId: string,
  staffId: string,
) {
  const [staff] = await executor
    .select({
      id: staffMembers.id,
      name: staffMembers.name,
      active: staffMembers.active,
      acceptsAppointments: staffMembers.acceptsAppointments,
    })
    .from(staffMembers)
    .where(and(eq(staffMembers.id, staffId), eq(staffMembers.barbershopId, barbershopId)))
    .limit(1);

  return staff ?? null;
}

export async function lockStaffMembersInOrder(
  executor: DbExecutor,
  barbershopId: string,
  staffIds: string[],
) {
  const uniqueStaffIds = [...new Set(staffIds)];
  if (uniqueStaffIds.length === 0) {
    return [];
  }

  return executor
    .select({
      id: staffMembers.id,
      name: staffMembers.name,
      active: staffMembers.active,
      acceptsAppointments: staffMembers.acceptsAppointments,
    })
    .from(staffMembers)
    .where(
      and(
        eq(staffMembers.barbershopId, barbershopId),
        inArray(staffMembers.id, uniqueStaffIds),
      ),
    )
    .orderBy(asc(staffMembers.id))
    .for("update");
}

export async function lockBookableStaff(
  executor: DbExecutor,
  barbershopId: string,
  staffId: string,
) {
  const [staff] = await executor
    .select({ id: staffMembers.id, name: staffMembers.name })
    .from(staffMembers)
    .where(
      and(
        eq(staffMembers.id, staffId),
        eq(staffMembers.barbershopId, barbershopId),
        eq(staffMembers.active, true),
        eq(staffMembers.acceptsAppointments, true),
      ),
    )
    .limit(1)
    .for("update");

  return staff ?? null;
}

export async function hasStaffService(
  executor: DbExecutor,
  barbershopId: string,
  staffId: string,
  serviceId: string,
) {
  const [row] = await executor
    .select({ staffId: staffServices.staffId })
    .from(staffServices)
    .innerJoin(staffMembers, eq(staffMembers.id, staffServices.staffId))
    .innerJoin(services, eq(services.id, staffServices.serviceId))
    .where(
      and(
        eq(staffServices.staffId, staffId),
        eq(staffServices.serviceId, serviceId),
        eq(staffMembers.barbershopId, barbershopId),
        eq(services.barbershopId, barbershopId),
      ),
    )
    .limit(1);

  return Boolean(row);
}

export function listActiveServices(executor: DbExecutor, barbershopId: string) {
  return executor
    .select({
      id: services.id,
      name: services.name,
      durationMinutes: services.durationMinutes,
      priceCents: services.priceCents,
    })
    .from(services)
    .where(and(eq(services.barbershopId, barbershopId), eq(services.active, true)))
    .orderBy(asc(services.name), asc(services.id));
}

export function listActiveBookableStaff(executor: DbExecutor, barbershopId: string) {
  return executor
    .select({
      id: staffMembers.id,
      name: staffMembers.name,
    })
    .from(staffMembers)
    .where(
      and(
        eq(staffMembers.barbershopId, barbershopId),
        eq(staffMembers.active, true),
        eq(staffMembers.acceptsAppointments, true),
      ),
    )
    .orderBy(asc(staffMembers.name), asc(staffMembers.id));
}

export async function listEligibleStaffForService(
  executor: DbExecutor,
  barbershopId: string,
  serviceId: string,
  staffId?: string,
) {
  const conditions = [
    eq(staffMembers.barbershopId, barbershopId),
    eq(staffMembers.active, true),
    eq(staffMembers.acceptsAppointments, true),
    eq(staffServices.serviceId, serviceId),
  ];

  if (staffId) {
    conditions.push(eq(staffMembers.id, staffId));
  }

  return executor
    .select({ id: staffMembers.id, name: staffMembers.name })
    .from(staffMembers)
    .innerJoin(staffServices, eq(staffServices.staffId, staffMembers.id))
    .where(and(...conditions))
    .orderBy(asc(staffMembers.name), asc(staffMembers.id));
}

export async function listWorkingHours(
  executor: DbExecutor,
  staffIds: string[],
  weekday: number,
) {
  if (staffIds.length === 0) {
    return [];
  }

  return executor
    .select({
      staffId: workingHours.staffId,
      startsAt: workingHours.startsAt,
      endsAt: workingHours.endsAt,
    })
    .from(workingHours)
    .where(and(inArray(workingHours.staffId, staffIds), eq(workingHours.weekday, weekday)))
    .orderBy(asc(workingHours.staffId), asc(workingHours.startsAt));
}

export async function listTimeOff(
  executor: DbExecutor,
  staffIds: string[],
  rangeStartsAt: Date,
  rangeEndsAt: Date,
) {
  if (staffIds.length === 0) {
    return [];
  }

  return executor
    .select({
      staffId: timeOff.staffId,
      startsAt: timeOff.startsAt,
      endsAt: timeOff.endsAt,
    })
    .from(timeOff)
    .where(
      and(
        inArray(timeOff.staffId, staffIds),
        lt(timeOff.startsAt, rangeEndsAt),
        gt(timeOff.endsAt, rangeStartsAt),
      ),
    )
    .orderBy(asc(timeOff.staffId), asc(timeOff.startsAt));
}
