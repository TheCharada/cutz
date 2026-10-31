import { getDb } from "@/infrastructure/db/client";
import type { DbExecutor } from "@/infrastructure/db/executor";
import { resolveBarbershopBySlug } from "@/modules/barbershops";
import { catalogImageUrl } from "@/modules/catalog";
import {
  getCatalogAvailabilityInput,
  listPublicServices,
  listPublicStaff,
} from "@/modules/catalog";
import {
  getAvailability,
  listScheduledAppointmentBlocks,
  type ExternalAvailabilityBlock,
} from "@/modules/scheduling";
import { listPendingOfferBlocks } from "@/modules/waitlist";
import { SystemClock, type Clock } from "@/shared/clock";
import { localDateBounds, localDateTimeToInstant, weekdayForLocalDate } from "@/shared/time";

const systemClock = new SystemClock();

export async function getPublicBarbershopForBooking(
  slug: string,
  executor: DbExecutor = getDb(),
) {
  const barbershop = await resolveBarbershopBySlug(executor, slug);
  if (!barbershop) {
    return null;
  }

  return {
    slug: barbershop.slug,
    timezone: barbershop.timezone,
  };
}

export async function listPublicServicesForBarbershop(
  slug: string,
  executor: DbExecutor = getDb(),
) {
  const barbershop = await resolveBarbershopBySlug(executor, slug);
  if (!barbershop) {
    return null;
  }

  const rows = await listPublicServices(executor, barbershop.id);
  return rows.map(({ imageKey, ...service }) => ({
    ...service,
    imageUrl: catalogImageUrl(barbershop.slug, "services", service.id, imageKey),
  }));
}

export async function listPublicStaffForBarbershop(
  slug: string,
  executor: DbExecutor = getDb(),
) {
  const barbershop = await resolveBarbershopBySlug(executor, slug);
  if (!barbershop) {
    return null;
  }

  const rows = await listPublicStaff(executor, barbershop.id);
  return rows.map(({ imageKey, ...member }) => ({
    ...member,
    imageUrl: catalogImageUrl(barbershop.slug, "staff", member.id, imageKey),
  }));
}

export async function getPublicAvailabilityForBarbershop(
  params: {
    slug: string;
    serviceId: string;
    date: string;
    staffId?: string;
    earliestTime?: string;
    latestTime?: string;
  },
  options: {
    executor?: DbExecutor;
    clock?: Clock;
    externalBlocks?: ExternalAvailabilityBlock[];
  } = {},
) {
  const executor = options.executor ?? getDb();
  const clock = options.clock ?? systemClock;
  const barbershop = await resolveBarbershopBySlug(executor, params.slug);

  if (!barbershop) {
    return { status: "barbershop-not-found" as const };
  }

  const range = localDateBounds(params.date, barbershop.timezone);
  const catalog = await getCatalogAvailabilityInput(executor, {
    barbershopId: barbershop.id,
    serviceId: params.serviceId,
    staffId: params.staffId,
    weekday: weekdayForLocalDate(params.date),
    rangeStartsAt: range.startsAt,
    rangeEndsAt: range.endsAt,
  });

  if (!catalog) {
    return { status: "service-not-found" as const };
  }

  const staffIds = catalog.staff.map((member) => member.id);
  const [appointmentBlocks, pendingOfferBlocks] = await Promise.all([
    listScheduledAppointmentBlocks(executor, {
      barbershopId: barbershop.id,
      staffIds,
      rangeStartsAt: range.startsAt,
      rangeEndsAt: range.endsAt,
    }),
    listPendingOfferBlocks(executor, {
      barbershopId: barbershop.id,
      staffIds,
      rangeStartsAt: range.startsAt,
      rangeEndsAt: range.endsAt,
    }),
  ]);
  const appointmentsByStaff = new Map<
    string,
    Array<{ startsAt: Date; endsAt: Date }>
  >();

  for (const block of appointmentBlocks) {
    const blocks = appointmentsByStaff.get(block.staffId) ?? [];
    blocks.push({ startsAt: block.startsAt, endsAt: block.endsAt });
    appointmentsByStaff.set(block.staffId, blocks);
  }

  const slots = getAvailability({
    date: params.date,
    timezone: barbershop.timezone,
    bookingIntervalMinutes: barbershop.bookingIntervalMinutes,
    serviceDurationMinutes: catalog.service.durationMinutes,
    now: clock.now(),
    externalBlocks: [...pendingOfferBlocks, ...(options.externalBlocks ?? [])],
    staff: catalog.staff.map((member) => ({
      staffId: member.id,
      workingHours: member.workingHours,
      timeOff: member.timeOff,
      appointments: appointmentsByStaff.get(member.id) ?? [],
    })),
  });

  if (params.earliestTime !== undefined && params.latestTime !== undefined) {
    let windowStartsAt: Date;
    let windowEndsAt: Date;
    try {
      windowStartsAt = localDateTimeToInstant(params.date, params.earliestTime, barbershop.timezone);
      windowEndsAt = localDateTimeToInstant(params.date, params.latestTime, barbershop.timezone);
    } catch {
      return { status: "invalid-window" as const };
    }

    if (windowStartsAt.getTime() >= windowEndsAt.getTime()) {
      return { status: "invalid-window" as const };
    }

    return {
      status: "ok" as const,
      slots: slots.filter((slot) =>
        new Date(slot.startsAt).getTime() >= windowStartsAt.getTime() &&
        new Date(slot.endsAt).getTime() <= windowEndsAt.getTime()),
    };
  }

  return { status: "ok" as const, slots };
}
