import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionMocks = vi.hoisted(() => ({ startPublicCustomerSession: vi.fn() }));
const appointmentMocks = vi.hoisted(() => ({ createPublicAppointment: vi.fn() }));

vi.mock("@/workflows/customer-session", () => sessionMocks);
vi.mock("@/workflows/public-appointment", () => appointmentMocks);

import { POST as createAppointment } from "./appointments/route";
import { POST as createCustomerSession } from "./customer-session/route";

const serviceId = "00000000-0000-4000-8000-000000000001";
const staffId = "00000000-0000-4000-8000-000000000002";
const appointmentId = "00000000-0000-4000-8000-000000000003";

function routeContext(slug = "demo") {
  return { params: Promise.resolve({ slug }) };
}

function expectNoStore(response: Response) {
  expect(response.headers.get("cache-control")).toBe("no-store");
}

describe("public booking HTTP routes", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("DATABASE_URL", "postgresql://unused");
    vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
    vi.stubEnv("DEFAULT_PHONE_COUNTRY", "BR");
    vi.stubEnv("OTP_SECRET", "01234567890123456789012345678901");
    sessionMocks.startPublicCustomerSession.mockReset();
    appointmentMocks.createPublicAppointment.mockReset();
  });

  it("creates an UNVERIFIED customer session in an HttpOnly tenant cookie", async () => {
    sessionMocks.startPublicCustomerSession.mockResolvedValue({
      status: "ok",
      session: {
        token: "raw-session-token",
        expiresAt: new Date("2026-09-08T10:00:00.000Z"),
        principal: {
          id: "customer-1",
          barbershopId: "tenant-1",
          name: "Cliente",
          phoneE164: "+5514999990001",
          verificationLevel: "UNVERIFIED",
        },
      },
    });

    const response = await createCustomerSession(
      new Request("http://localhost:3000/api/b/demo/customer-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Cliente", phone: "(14) 99999-0001" }),
      }),
      routeContext(),
    );

    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(response.headers.get("set-cookie")).toContain(
      "cutz_customer_session_demo=raw-session-token",
    );
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Lax");
    expect(await response.json()).toEqual({
      customer: { name: "Cliente", phoneE164: "+5514999990001" },
      verificationLevel: "UNVERIFIED",
      expiresAt: "2026-09-08T10:00:00.000Z",
    });
  });

  it("rejects unknown customer-session fields", async () => {
    const response = await createCustomerSession(
      new Request("http://localhost:3000/api/b/demo/customer-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Cliente", phone: "14999990001", customerId: "forbidden" }),
      }),
      routeContext(),
    );

    expect(response.status).toBe(400);
    expect(sessionMocks.startPublicCustomerSession).not.toHaveBeenCalled();
  });

  it("requires a customer session before public appointment creation", async () => {
    const response = await createAppointment(
      new Request("http://localhost:3000/api/b/demo/appointments", {
        method: "POST",
        headers: { origin: "http://localhost:3000", "content-type": "application/json" },
        body: JSON.stringify({ serviceId, staffId, startsAt: "2026-09-07T11:00:00.000Z" }),
      }),
      routeContext(),
    );

    expect(response.status).toBe(401);
    expectNoStore(response);
    expect(appointmentMocks.createPublicAppointment).not.toHaveBeenCalled();
  });

  it("rejects an authenticated cookie mutation from another origin", async () => {
    const response = await createAppointment(
      new Request("http://localhost:3000/api/b/demo/appointments", {
        method: "POST",
        headers: {
          origin: "https://attacker.example",
          cookie: "cutz_customer_session_demo=session-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ serviceId, staffId, startsAt: "2026-09-07T11:00:00.000Z" }),
      }),
      routeContext(),
    );

    expect(response.status).toBe(403);
    expect(appointmentMocks.createPublicAppointment).not.toHaveBeenCalled();
  });

  it("does not accept tenant, Customer or endsAt from the booking body", async () => {
    const response = await createAppointment(
      new Request("http://localhost:3000/api/b/demo/appointments", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          cookie: "cutz_customer_session_demo=session-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          serviceId,
          staffId,
          startsAt: "2026-09-07T11:00:00.000Z",
          endsAt: "2026-09-07T11:30:00.000Z",
          customerId: "forbidden",
          barbershopId: "forbidden",
        }),
      }),
      routeContext(),
    );

    expect(response.status).toBe(400);
    expect(appointmentMocks.createPublicAppointment).not.toHaveBeenCalled();
  });

  it("returns the public Appointment DTO and capability URL", async () => {
    appointmentMocks.createPublicAppointment.mockResolvedValue({
      status: "ok",
      appointment: {
        id: appointmentId,
        customerId: "internal-customer",
        staffId,
        serviceId,
        startsAt: new Date("2026-09-07T11:00:00.000Z"),
        endsAt: new Date("2026-09-07T11:30:00.000Z"),
        status: "SCHEDULED",
      },
      managementUrl: `http://localhost:3000/a/capability-token`,
    });

    const response = await createAppointment(
      new Request("http://localhost:3000/api/b/demo/appointments", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          cookie: "cutz_customer_session_demo=session-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ serviceId, staffId, startsAt: "2026-09-07T11:00:00.000Z" }),
      }),
      routeContext(),
    );

    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(await response.json()).toEqual({
      appointment: {
        id: appointmentId,
        staffId,
        serviceId,
        startsAt: "2026-09-07T11:00:00.000Z",
        endsAt: "2026-09-07T11:30:00.000Z",
        status: "SCHEDULED",
      },
      managementUrl: "http://localhost:3000/a/capability-token",
    });
    expect(appointmentMocks.createPublicAppointment).toHaveBeenCalledWith(
      {
        slug: "demo",
        sessionToken: "session-token",
        serviceId,
        staffId,
        startsAt: new Date("2026-09-07T11:00:00.000Z"),
      },
      { appOrigin: "http://localhost:3000" },
    );
  });

  it.each([
    ["schedule-conflict", "SCHEDULE_CONFLICT"],
    ["appointment-conflict", "APPOINTMENT_CONFLICT"],
  ])("maps %s to the stable 409 contract", async (status, code) => {
    appointmentMocks.createPublicAppointment.mockResolvedValue({ status });

    const response = await createAppointment(
      new Request("http://localhost:3000/api/b/demo/appointments", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          cookie: "cutz_customer_session_demo=session-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ serviceId, staffId, startsAt: "2026-09-07T11:00:00.000Z" }),
      }),
      routeContext(),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code } });
  });
});
