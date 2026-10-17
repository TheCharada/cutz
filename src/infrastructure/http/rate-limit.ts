import { isIP } from "node:net";
import {
  getAntiAbuseEnv,
  getRateLimitPolicy,
  type RateLimitClass,
} from "@/config/anti-abuse";
import { jsonResponse } from "./response";

type Bucket = {
  windowStartedAt: number;
  count: number;
};

type RateLimitResult = {
  allowed: boolean;
  retryAfterMs: number;
};

const buckets = new Map<string, Bucket>();
let operationsSinceSweep = 0;

function clientIp(request: Request) {
  const env = getAntiAbuseEnv();

  if (env.RATE_LIMIT_TRUST_X_REAL_IP) {
    const candidate = request.headers.get("x-real-ip")?.trim();
    return candidate && isIP(candidate) ? candidate : null;
  }

  const trustedProxyHops = env.RATE_LIMIT_TRUSTED_PROXY_HOPS;
  if (trustedProxyHops === 0) return null;

  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!forwarded?.length) return null;

  const candidate = forwarded[forwarded.length - trustedProxyHops];
  return candidate && isIP(candidate) ? candidate : null;
}

function sweepExpiredBuckets(now: number) {
  operationsSinceSweep += 1;
  if (operationsSinceSweep < 1000) return;
  operationsSinceSweep = 0;

  const maxWindowMs = Math.max(
    getRateLimitPolicy("STRICT").windowMs,
    getRateLimitPolicy("MODERATE").windowMs,
    getRateLimitPolicy("LOOSE").windowMs,
  );
  for (const [key, bucket] of buckets) {
    if (bucket.windowStartedAt + maxWindowMs <= now) buckets.delete(key);
  }
}

function consume(keys: string[], rateClass: RateLimitClass, now: number): RateLimitResult {
  const policy = getRateLimitPolicy(rateClass);
  sweepExpiredBuckets(now);

  const current = keys.map((key) => {
    const existing = buckets.get(key);
    if (!existing || existing.windowStartedAt + policy.windowMs <= now) {
      return { key, bucket: { windowStartedAt: now, count: 0 } satisfies Bucket };
    }
    return { key, bucket: existing };
  });

  const blocked = current.find(({ bucket }) => bucket.count >= policy.max);
  if (blocked) {
    return {
      allowed: false,
      retryAfterMs: Math.max(1, blocked.bucket.windowStartedAt + policy.windowMs - now),
    };
  }

  for (const { key, bucket } of current) {
    buckets.set(key, { windowStartedAt: bucket.windowStartedAt, count: bucket.count + 1 });
  }
  return { allowed: true, retryAfterMs: 0 };
}

export function checkRequestRateLimit(
  request: Request,
  rateClass: RateLimitClass,
  options: { phoneE164?: string; now?: number } = {},
) {
  const keys: string[] = [];
  const ip = clientIp(request);
  if (ip) keys.push(`${rateClass}:ip:${ip}`);
  if (options.phoneE164) keys.push(`${rateClass}:phone:${options.phoneE164}`);
  return consume(keys, rateClass, options.now ?? Date.now());
}

export function rateLimitResponse(result: RateLimitResult) {
  const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
  return jsonResponse(
    {
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests",
        fields: null,
      },
    },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds) },
    },
  );
}

export function enforceRequestRateLimit(
  request: Request,
  rateClass: RateLimitClass,
  options: { phoneE164?: string; now?: number } = {},
) {
  const result = checkRequestRateLimit(request, rateClass, options);
  return result.allowed ? null : rateLimitResponse(result);
}

export function resetRateLimitsForTests() {
  buckets.clear();
  operationsSinceSweep = 0;
}
