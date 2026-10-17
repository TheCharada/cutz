export type AvailabilityBlock = {
  startsAt: Date;
  endsAt: Date;
};

export type ExternalAvailabilityBlock = AvailabilityBlock & {
  staffId: string;
};

export type AvailabilityStaffInput = {
  staffId: string;
  workingHours: Array<{
    startsAt: string;
    endsAt: string;
  }>;
  timeOff: AvailabilityBlock[];
  appointments: AvailabilityBlock[];
};

export type GetAvailabilityInput = {
  date: string;
  timezone: string;
  bookingIntervalMinutes: number;
  serviceDurationMinutes: number;
  now: Date;
  staff: AvailabilityStaffInput[];
  externalBlocks: ExternalAvailabilityBlock[];
};

export type PublicAvailabilitySlot = {
  staffId: string;
  startsAt: string;
  endsAt: string;
};

export type ScheduledAppointmentBlock = AvailabilityBlock & {
  staffId: string;
};
