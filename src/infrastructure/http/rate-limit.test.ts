import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkRequestRateLimit,
  enforceRequestRateLimit,
  resetRateLimitsForTests,
} from "./rate-limit";

const envKeys = [
  "RATE_LIMIT_TRUSTED_PROXY_HOPS",
  "RATE_LIMIT_TRUST_X_REAL_IP",
  "RATE_LIMIT_STRICT_MAX",
  "RATE_LIMIT_STRICT_WINDOW_MS",
  "RATE_LIMIT_MODERATE_MAX",
  "RATE_LIMIT_MODERATE_WINDOW_MS",
  "RATE_LIMIT_LOOSE_MAX",
  "RATE_LIMIT_LOOSE_WINDOW_MS",
] as const;
const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]));

function request(forwardedFor: string) {
  return new Request("https://cutz.test/api", {
    headers: { "x-forwarded-for": forwardedFor },
  });
}

function realIpRequest(realIp: string, forwardedFor = "198.51.100.200") {
  return new Request("https://cutz.test/api", {
    headers: {
      "x-real-ip": realIp,
      "x-forwarded-for": forwardedFor,
    },
  });
}

beforeEach(() => {
  process.env.RATE_LIMIT_TRUSTED_PROXY_HOPS = "1";
  process.env.RATE_LIMIT_TRUST_X_REAL_IP = "false";
});

afterEach(() => {
  for (const key of envKeys) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetRateLimitsForTests();
});

describe("rate limiting", () => {
  it("enforces the configured class budget per IP", () => {
    process.env.RATE_LIMIT_STRICT_MAX = "2";
    process.env.RATE_LIMIT_STRICT_WINDOW_MS = "1000";

    expect(checkRequestRateLimit(request("203.0.113.10"), "STRICT", { now: 0 }).allowed).toBe(true);
    expect(checkRequestRateLimit(request("203.0.113.10"), "STRICT", { now: 1 }).allowed).toBe(true);
    const blocked = checkRequestRateLimit(request("203.0.113.10"), "STRICT", { now: 2 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(998);
    expect(checkRequestRateLimit(request("203.0.113.11"), "STRICT", { now: 2 }).allowed).toBe(true);
  });

  it("does not create a shared IP bucket when no proxy hops are trusted", () => {
    process.env.RATE_LIMIT_TRUSTED_PROXY_HOPS = "0";
    process.env.RATE_LIMIT_STRICT_MAX = "1";
    process.env.RATE_LIMIT_STRICT_WINDOW_MS = "1000";

    expect(checkRequestRateLimit(request("203.0.113.10"), "STRICT", { now: 0 }).allowed).toBe(true);
    expect(checkRequestRateLimit(request("203.0.113.11"), "STRICT", { now: 1 }).allowed).toBe(true);
    expect(checkRequestRateLimit(request("203.0.113.10"), "STRICT", { now: 2 }).allowed).toBe(true);
  });

  it("still limits by phone when the client IP is unresolved", () => {
    process.env.RATE_LIMIT_TRUSTED_PROXY_HOPS = "0";
    process.env.RATE_LIMIT_MODERATE_MAX = "1";
    process.env.RATE_LIMIT_MODERATE_WINDOW_MS = "1000";

    expect(
      checkRequestRateLimit(request("203.0.113.10"), "MODERATE", {
        phoneE164: "+5511999999999",
        now: 0,
      }).allowed,
    ).toBe(true);
    expect(
      checkRequestRateLimit(request("203.0.113.11"), "MODERATE", {
        phoneE164: "+5511999999999",
        now: 1,
      }).allowed,
    ).toBe(false);
  });

  it("selects the client address from the trusted right edge of X-Forwarded-For", () => {
    process.env.RATE_LIMIT_STRICT_MAX = "1";
    process.env.RATE_LIMIT_STRICT_WINDOW_MS = "1000";

    expect(
      checkRequestRateLimit(request("198.51.100.20, 203.0.113.10"), "STRICT", { now: 0 }).allowed,
    ).toBe(true);
    expect(
      checkRequestRateLimit(request("198.51.100.21, 203.0.113.10"), "STRICT", { now: 1 }).allowed,
    ).toBe(false);
    expect(
      checkRequestRateLimit(request("198.51.100.20, 203.0.113.11"), "STRICT", { now: 1 }).allowed,
    ).toBe(true);
  });

  it("supports more than one explicitly trusted proxy hop", () => {
    process.env.RATE_LIMIT_TRUSTED_PROXY_HOPS = "2";
    process.env.RATE_LIMIT_STRICT_MAX = "1";
    process.env.RATE_LIMIT_STRICT_WINDOW_MS = "1000";

    expect(
      checkRequestRateLimit(request("203.0.113.10, 192.0.2.10"), "STRICT", { now: 0 }).allowed,
    ).toBe(true);
    expect(
      checkRequestRateLimit(request("203.0.113.10, 192.0.2.11"), "STRICT", { now: 1 }).allowed,
    ).toBe(false);
    expect(
      checkRequestRateLimit(request("203.0.113.11, 192.0.2.10"), "STRICT", { now: 1 }).allowed,
    ).toBe(true);
  });

  it("uses X-Real-IP only when that proxy contract is explicitly trusted", () => {
    process.env.RATE_LIMIT_TRUST_X_REAL_IP = "true";
    process.env.RATE_LIMIT_TRUSTED_PROXY_HOPS = "0";
    process.env.RATE_LIMIT_STRICT_MAX = "1";
    process.env.RATE_LIMIT_STRICT_WINDOW_MS = "1000";

    expect(
      checkRequestRateLimit(realIpRequest("203.0.113.10", "198.51.100.10"), "STRICT", { now: 0 }).allowed,
    ).toBe(true);
    expect(
      checkRequestRateLimit(realIpRequest("203.0.113.10", "198.51.100.11"), "STRICT", { now: 1 }).allowed,
    ).toBe(false);
    expect(
      checkRequestRateLimit(realIpRequest("203.0.113.11", "198.51.100.10"), "STRICT", { now: 1 }).allowed,
    ).toBe(true);
  });

  it("does not fall back to untrusted forwarded headers when X-Real-IP mode is enabled", () => {
    process.env.RATE_LIMIT_TRUST_X_REAL_IP = "true";
    process.env.RATE_LIMIT_TRUSTED_PROXY_HOPS = "1";
    process.env.RATE_LIMIT_STRICT_MAX = "1";
    process.env.RATE_LIMIT_STRICT_WINDOW_MS = "1000";

    expect(checkRequestRateLimit(realIpRequest("invalid", "203.0.113.10"), "STRICT", { now: 0 }).allowed).toBe(true);
    expect(checkRequestRateLimit(realIpRequest("invalid", "203.0.113.10"), "STRICT", { now: 1 }).allowed).toBe(true);
  });

  it("shares a class budget across IP and normalized phone keys", () => {
    process.env.RATE_LIMIT_MODERATE_MAX = "1";
    process.env.RATE_LIMIT_MODERATE_WINDOW_MS = "1000";

    expect(
      checkRequestRateLimit(request("203.0.113.10"), "MODERATE", {
        phoneE164: "+5511999999999",
        now: 0,
      }).allowed,
    ).toBe(true);

    const blockedByPhone = checkRequestRateLimit(request("203.0.113.11"), "MODERATE", {
      phoneE164: "+5511999999999",
      now: 1,
    });
    expect(blockedByPhone.allowed).toBe(false);
  });

  it("returns the stable RATE_LIMITED HTTP contract and Retry-After", async () => {
    process.env.RATE_LIMIT_LOOSE_MAX = "1";
    process.env.RATE_LIMIT_LOOSE_WINDOW_MS = "1000";
    const req = request("203.0.113.10");

    expect(enforceRequestRateLimit(req, "LOOSE", { now: 0 })).toBeNull();
    const response = enforceRequestRateLimit(req, "LOOSE", { now: 1 });
    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("1");
    await expect(response?.json()).resolves.toEqual({
      error: { code: "RATE_LIMITED", message: "Too many requests", fields: null },
    });
  });

  it("resets the bucket after the class window", () => {
    process.env.RATE_LIMIT_STRICT_MAX = "1";
    process.env.RATE_LIMIT_STRICT_WINDOW_MS = "1000";
    const req = request("203.0.113.10");

    expect(checkRequestRateLimit(req, "STRICT", { now: 0 }).allowed).toBe(true);
    expect(checkRequestRateLimit(req, "STRICT", { now: 999 }).allowed).toBe(false);
    expect(checkRequestRateLimit(req, "STRICT", { now: 1000 }).allowed).toBe(true);
  });
});
