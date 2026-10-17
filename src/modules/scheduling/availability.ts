import { localDateTimeToInstant } from "@/shared/time";
import type {
  AvailabilityBlock,
  GetAvailabilityInput,
  PublicAvailabilitySlot,
} from "./types";

function overlaps(left: AvailabilityBlock, right: AvailabilityBlock) {
  return left.startsAt < right.endsAt && right.startsAt < left.endsAt;
}

export function getAvailability(input: GetAvailabilityInput): PublicAvailabilitySlot[] {
  if (input.bookingIntervalMinutes <= 0 || input.serviceDurationMinutes <= 0) {
    throw new Error("Availability intervals must be positive");
  }

  const intervalMs = input.bookingIntervalMinutes * 60_000;
  const durationMs = input.serviceDurationMinutes * 60_000;
  const nowMs = input.now.getTime();
  const slots = new Map<string, PublicAvailabilitySlot>();

  for (const staff of input.staff) {
    const occupied = [
      ...staff.timeOff,
      ...staff.appointments,
      ...input.externalBlocks
        .filter((block) => block.staffId === staff.staffId)
        .map(({ startsAt, endsAt }) => ({ startsAt, endsAt })),
    ];

    for (const hours of staff.workingHours) {
      const workingStartsAt = localDateTimeToInstant(input.date, hours.startsAt, input.timezone);
      const workingEndsAt = localDateTimeToInstant(input.date, hours.endsAt, input.timezone);

      for (
        let candidateStartsAtMs = workingStartsAt.getTime();
        candidateStartsAtMs < workingEndsAt.getTime();
        candidateStartsAtMs += intervalMs
      ) {
        const candidateEndsAtMs = candidateStartsAtMs + durationMs;
        if (candidateEndsAtMs > workingEndsAt.getTime()) {
          break;
        }

        if (candidateStartsAtMs < nowMs) {
          continue;
        }

        const candidate = {
          startsAt: new Date(candidateStartsAtMs),
          endsAt: new Date(candidateEndsAtMs),
        };

        if (occupied.some((block) => overlaps(candidate, block))) {
          continue;
        }

        const slot = {
          staffId: staff.staffId,
          startsAt: candidate.startsAt.toISOString(),
          endsAt: candidate.endsAt.toISOString(),
        };
        slots.set(`${slot.staffId}:${slot.startsAt}`, slot);
      }
    }
  }

  return [...slots.values()].sort(
    (left, right) =>
      left.startsAt.localeCompare(right.startsAt) || left.staffId.localeCompare(right.staffId),
  );
}
