import { beforeEach, describe, expect, it, vi } from "vitest";

const capabilityMocks = vi.hoisted(() => ({
  getWaitlistEntryCapability: vi.fn(),
  cancelWaitlistEntryByCapability: vi.fn(),
  getWaitlistOfferCapability: vi.fn(),
  acceptWaitlistOfferByCapability: vi.fn(),
  rejectWaitlistOfferByCapability: vi.fn(),
}));

vi.mock("@/workflows/waitlist-capability", () => capabilityMocks);

import { GET as getEntry } from "./[token]/route";
import { POST as cancelEntry } from "./[token]/cancel/route";
import { GET as getOffer } from "../waitlist-offers/[token]/route";
import { POST as acceptOffer } from "../waitlist-offers/[token]/accept/route";
import { POST as rejectOffer } from "../waitlist-offers/[token]/reject/route";

const entryId = "00000000-0000-4000-8000-000000000001";
const offerId = "00000000-0000-4000-8000-000000000002";
const appointmentId = "00000000-0000-4000-8000-000000000003";
const serviceId = "00000000-0000-4000-8000-000000000004";
const staffId = "00000000-0000-4000-8000-000000000005";

function context(token = "capability-token") {
  return { params: Promise.resolve({ token }) };
}

function entryView() {
  return {
    status: "ok" as const,
    barbershop: { slug: "demo", timezone: "America/Sao_Paulo" },
    customer: { id: "customer", name: "Cliente", phoneE164: "+5514999999999" },
    service: { id: serviceId, name: "Corte", durationMinutes: 30, active: true },
    staff: { id: staffId, name: "Profissional Exemplo", active: true, acceptsAppointments: true },
    entry: {
      id: entryId,
      barbershopId: "barbershop",
      customerId: "customer",
      serviceId,
      staffId,
      desiredDate: "2026-09-07",
      earliestTime: "09:00:00",
      latestTime: "11:00:00",
      status: "ACTIVE" as const,
      createdAt: new Date("2026-09-04T12:00:00.000Z"),
      updatedAt: new Date("2026-09-04T12:00:00.000Z"),
    },
    pendingOffer: null,
  };
}

function offerView(status: "PENDING" | "ACCEPTED" | "REJECTED" | "EXPIRED" = "PENDING") {
  return {
    status: "ok" as const,
    barbershop: { slug: "demo", timezone: "America/Sao_Paulo" },
    customer: { id: "customer", name: "Cliente", phoneE164: "+5514999999999" },
    service: { id: serviceId, name: "Corte", durationMinutes: 30, active: true },
    staff: { id: staffId, name: "Profissional Exemplo", active: true, acceptsAppointments: true },
    entry: { id: entryId, status: "ACTIVE" as const },
    offer: {
      id: offerId,
      barbershopId: "barbershop",
      waitlistEntryId: entryId,
      staffId,
      startsAt: new Date("2026-09-07T12:00:00.000Z"),
      endsAt: new Date("2026-09-07T12:30:00.000Z"),
      status,
      expiresAt: new Date("2026-09-06T10:10:00.000Z"),
      appointmentId: status === "ACCEPTED" ? appointmentId : null,
      opportunityId: "opportunity",
      opportunityStartsAt: new Date("2026-09-07T12:00:00.000Z"),
      opportunityEndsAt: new Date("2026-09-07T13:00:00.000Z"),
      createdAt: new Date("2026-09-06T10:00:00.000Z"),
      respondedAt: null,
    },
  };
}

describe("waitlist capability routes", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("DATABASE_URL", "postgresql://unused");
    vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
    vi.stubEnv("DEFAULT_PHONE_COUNTRY", "BR");
    vi.stubEnv("OTP_SECRET", "01234567890123456789012345678901");
    for (const mock of Object.values(capabilityMocks)) mock.mockReset();
  });

  it("returns an entry capability without exposing its management hash", async () => {
    capabilityMocks.getWaitlistEntryCapability.mockResolvedValue(entryView());

    const response = await getEntry(new Request("http://localhost"), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      waitlistEntry: { id: entryId, status: "ACTIVE" },
      staff: { id: staffId, name: "Profissional Exemplo" },
    });
    expect(JSON.stringify(body)).not.toContain("managementTokenHash");
  });

  it("maps missing and terminal entry capabilities", async () => {
    capabilityMocks.getWaitlistEntryCapability.mockResolvedValue({ status: "not-found" });
    const missing = await getEntry(new Request("http://localhost"), context());
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: "NOT_FOUND" } });

    capabilityMocks.cancelWaitlistEntryByCapability.mockResolvedValue({ status: "entry-conflict" });
    const conflict = await cancelEntry(new Request("http://localhost", { method: "POST" }), context());
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: { code: "WAITLIST_NOT_ACTIVE" } });
  });

  it("returns an idempotent entry cancellation contract", async () => {
    capabilityMocks.cancelWaitlistEntryByCapability.mockResolvedValue({
      status: "ok",
      changed: false,
      entry: { id: entryId, status: "CANCELLED" },
    });

    const response = await cancelEntry(new Request("http://localhost", { method: "POST" }), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      changed: false,
      waitlistEntry: { id: entryId, status: "CANCELLED" },
    });
  });

  it("returns an offer capability without exposing the action hash", async () => {
    capabilityMocks.getWaitlistOfferCapability.mockResolvedValue(offerView());

    const response = await getOffer(new Request("http://localhost"), context("offer-token"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      waitlistOffer: {
        id: offerId,
        status: "PENDING",
        startsAt: "2026-09-07T12:00:00.000Z",
        endsAt: "2026-09-07T12:30:00.000Z",
      },
    });
    expect(JSON.stringify(body)).not.toContain("actionTokenHash");
  });

  it("maps stable acceptance conflicts", async () => {
    capabilityMocks.acceptWaitlistOfferByCapability.mockResolvedValue({ status: "offer-expired" });
    const expired = await acceptOffer(
      new Request("http://localhost", { method: "POST" }),
      context("offer-token"),
    );
    expect(expired.status).toBe(410);
    expect(expired.headers.get("cache-control")).toBe("no-store");
    expect(await expired.json()).toMatchObject({ error: { code: "OFFER_EXPIRED" } });

    capabilityMocks.acceptWaitlistOfferByCapability.mockResolvedValue({ status: "offer-conflict" });
    const unavailable = await acceptOffer(
      new Request("http://localhost", { method: "POST" }),
      context("offer-token"),
    );
    expect(unavailable.status).toBe(409);
    expect(await unavailable.json()).toMatchObject({ error: { code: "OFFER_NOT_AVAILABLE" } });

    capabilityMocks.acceptWaitlistOfferByCapability.mockResolvedValue({ status: "entry-conflict" });
    const inactive = await acceptOffer(
      new Request("http://localhost", { method: "POST" }),
      context("offer-token"),
    );
    expect(inactive.status).toBe(409);
    expect(await inactive.json()).toMatchObject({ error: { code: "WAITLIST_NOT_ACTIVE" } });

    capabilityMocks.acceptWaitlistOfferByCapability.mockResolvedValue({
      status: "appointment-conflict",
    });
    const appointmentConflict = await acceptOffer(
      new Request("http://localhost", { method: "POST" }),
      context("offer-token"),
    );
    expect(appointmentConflict.status).toBe(409);
    expect(await appointmentConflict.json()).toMatchObject({ error: { code: "APPOINTMENT_CONFLICT" } });
  });

  it("returns the existing appointment id when acceptance is retried", async () => {
    capabilityMocks.acceptWaitlistOfferByCapability.mockResolvedValue({
      status: "already-accepted",
      appointmentId,
    });

    const response = await acceptOffer(
      new Request("http://localhost", { method: "POST" }),
      context("offer-token"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ appointmentId, alreadyAccepted: true });
  });

  it("returns an appointment capability after a successful offer acceptance", async () => {
    capabilityMocks.acceptWaitlistOfferByCapability.mockResolvedValue({
      status: "ok",
      appointment: {
        id: appointmentId,
        staffId,
        serviceId,
        startsAt: new Date("2026-09-07T12:00:00.000Z"),
        endsAt: new Date("2026-09-07T12:30:00.000Z"),
        status: "SCHEDULED",
      },
      managementUrl: "http://localhost:3000/a/appointment-token",
    });

    const response = await acceptOffer(
      new Request("http://localhost", { method: "POST" }),
      context("offer-token"),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      appointment: { id: appointmentId, status: "SCHEDULED" },
      managementUrl: "http://localhost:3000/a/appointment-token",
    });
  });

  it("reports whether rejecting an offer chained the next candidate", async () => {
    capabilityMocks.rejectWaitlistOfferByCapability.mockResolvedValue({
      status: "ok",
      offer: { id: offerId, status: "REJECTED" },
      next: { status: "offered" },
    });

    const response = await rejectOffer(
      new Request("http://localhost", { method: "POST" }),
      context("offer-token"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      waitlistOffer: { id: offerId, status: "REJECTED" },
      nextOfferCreated: true,
    });
  });

  it("keeps repeated offer rejection idempotent", async () => {
    capabilityMocks.rejectWaitlistOfferByCapability.mockResolvedValue({
      status: "already-rejected",
      offer: { id: offerId, status: "REJECTED" },
    });

    const response = await rejectOffer(
      new Request("http://localhost", { method: "POST" }),
      context("offer-token"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      waitlistOffer: { id: offerId, status: "REJECTED" },
      nextOfferCreated: false,
      alreadyRejected: true,
    });
  });
});
