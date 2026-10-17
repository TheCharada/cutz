import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("@/infrastructure/db/client", () => ({
  getPool: () => ({ query }),
}));

import { GET } from "./route";

beforeEach(() => {
  query.mockReset();
});

describe("GET /api/health", () => {
  it("returns 200 when PostgreSQL is reachable", async () => {
    query.mockResolvedValue({ rows: [{ "?column?": 1 }] });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "ok" });
    expect(query).toHaveBeenCalledWith("select 1");
  });

  it("returns 503 without exposing the database error", async () => {
    query.mockRejectedValue(new Error("database unavailable"));

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "unavailable" });
  });
});
