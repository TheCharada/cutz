import { describe, expect, it } from "vitest";
import { FixedClock } from "@/shared/clock";
import { getAvailability } from "./availability";
import type { AvailabilityStaffInput, ExternalAvailabilityBlock } from "./types";

const date = "2026-09-07";
const timezone = "America/Sao_Paulo";
const beforeOpening = new FixedClock(new Date("2026-09-07T10:00:00.000Z"));

function staff(overrides: Partial<AvailabilityStaffInput> = {}): AvailabilityStaffInput {
  return {
    staffId: "staff-1",
    workingHours: [{ startsAt: "08:00", endsAt: "10:00" }],
    timeOff: [],
    appointments: [],
    ...overrides,
  };
}

function startsAt(
  staffInput: AvailabilityStaffInput,
  options: {
    interval?: number;
    duration?: number;
    now?: Date;
    externalBlocks?: ExternalAvailabilityBlock[];
    targetTimezone?: string;
  } = {},
) {
  return getAvailability({
    date,
    timezone: options.targetTimezone ?? timezone,
    bookingIntervalMinutes: options.interval ?? 30,
    serviceDurationMinutes: options.duration ?? 30,
    now: options.now ?? beforeOpening.now(),
    staff: [staffInput],
    externalBlocks: options.externalBlocks ?? [],
  }).map((slot) => slot.startsAt);
}

describe("getAvailability", () => {
  it("uses half-open intervals for occupied blocks", () => {
    expect(
      startsAt(
        staff({
          appointments: [
            {
              startsAt: new Date("2026-09-07T11:30:00.000Z"),
              endsAt: new Date("2026-09-07T12:00:00.000Z"),
            },
          ],
        }),
      ),
    ).toEqual([
      "2026-09-07T11:00:00.000Z",
      "2026-09-07T12:00:00.000Z",
      "2026-09-07T12:30:00.000Z",
    ]);
  });

  it("supports multiple working-hours blocks on the same day", () => {
    expect(
      startsAt(
        staff({
          workingHours: [
            { startsAt: "08:00", endsAt: "09:00" },
            { startsAt: "13:00", endsAt: "14:00" },
          ],
        }),
      ),
    ).toEqual([
      "2026-09-07T11:00:00.000Z",
      "2026-09-07T11:30:00.000Z",
      "2026-09-07T16:00:00.000Z",
      "2026-09-07T16:30:00.000Z",
    ]);
  });

  it("anchors the booking grid at the start of each working-hours block", () => {
    expect(
      startsAt(staff({ workingHours: [{ startsAt: "08:10", endsAt: "09:10" }] }), {
        interval: 15,
        duration: 15,
      }),
    ).toEqual([
      "2026-09-07T11:10:00.000Z",
      "2026-09-07T11:25:00.000Z",
      "2026-09-07T11:40:00.000Z",
      "2026-09-07T11:55:00.000Z",
    ]);
  });

  it("keeps service duration independent from the booking interval", () => {
    expect(
      startsAt(staff({ workingHours: [{ startsAt: "08:00", endsAt: "09:00" }] }), {
        interval: 15,
        duration: 30,
      }),
    ).toEqual([
      "2026-09-07T11:00:00.000Z",
      "2026-09-07T11:15:00.000Z",
      "2026-09-07T11:30:00.000Z",
    ]);
  });

  it("subtracts partial time off", () => {
    expect(
      startsAt(
        staff({
          timeOff: [
            {
              startsAt: new Date("2026-09-07T11:40:00.000Z"),
              endsAt: new Date("2026-09-07T12:10:00.000Z"),
            },
          ],
        }),
        { interval: 15, duration: 30 },
      ),
    ).toEqual([
      "2026-09-07T11:00:00.000Z",
      "2026-09-07T12:15:00.000Z",
      "2026-09-07T12:30:00.000Z",
    ]);
  });

  it("subtracts scheduled appointments", () => {
    expect(
      startsAt(
        staff({
          appointments: [
            {
              startsAt: new Date("2026-09-07T11:30:00.000Z"),
              endsAt: new Date("2026-09-07T12:30:00.000Z"),
            },
          ],
        }),
      ),
    ).toEqual(["2026-09-07T11:00:00.000Z", "2026-09-07T12:30:00.000Z"]);
  });

  it("subtracts external blocks without depending on their source", () => {
    expect(
      startsAt(staff(), {
        externalBlocks: [
          {
            staffId: "staff-1",
            startsAt: new Date("2026-09-07T11:30:00.000Z"),
            endsAt: new Date("2026-09-07T12:00:00.000Z"),
          },
        ],
      }),
    ).toEqual([
      "2026-09-07T11:00:00.000Z",
      "2026-09-07T12:00:00.000Z",
      "2026-09-07T12:30:00.000Z",
    ]);
  });

  it("allows a service to fit exactly at the end of working hours", () => {
    expect(
      startsAt(staff({ workingHours: [{ startsAt: "08:00", endsAt: "09:00" }] }), {
        interval: 30,
        duration: 30,
      }),
    ).toContain("2026-09-07T11:30:00.000Z");
  });

  it("rejects starts whose full service duration exceeds working hours", () => {
    expect(
      startsAt(staff({ workingHours: [{ startsAt: "08:00", endsAt: "09:00" }] }), {
        interval: 30,
        duration: 45,
      }),
    ).toEqual(["2026-09-07T11:00:00.000Z"]);
  });

  it("does not return starts in the past", () => {
    expect(
      startsAt(staff(), {
        interval: 15,
        duration: 15,
        now: new FixedClock(new Date("2026-09-07T11:25:00.000Z")).now(),
      }),
    ).toEqual([
      "2026-09-07T11:30:00.000Z",
      "2026-09-07T11:45:00.000Z",
      "2026-09-07T12:00:00.000Z",
      "2026-09-07T12:15:00.000Z",
      "2026-09-07T12:30:00.000Z",
      "2026-09-07T12:45:00.000Z",
    ]);
  });

  it("converts local working hours using the barbershop timezone", () => {
    expect(
      startsAt(staff({ workingHours: [{ startsAt: "09:00", endsAt: "10:00" }] }), {
        interval: 60,
        duration: 60,
        targetTimezone: "Asia/Tokyo",
        now: new Date("2026-09-06T23:00:00.000Z"),
      }),
    ).toEqual(["2026-09-07T00:00:00.000Z"]);
  });
});
