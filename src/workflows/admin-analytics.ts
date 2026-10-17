import { getDb, type Database } from "@/infrastructure/db/client";
import type { BarbershopContext } from "@/modules/barbershops";
import {
  getAnalyticsOverview,
  getCancellationAnalytics,
  getNoShowAnalytics,
  getWaitlistAnalytics,
  type AnalyticsQuery,
} from "@/modules/analytics";
import { SystemClock, type Clock } from "@/shared/clock";
import { addLocalDays, localDateForInstant } from "@/shared/time";

const systemClock = new SystemClock();

type AdminAnalyticsParams = {
  barbershop: BarbershopContext;
  from?: string;
  to?: string;
};

type AdminAnalyticsOptions = {
  database?: Database;
  clock?: Clock;
};

function queryFor(params: AdminAnalyticsParams, clock: Clock): AnalyticsQuery {
  const today = localDateForInstant(clock.now(), params.barbershop.timezone);
  const to = params.to ?? today;
  const from = params.from ?? addLocalDays(to, -29);

  return {
    barbershopId: params.barbershop.id,
    timezone: params.barbershop.timezone,
    from,
    to,
  };
}

export function getAdminAnalyticsOverview(
  params: AdminAnalyticsParams,
  options: AdminAnalyticsOptions = {},
) {
  return getAnalyticsOverview(
    options.database ?? getDb(),
    queryFor(params, options.clock ?? systemClock),
  );
}

export function getAdminCancellationAnalytics(
  params: AdminAnalyticsParams,
  options: AdminAnalyticsOptions = {},
) {
  return getCancellationAnalytics(
    options.database ?? getDb(),
    queryFor(params, options.clock ?? systemClock),
  );
}

export function getAdminNoShowAnalytics(
  params: AdminAnalyticsParams,
  options: AdminAnalyticsOptions = {},
) {
  return getNoShowAnalytics(
    options.database ?? getDb(),
    queryFor(params, options.clock ?? systemClock),
  );
}

export function getAdminWaitlistAnalytics(
  params: AdminAnalyticsParams,
  options: AdminAnalyticsOptions = {},
) {
  return getWaitlistAnalytics(
    options.database ?? getDb(),
    queryFor(params, options.clock ?? systemClock),
  );
}
