export type PublicService = {
  id: string;
  name: string;
  durationMinutes: number;
  priceCents: number | null;
};

export type PublicStaffMember = {
  id: string;
  name: string;
};

export type CatalogTimeBlock = {
  startsAt: Date;
  endsAt: Date;
};

export type CatalogAvailabilityStaff = PublicStaffMember & {
  workingHours: Array<{
    startsAt: string;
    endsAt: string;
  }>;
  timeOff: CatalogTimeBlock[];
};

export type CatalogAvailabilityInput = {
  service: {
    id: string;
    name: string;
    durationMinutes: number;
  };
  staff: CatalogAvailabilityStaff[];
};
