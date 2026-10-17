import { beforeEach, describe, expect, it, vi } from "vitest";

const waitlistMocks = vi.hoisted(() => ({
  createPublicWaitlistEntry: vi.fn(),
}));

vi.mock("@/workflows/public-waitlist", () => waitlistMocks);

import { POST } from "./route";

const serviceId = "00000000-0000-4000-8000-000000000001";
const staffId = "00000000-0000-4000-8000-000000000002";

function context(slug = "demo") {
  return { params: Promise.resolve({ slug }) };
}

function request(
  body: unknown,
  options: { cookie?: string; origin?: string } = {},
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.origin) headers.set("origin", options.origin);
  return new Request("http://localhost/api/b/demo/waitlist", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function validBody() {
  return {
    serviceId,
    desiredDate: "2026-09-07",
    earliestTime: "09:00",
    latestTime: "11:00",
  };
}

describe("public waitlist route", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("DATABASE_URL", "postgresql://unused");
    vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
    vi.stubEnv("DEFAULT_PHONE_COUNTRY", "BR");
    vi.stubEnv("OTP_SECRET", "01234567890123456789012345678901");
    waitlistMocks.createPublicWaitlistEntry.mockReset();
  });

  it("requires a customer session", async () => {
    const response = await POST(
      request(validBody(), { origin: "http://localhost:3000" }),
      context(),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      error: { code: "CUSTOMER_SESSION_REQUIRED" },
    });
    expect(waitlistMocks.createPublicWaitlistEntry).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin mutation", async () => {
    const response = await POST(
      request(validBody(), {
        cookie: "cutz_customer_session_demo=session-token",
        origin: "https://example.invalid",
      }),
      context(),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_ORIGIN" } });
    expect(waitlistMocks.createPublicWaitlistEntry).not.toHaveBeenCalled();
  });

  it("rejects an invalid local window before calling the workflow", async () => {
    const response = await POST(
      request(
        { ...validBody(), earliestTime: "11:00", latestTime: "10:00" },
        {
          cookie: "cutz_customer_session_demo=session-token",
          origin: "http://localhost:3000",
        },
      ),
      context(),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    expect(waitlistMocks.createPublicWaitlistEntry).not.toHaveBeenCalled();
  });

  it("creates a tenant-scoped waitlist entry and forwards optional staff", async () => {
    waitlistMocks.createPublicWaitlistEntry.mockResolvedValue({
      status: "ok",
      entry: {
        id: "00000000-0000-4000-8000-000000000003",
        serviceId,
        staffId,
        desiredDate: "2026-09-07",
        earliestTime: "09:00:00",
        latestTime: "11:00:00",
        status: "ACTIVE",
      },
      managementUrl: "http://localhost:3000/w/management-token",
    });

    const response = await POST(
      request(
        { ...validBody(), staffId },
        {
          cookie: "cutz_customer_session_demo=session-token",
          origin: "http://localhost:3000",
        },
      ),
      context(),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(waitlistMocks.createPublicWaitlistEntry).toHaveBeenCalledWith(
      {
        slug: "demo",
        sessionToken: "session-token",
        serviceId,
        staffId,
        desiredDate: "2026-09-07",
        earliestTime: "09:00",
        latestTime: "11:00",
      },
      { appOrigin: "http://localhost:3000" },
    );
    const body = await response.json();
    expect(body).toMatchObject({
      waitlistEntry: { status: "ACTIVE", serviceId, staffId },
      managementUrl: "http://localhost:3000/w/management-token",
    });
    expect(JSON.stringify(body)).not.toContain("managementTokenHash");
  });

  it.each([
    ["barbershop-not-found", 404, "BARBERSHOP_NOT_FOUND"],
    ["customer-session-invalid", 401, "CUSTOMER_SESSION_REQUIRED"],
    ["service-not-found", 404, "SERVICE_NOT_FOUND"],
    ["staff-not-found", 404, "STAFF_NOT_FOUND"],
    ["invalid-window", 409, "INVALID_WAITLIST_WINDOW"],
  ] as const)("maps %s to a stable HTTP error", async (status, expectedStatus, code) => {
    waitlistMocks.createPublicWaitlistEntry.mockResolvedValue({ status });

    const response = await POST(
      request(validBody(), {
        cookie: "cutz_customer_session_demo=session-token",
        origin: "http://localhost:3000",
      }),
      context(),
    );

    expect(response.status).toBe(expectedStatus);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ error: { code } });
  });
});
