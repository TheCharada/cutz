export type PublicService = {
  id: string;
  name: string;
  durationMinutes: number;
  priceCents: number | null;
  imageUrl: string | null;
};

export type PublicStaffMember = {
  id: string;
  name: string;
  imageUrl: string | null;
};

export type CatalogTimeBlock = {
  startsAt: Date;
  endsAt: Date;
};

export type CatalogAvailabilityStaff = {
  id: string;
  name: string;
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
