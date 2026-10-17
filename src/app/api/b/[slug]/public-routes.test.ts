import { beforeEach, describe, expect, it, vi } from "vitest";

const workflowMocks = vi.hoisted(() => ({
  getPublicBarbershopForBooking: vi.fn(),
  listPublicServicesForBarbershop: vi.fn(),
  listPublicStaffForBarbershop: vi.fn(),
  getPublicAvailabilityForBarbershop: vi.fn(),
}));

vi.mock("@/workflows/public-catalog", () => workflowMocks);

import { GET as getBarbershop } from "./route";
import { GET as getAvailability } from "./availability/route";
import { GET as getServices } from "./services/route";
import { GET as getStaff } from "./staff/route";

const serviceId = "00000000-0000-4000-8000-000000000001";
const staffId = "00000000-0000-4000-8000-000000000002";

function routeContext(slug = "demo") {
  return { params: Promise.resolve({ slug }) };
}

function expectNoStore(response: Response) {
  expect(response.headers.get("cache-control")).toBe("no-store");
}

describe("public catalog HTTP routes", () => {
  beforeEach(() => {
    workflowMocks.getPublicBarbershopForBooking.mockReset();
    workflowMocks.listPublicServicesForBarbershop.mockReset();
    workflowMocks.listPublicStaffForBarbershop.mockReset();
    workflowMocks.getPublicAvailabilityForBarbershop.mockReset();
  });

  it("returns public barbershop metadata and disables caching", async () => {
    const barbershop = { slug: "demo", timezone: "America/Sao_Paulo" };
    workflowMocks.getPublicBarbershopForBooking.mockResolvedValue(barbershop);

    const response = await getBarbershop(
      new Request("http://localhost/api/b/demo"),
      routeContext(),
    );

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(await response.json()).toEqual({ barbershop });
    expect(workflowMocks.getPublicBarbershopForBooking).toHaveBeenCalledWith("demo");
  });

  it("returns the stable tenant-not-found contract from the metadata endpoint", async () => {
    workflowMocks.getPublicBarbershopForBooking.mockResolvedValue(null);

    const response = await getBarbershop(
      new Request("http://localhost/api/b/missing"),
      routeContext("missing"),
    );

    expect(response.status).toBe(404);
    expectNoStore(response);
    expect(await response.json()).toEqual({
      error: {
        code: "BARBERSHOP_NOT_FOUND",
        message: "Barbershop not found",
      },
    });
    expect(workflowMocks.getPublicBarbershopForBooking).toHaveBeenCalledWith("missing");
  });

  it("returns the public service DTO and disables caching", async () => {
    const services = [{ id: serviceId, name: "Corte", durationMinutes: 30, priceCents: null }];
    workflowMocks.listPublicServicesForBarbershop.mockResolvedValue(services);

    const response = await getServices(
      new Request("http://localhost/api/b/demo/services"),
      routeContext(),
    );

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(await response.json()).toEqual({ services });
    expect(workflowMocks.listPublicServicesForBarbershop).toHaveBeenCalledWith("demo");
  });

  it("returns the public staff DTO and forwards the tenant slug", async () => {
    const staff = [{ id: staffId, name: "Profissional Exemplo" }];
    workflowMocks.listPublicStaffForBarbershop.mockResolvedValue(staff);

    const response = await getStaff(
      new Request("http://localhost/api/b/other/staff"),
      routeContext("other"),
    );

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(await response.json()).toEqual({ staff });
    expect(workflowMocks.listPublicStaffForBarbershop).toHaveBeenCalledWith("other");
  });

  it("returns the stable tenant-not-found error contract", async () => {
    workflowMocks.listPublicServicesForBarbershop.mockResolvedValue(null);

    const response = await getServices(
      new Request("http://localhost/api/b/missing/services"),
      routeContext("missing"),
    );

    expect(response.status).toBe(404);
    expectNoStore(response);
    expect(await response.json()).toEqual({
      error: {
        code: "BARBERSHOP_NOT_FOUND",
        message: "Barbershop not found",
      },
    });
  });

  it("rejects malformed availability queries before calling the workflow", async () => {
    const response = await getAvailability(
      new Request("http://localhost/api/b/demo/availability?serviceId=invalid&date=2026-02-30"),
      routeContext(),
    );

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(await response.json()).toMatchObject({
      error: {
        code: "INVALID_REQUEST",
        message: "Consulta de disponibilidade inválida.",
        fields: {
          serviceId: expect.any(Array),
          date: expect.any(Array),
        },
      },
    });
    expect(workflowMocks.getPublicAvailabilityForBarbershop).not.toHaveBeenCalled();
  });

  it("returns the stable service-not-found availability error", async () => {
    workflowMocks.getPublicAvailabilityForBarbershop.mockResolvedValue({
      status: "service-not-found",
    });

    const response = await getAvailability(
      new Request(
        `http://localhost/api/b/demo/availability?serviceId=${serviceId}&date=2026-09-07`,
      ),
      routeContext(),
    );

    expect(response.status).toBe(404);
    expectNoStore(response);
    expect(await response.json()).toEqual({
      error: {
        code: "SERVICE_NOT_FOUND",
        message: "Serviço não encontrado ou indisponível.",
      },
    });
  });

  it("returns absolute availability slots and forwards the optional staff filter", async () => {
    const slots = [
      {
        staffId,
        startsAt: "2026-09-07T12:00:00.000Z",
        endsAt: "2026-09-07T12:30:00.000Z",
      },
    ];
    workflowMocks.getPublicAvailabilityForBarbershop.mockResolvedValue({ status: "ok", slots });

    const response = await getAvailability(
      new Request(
        `http://localhost/api/b/demo/availability?serviceId=${serviceId}&date=2026-09-07&staffId=${staffId}`,
      ),
      routeContext(),
    );

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(await response.json()).toEqual({ slots });
    expect(workflowMocks.getPublicAvailabilityForBarbershop).toHaveBeenCalledWith({
      slug: "demo",
      serviceId,
      date: "2026-09-07",
      staffId,
    });
  });
});
