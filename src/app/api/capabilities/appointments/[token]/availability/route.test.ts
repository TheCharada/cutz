import { beforeEach, describe, expect, it, vi } from "vitest";

const capabilityMocks = vi.hoisted(() => ({
  getRescheduleAvailabilityByCapability: vi.fn(),
}));

vi.mock("@/workflows/appointment-capability", () => capabilityMocks);

import { GET } from "./route";

const staffId = "00000000-0000-4000-8000-000000000003";

function routeContext(token = "capability-token") {
  return { params: Promise.resolve({ token }) };
}

describe("appointment reschedule availability route", () => {
  beforeEach(() => {
    capabilityMocks.getRescheduleAvailabilityByCapability.mockReset();
  });

  it("rejects caller-supplied service or appointment identifiers", async () => {
    const query = new URLSearchParams({
      staffId,
      date: "2026-09-07",
      serviceId: "00000000-0000-4000-8000-000000000002",
      excludeAppointmentId: "00000000-0000-4000-8000-000000000001",
    });

    const response = await GET(
      new Request(`http://localhost/api/capabilities/appointments/capability-token/availability?${query}`),
      routeContext(),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(capabilityMocks.getRescheduleAvailabilityByCapability).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown capability", async () => {
    capabilityMocks.getRescheduleAvailabilityByCapability.mockResolvedValue({ status: "not-found" });
    const query = new URLSearchParams({ staffId, date: "2026-09-07" });

    const response = await GET(
      new Request(`http://localhost/api/capabilities/appointments/missing/availability?${query}`),
      routeContext("missing"),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("returns 409 when the appointment is not scheduled", async () => {
    capabilityMocks.getRescheduleAvailabilityByCapability.mockResolvedValue({
      status: "terminal-conflict",
    });
    const query = new URLSearchParams({ staffId, date: "2026-09-07" });

    const response = await GET(
      new Request(`http://localhost/api/capabilities/appointments/capability-token/availability?${query}`),
      routeContext(),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "APPOINTMENT_CONFLICT" } });
  });

  it("returns capability-scoped slots and derives service/tenant server-side", async () => {
    capabilityMocks.getRescheduleAvailabilityByCapability.mockResolvedValue({
      status: "ok",
      slots: [
        {
          staffId,
          startsAt: "2026-09-07T11:30:00.000Z",
          endsAt: "2026-09-07T12:30:00.000Z",
        },
      ],
    });
    const query = new URLSearchParams({ staffId, date: "2026-09-07" });

    const response = await GET(
      new Request(`http://localhost/api/capabilities/appointments/capability-token/availability?${query}`),
      routeContext(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      slots: [
        {
          staffId,
          startsAt: "2026-09-07T11:30:00.000Z",
          endsAt: "2026-09-07T12:30:00.000Z",
        },
      ],
    });
    expect(capabilityMocks.getRescheduleAvailabilityByCapability).toHaveBeenCalledWith({
      token: "capability-token",
      staffId,
      date: "2026-09-07",
    });
  });
});
