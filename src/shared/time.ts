type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string) {
  const cached = formatterCache.get(timeZone);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat("en-CA-u-ca-gregory-nu-latn", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  formatterCache.set(timeZone, formatter);
  return formatter;
}

function parseDate(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new Error(`Invalid local date: ${date}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const instant = new Date(Date.UTC(year, month - 1, day));

  if (
    instant.getUTCFullYear() !== year ||
    instant.getUTCMonth() !== month - 1 ||
    instant.getUTCDate() !== day
  ) {
    throw new Error(`Invalid local date: ${date}`);
  }

  return { year, month, day };
}

function parseTime(time: string) {
  const match = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(time);
  if (!match) {
    throw new Error(`Invalid local time: ${time}`);
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? 0);

  if (hour > 23 || minute > 59 || second > 59) {
    throw new Error(`Invalid local time: ${time}`);
  }

  return { hour, minute, second };
}

function getZonedParts(instant: Date, timeZone: string): DateParts {
  const parts = getFormatter(timeZone).formatToParts(instant);
  const values = new Map(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
    hour: Number(values.get("hour")),
    minute: Number(values.get("minute")),
    second: Number(values.get("second")),
  };
}

function partsToEpoch(parts: DateParts) {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
}

export function localDateTimeToInstant(date: string, time: string, timeZone: string) {
  const dateParts = parseDate(date);
  const timeParts = parseTime(time);
  const target: DateParts = { ...dateParts, ...timeParts };
  const targetEpoch = partsToEpoch(target);
  let candidateEpoch = targetEpoch;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const actual = getZonedParts(new Date(candidateEpoch), timeZone);
    const difference = targetEpoch - partsToEpoch(actual);

    if (difference === 0) {
      return new Date(candidateEpoch);
    }

    candidateEpoch += difference;
  }

  throw new Error(`Local date-time does not exist in ${timeZone}: ${date} ${time}`);
}

export function localDateForInstant(instant: Date, timeZone: string) {
  const parts = getZonedParts(instant, timeZone);
  return `${parts.year.toString().padStart(4, "0")}-${parts.month
    .toString()
    .padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;
}

export function addLocalDays(date: string, days: number) {
  const { year, month, day } = parseDate(date);
  const instant = new Date(Date.UTC(year, month - 1, day + days));
  return instant.toISOString().slice(0, 10);
}

export function localDateBounds(date: string, timeZone: string) {
  return {
    startsAt: localDateTimeToInstant(date, "00:00:00", timeZone),
    endsAt: localDateTimeToInstant(addLocalDays(date, 1), "00:00:00", timeZone),
  };
}

export function weekdayForLocalDate(date: string) {
  const { year, month, day } = parseDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function isValidLocalDate(date: string) {
  try {
    parseDate(date);
    return true;
  } catch {
    return false;
  }
}
