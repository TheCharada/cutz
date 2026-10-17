import { beforeEach, describe, expect, it, vi } from "vitest";

const capabilityMocks = vi.hoisted(() => ({
  getAppointmentCapability: vi.fn(),
  cancelAppointmentByCapability: vi.fn(),
  rescheduleAppointmentByCapability: vi.fn(),
}));

vi.mock("@/workflows/appointment-capability", () => capabilityMocks);

import { GET } from "./route";
import { POST as cancelAppointment } from "./cancel/route";
import { POST as rescheduleAppointment } from "./reschedule/route";

const appointmentId = "00000000-0000-4000-8000-000000000001";
const serviceId = "00000000-0000-4000-8000-000000000002";
const staffId = "00000000-0000-4000-8000-000000000003";

function routeContext(token = "capability-token") {
  return { params: Promise.resolve({ token }) };
}

function capabilityView(status: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW" = "SCHEDULED") {
  return {
    barbershop: { slug: "demo", timezone: "America/Sao_Paulo" },
    customer: { name: "Cliente" },
    service: { id: serviceId, name: "Corte", durationMinutes: 30 },
    staff: { id: staffId, name: "Profissional Exemplo" },
    appointment: {
      id: appointmentId,
      startsAt: new Date("2026-09-07T11:00:00.000Z"),
      endsAt: new Date("2026-09-07T11:30:00.000Z"),
      status,
      cancelledAt: null,
      cancelledBy: null,
      cancellationKind: null,
      cancellationReason: null,
      rescheduledFromId: null,
    },
  };
}

describe("appointment capability routes", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("DATABASE_URL", "postgresql://unused");
    vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
    vi.stubEnv("DEFAULT_PHONE_COUNTRY", "BR");
    vi.stubEnv("OTP_SECRET", "01234567890123456789012345678901");
    capabilityMocks.getAppointmentCapability.mockReset();
    capabilityMocks.cancelAppointmentByCapability.mockReset();
    capabilityMocks.rescheduleAppointmentByCapability.mockReset();
  });

  it("returns 404 for an unknown capability", async () => {
    capabilityMocks.getAppointmentCapability.mockResolvedValue({ status: "not-found" });

    const response = await GET(new Request("http://localhost"), routeContext());

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("returns the appointment management view without exposing a token hash", async () => {
    capabilityMocks.getAppointmentCapability.mockResolvedValue({ status: "ok", ...capabilityView() });

    const response = await GET(new Request("http://localhost"), routeContext());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.appointment.startsAt).toBe("2026-09-07T11:00:00.000Z");
    expect(JSON.stringify(body)).not.toContain("managementTokenHash");
  });

  it("rejects unknown cancellation fields", async () => {
    const response = await cancelAppointment(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "motivo", appointmentId: "forbidden" }),
      }),
      routeContext(),
    );

    expect(response.status).toBe(400);
    expect(capabilityMocks.cancelAppointmentByCapability).not.toHaveBeenCalled();
  });

  it("maps terminal cancellation to APPOINTMENT_CONFLICT", async () => {
    capabilityMocks.cancelAppointmentByCapability.mockResolvedValue({ status: "terminal-conflict" });

    const response = await cancelAppointment(
      new Request("http://localhost", { method: "POST", body: "{}" }),
      routeContext(),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "APPOINTMENT_CONFLICT" } });
  });

  it("returns idempotent cancellation result", async () => {
    capabilityMocks.cancelAppointmentByCapability.mockResolvedValue({
      status: "ok",
      changed: false,
      ...capabilityView("CANCELLED"),
    });

    const response = await cancelAppointment(
      new Request("http://localhost", { method: "POST", body: "{}" }),
      routeContext(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ changed: false, appointment: { status: "CANCELLED" } });
  });

  it("does not accept Service, Customer or endsAt in a reschedule body", async () => {
    const response = await rescheduleAppointment(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          staffId,
          startsAt: "2026-09-07T12:00:00.000Z",
          serviceId,
          customerId: "forbidden",
          endsAt: "2026-09-07T12:30:00.000Z",
        }),
      }),
      routeContext(),
    );

    expect(response.status).toBe(400);
    expect(capabilityMocks.rescheduleAppointmentByCapability).not.toHaveBeenCalled();
  });

  it("maps unavailable reschedule to APPOINTMENT_CONFLICT", async () => {
    capabilityMocks.rescheduleAppointmentByCapability.mockResolvedValue({ status: "appointment-conflict" });

    const response = await rescheduleAppointment(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ staffId, startsAt: "2026-09-07T12:00:00.000Z" }),
      }),
      routeContext(),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "APPOINTMENT_CONFLICT" } });
  });

  it("returns a new capability URL after reschedule", async () => {
    capabilityMocks.rescheduleAppointmentByCapability.mockResolvedValue({
      status: "ok",
      oldAppointment: {},
      appointment: {
        id: appointmentId,
        staffId,
        serviceId,
        startsAt: new Date("2026-09-07T12:00:00.000Z"),
        endsAt: new Date("2026-09-07T12:30:00.000Z"),
        status: "SCHEDULED",
        rescheduledFromId: "00000000-0000-4000-8000-000000000004",
      },
      managementUrl: "http://localhost:3000/a/new-capability",
    });

    const response = await rescheduleAppointment(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ staffId, startsAt: "2026-09-07T12:00:00.000Z" }),
      }),
      routeContext(),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      appointment: { status: "SCHEDULED" },
      managementUrl: "http://localhost:3000/a/new-capability",
    });
  });
});
