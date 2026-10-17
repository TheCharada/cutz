import type { DbExecutor } from "@/infrastructure/db/executor";
import { addLocalDays, localDateForInstant, localDateTimeToInstant, weekdayForLocalDate } from "@/shared/time";
import { listAppointmentsForAnalytics, listWaitlistOffersForAnalytics } from "./repository";

export type AnalyticsRange = {
  from: string;
  to: string;
  timezone: string;
};

export type AnalyticsQuery = AnalyticsRange & {
  barbershopId: string;
};

const weekdayNames = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
] as const;

function percentage(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function rangeBounds(query: AnalyticsQuery) {
  return {
    startsAt: localDateTimeToInstant(query.from, "00:00:00", query.timezone),
    endsAt: localDateTimeToInstant(addLocalDays(query.to, 1), "00:00:00", query.timezone),
  };
}

function localHour(instant: Date, timezone: string) {
  const value = new Intl.DateTimeFormat("en-US-u-nu-latn", {
    timeZone: timezone,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(instant);
  return Number(value);
}

async function appointmentDataset(executor: DbExecutor, query: AnalyticsQuery) {
  return listAppointmentsForAnalytics(executor, {
    barbershopId: query.barbershopId,
    ...rangeBounds(query),
  });
}

async function waitlistDataset(executor: DbExecutor, query: AnalyticsQuery) {
  return listWaitlistOffersForAnalytics(executor, {
    barbershopId: query.barbershopId,
    ...rangeBounds(query),
  });
}

export async function getAnalyticsOverview(executor: DbExecutor, query: AnalyticsQuery) {
  const [appointmentRows, offerRows] = await Promise.all([
    appointmentDataset(executor, query),
    waitlistDataset(executor, query),
  ]);

  const cancellations = appointmentRows.filter(
    (row) => row.status === "CANCELLED" && row.cancellationKind === "CANCELLATION",
  ).length;
  const noShows = appointmentRows.filter((row) => row.status === "NO_SHOW").length;
  const completed = appointmentRows.filter((row) => row.status === "COMPLETED").length;
  const offersAccepted = offerRows.filter((row) => row.status === "ACCEPTED").length;
  const opportunityIds = new Set(offerRows.map((row) => row.opportunityId));
  const recoveredOpportunityIds = new Set(
    offerRows.filter((row) => row.status === "ACCEPTED").map((row) => row.opportunityId),
  );

  return {
    range: { from: query.from, to: query.to, timezone: query.timezone },
    cancellations,
    noShows,
    completed,
    noShowRate: percentage(noShows, completed + noShows),
    waitlist: {
      offersCreated: offerRows.length,
      offersAccepted,
      opportunities: opportunityIds.size,
      opportunitiesRecovered: recoveredOpportunityIds.size,
      recoveryRate: percentage(recoveredOpportunityIds.size, opportunityIds.size),
    },
  };
}

export async function getCancellationAnalytics(executor: DbExecutor, query: AnalyticsQuery) {
  const rows = (await appointmentDataset(executor, query)).filter(
    (row) => row.status === "CANCELLED" && row.cancellationKind === "CANCELLATION",
  );
  const counts = Array.from({ length: 24 }, () => 0);
  for (const row of rows) {
    counts[localHour(row.startsAt, query.timezone)] += 1;
  }

  return {
    range: { from: query.from, to: query.to, timezone: query.timezone },
    total: rows.length,
    items: counts.map((count, hour) => ({ hour, count })),
  };
}

export async function getNoShowAnalytics(executor: DbExecutor, query: AnalyticsQuery) {
  const rows = await appointmentDataset(executor, query);
  const noShowRows = rows.filter((row) => row.status === "NO_SHOW");
  const completed = rows.filter((row) => row.status === "COMPLETED").length;
  const counts = Array.from({ length: 7 }, () => 0);

  for (const row of noShowRows) {
    const localDate = localDateForInstant(row.startsAt, query.timezone);
    counts[weekdayForLocalDate(localDate)] += 1;
  }

  return {
    range: { from: query.from, to: query.to, timezone: query.timezone },
    total: noShowRows.length,
    completed,
    noShowRate: percentage(noShowRows.length, completed + noShowRows.length),
    items: counts.map((count, weekday) => ({ weekday: weekdayNames[weekday], count })),
  };
}

export async function getWaitlistAnalytics(executor: DbExecutor, query: AnalyticsQuery) {
  const rows = await waitlistDataset(executor, query);
  const accepted = rows.filter((row) => row.status === "ACCEPTED");
  const opportunities = new Set(rows.map((row) => row.opportunityId));
  const recovered = new Set(accepted.map((row) => row.opportunityId));

  return {
    range: { from: query.from, to: query.to, timezone: query.timezone },
    offersCreated: rows.length,
    offersAccepted: accepted.length,
    opportunities: opportunities.size,
    opportunitiesRecovered: recovered.size,
    recoveryRate: percentage(recovered.size, opportunities.size),
  };
}
