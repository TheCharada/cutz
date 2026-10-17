import { getAntiAbuseEnv } from "@/config/anti-abuse";
import { getDb, type Database } from "@/infrastructure/db/client";
import { resolveBarbershopBySlug } from "@/modules/barbershops";
import {
  getActiveBookingService,
  getStaffSnapshot,
  staffPerformsService,
} from "@/modules/catalog";
import {
  customerSessionSatisfiesVerificationMode,
  resolveCustomerPrincipal,
} from "@/modules/customers";
import { enqueueWaitlistEntryCreatedNotification } from "@/modules/notifications";
import {
  countCustomerActiveWaitlistEntries,
  createWaitlistEntry,
  lockCustomerWaitlistCreation,
} from "@/modules/waitlist";
import { SystemClock, type Clock } from "@/shared/clock";
import { createOpaqueToken, hashOpaqueToken } from "@/shared/tokens";
import { localDateForInstant, localDateTimeToInstant } from "@/shared/time";

const systemClock = new SystemClock();

export async function createPublicWaitlistEntry(
  params: {
    slug: string;
    sessionToken: string;
    serviceId: string;
    staffId?: string;
    desiredDate: string;
    earliestTime: string;
    latestTime: string;
  },
  options: {
    database?: Database;
    clock?: Clock;
    appOrigin?: string;
    maxActiveWaitlistEntries?: number;
  } = {},
) {
  const database = options.database ?? getDb();
  const clock = options.clock ?? systemClock;
  const now = clock.now();
  const appOrigin = options.appOrigin ?? process.env.APP_ORIGIN;
  const maxActiveWaitlistEntries =
    options.maxActiveWaitlistEntries ?? getAntiAbuseEnv().MAX_ACTIVE_WAITLIST_ENTRIES_PER_CUSTOMER;
  if (!appOrigin) throw new Error("APP_ORIGIN is required to create waitlist capability links");

  return database.transaction(async (tx) => {
    const barbershop = await resolveBarbershopBySlug(tx, params.slug);
    if (!barbershop) return { status: "barbershop-not-found" as const };

    const customer = await resolveCustomerPrincipal(tx, {
      barbershopId: barbershop.id,
      token: params.sessionToken,
      now,
    });
    if (
      !customer ||
      !customerSessionSatisfiesVerificationMode(customer, barbershop.customerVerificationMode)
    ) {
      return { status: "customer-session-invalid" as const };
    }

    await lockCustomerWaitlistCreation(tx, barbershop.id, customer.id);
    const activeEntries = await countCustomerActiveWaitlistEntries(tx, barbershop.id, customer.id);
    if (activeEntries >= maxActiveWaitlistEntries) {
      return { status: "active-waitlist-limit" as const };
    }

    const service = await getActiveBookingService(tx, barbershop.id, params.serviceId);
    if (!service) return { status: "service-not-found" as const };

    let staff: Awaited<ReturnType<typeof getStaffSnapshot>> | null = null;
    if (params.staffId) {
      staff = await getStaffSnapshot(tx, barbershop.id, params.staffId);
      if (!staff || !staff.active || !staff.acceptsAppointments) {
        return { status: "staff-not-found" as const };
      }
      if (!(await staffPerformsService(tx, barbershop.id, staff.id, service.id))) {
        return { status: "staff-not-found" as const };
      }
    }

    const today = localDateForInstant(now, barbershop.timezone);
    const windowEndsAt = localDateTimeToInstant(
      params.desiredDate,
      params.latestTime,
      barbershop.timezone,
    );
    if (params.desiredDate < today || windowEndsAt <= now) {
      return { status: "invalid-window" as const };
    }

    const managementToken = createOpaqueToken();
    const entry = await createWaitlistEntry(tx, {
      barbershopId: barbershop.id,
      customerId: customer.id,
      serviceId: service.id,
      staffId: staff?.id,
      desiredDate: params.desiredDate,
      earliestTime: params.earliestTime,
      latestTime: params.latestTime,
      managementTokenHash: hashOpaqueToken(managementToken),
    });
    const managementUrl = `${appOrigin.replace(/\/$/, "")}/w/${managementToken}`;

    await enqueueWaitlistEntryCreatedNotification(tx, {
      barbershopId: barbershop.id,
      waitlistEntryId: entry.id,
      phoneE164: customer.phoneE164,
      now,
      payload: {
        type: "WAITLIST_ENTRY_CREATED",
        waitlistEntryId: entry.id,
        customerName: customer.name,
        serviceName: service.name,
        desiredDate: entry.desiredDate,
        earliestTime: entry.earliestTime,
        latestTime: entry.latestTime,
        managementUrl,
      },
    });

    return { status: "ok" as const, entry, managementUrl };
  });
}
