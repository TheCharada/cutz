import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, getPool } from "@/infrastructure/db/client";
import {
  barbershops,
  customers,
  customerSessions,
  notificationJobs,
  otpChallenges,
} from "@/infrastructure/db/schema";
import { getOtpChallengeById } from "@/modules/customers";
import { resolveCustomerPrincipal } from "@/modules/customers";
import { startPublicCustomerSession } from "@/workflows/customer-session";
import { resendPublicCustomerOtp, verifyPublicCustomerOtp } from "@/workflows/customer-otp";

const db = getDb();
const OTP_SECRET = "cutz-integration-otp-secret-at-least-32-characters";
const start = new Date("2026-09-05T12:00:00.000Z");

function clock(at: Date) {
  return { now: () => at };
}

async function fixture() {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [barbershop] = await db
    .insert(barbershops)
    .values({
      name: `OTP ${suffix}`,
      slug: `otp-${suffix}`,
      timezone: "America/Sao_Paulo",
      bookingIntervalMinutes: 15,
      customerVerificationMode: "WHATSAPP_OTP",
      waitlistOfferTtlMinutes: 10,
      reminderOffsetMinutes: 60,
    })
    .returning();
  return { barbershop };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

function sessionParams(f: Fixture) {
  return { slug: f.barbershop.slug, name: "Cliente OTP", phone: "+5511999999999" };
}

async function startChallenge(f: Fixture, at = start) {
  const result = await startPublicCustomerSession(sessionParams(f), {
    database: db,
    clock: clock(at),
    otpSecret: OTP_SECRET,
  });
  if (result.status !== "verification-required") throw new Error(`unexpected status ${result.status}`);

  const [job] = await db
    .select({ payload: notificationJobs.payload })
    .from(notificationJobs)
    .where(eq(notificationJobs.otpChallengeId, result.challenge.id));
  const code = (job.payload as { code: string }).code;
  return { result, code };
}

async function cleanup(f: Fixture) {
  const customerRows = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.barbershopId, f.barbershop.id));
  const customerIds = customerRows.map((row) => row.id);

  await db.delete(notificationJobs).where(eq(notificationJobs.barbershopId, f.barbershop.id));
  await db.delete(otpChallenges).where(eq(otpChallenges.barbershopId, f.barbershop.id));
  if (customerIds.length > 0) {
    await db.delete(customerSessions).where(inArray(customerSessions.customerId, customerIds));
  }
  await db.delete(customers).where(eq(customers.barbershopId, f.barbershop.id));
  await db.delete(barbershops).where(eq(barbershops.id, f.barbershop.id));
}

describe("customer WhatsApp OTP", () => {
  let f: Fixture;

  beforeEach(async () => {
    f = await fixture();
  });

  afterEach(async () => {
    await cleanup(f);
  });

  afterAll(async () => {
    await getPool().end();
  });

  it("creates an OTP notification and issues a PHONE_VERIFIED single-use session", async () => {
    const { result, code } = await startChallenge(f);
    const verified = await verifyPublicCustomerOtp(
      { slug: f.barbershop.slug, challengeId: result.challenge.id, code },
      { database: db, clock: clock(new Date(start.getTime() + 30_000)), otpSecret: OTP_SECRET },
    );
    expect(verified.status).toBe("ok");
    if (verified.status !== "ok") return;
    expect(verified.session.principal.verificationLevel).toBe("PHONE_VERIFIED");
    expect(verified.session.expiresAt.getTime() - (start.getTime() + 30_000)).toBe(30 * 24 * 60 * 60_000);

    const principal = await resolveCustomerPrincipal(db, {
      barbershopId: f.barbershop.id,
      token: verified.session.token,
      now: new Date(start.getTime() + 60_000),
    });
    expect(principal?.verificationLevel).toBe("PHONE_VERIFIED");

    const repeated = await verifyPublicCustomerOtp(
      { slug: f.barbershop.slug, challengeId: result.challenge.id, code },
      { database: db, clock: clock(new Date(start.getTime() + 60_000)), otpSecret: OTP_SECRET },
    );
    expect(repeated.status).toBe("already-used");
  });

  it("throttles repeated customer-session starts and allows another code after 60 seconds", async () => {
    const first = await startChallenge(f);

    const repeated = await startPublicCustomerSession(sessionParams(f), {
      database: db,
      clock: clock(new Date(start.getTime() + 10_000)),
      otpSecret: OTP_SECRET,
    });
    expect(repeated).toEqual({ status: "otp-too-soon", retryAfterMs: 50_000 });

    const beforeWindowChallenges = await db
      .select({ id: otpChallenges.id })
      .from(otpChallenges)
      .where(eq(otpChallenges.barbershopId, f.barbershop.id));
    const beforeWindowJobs = await db
      .select({ id: notificationJobs.id })
      .from(notificationJobs)
      .where(eq(notificationJobs.barbershopId, f.barbershop.id));
    expect(beforeWindowChallenges).toHaveLength(1);
    expect(beforeWindowJobs).toHaveLength(1);

    const afterWindow = await startPublicCustomerSession(sessionParams(f), {
      database: db,
      clock: clock(new Date(start.getTime() + 60_000)),
      otpSecret: OTP_SECRET,
    });
    expect(afterWindow.status).toBe("verification-required");
    if (afterWindow.status !== "verification-required") return;
    expect(afterWindow.challenge.id).not.toBe(first.result.challenge.id);

    const old = await getOtpChallengeById(db, f.barbershop.id, first.result.challenge.id);
    expect(old?.invalidatedAt?.toISOString()).toBe(new Date(start.getTime() + 60_000).toISOString());
  });

  it("serializes concurrent customer-session starts for the same tenant and phone", async () => {
    const [first, second] = await Promise.all([
      startPublicCustomerSession(sessionParams(f), {
        database: db,
        clock: clock(start),
        otpSecret: OTP_SECRET,
      }),
      startPublicCustomerSession(sessionParams(f), {
        database: db,
        clock: clock(start),
        otpSecret: OTP_SECRET,
      }),
    ]);

    expect([first.status, second.status].sort()).toEqual(["otp-too-soon", "verification-required"]);

    const challenges = await db
      .select({ id: otpChallenges.id })
      .from(otpChallenges)
      .where(eq(otpChallenges.barbershopId, f.barbershop.id));
    const jobs = await db
      .select({ id: notificationJobs.id })
      .from(notificationJobs)
      .where(eq(notificationJobs.barbershopId, f.barbershop.id));
    expect(challenges).toHaveLength(1);
    expect(jobs).toHaveLength(1);
  });

  it("invalidates a challenge after five wrong codes", async () => {
    const { result, code } = await startChallenge(f);
    const wrong = code === "000000" ? "000001" : "000000";

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await verifyPublicCustomerOtp(
        { slug: f.barbershop.slug, challengeId: result.challenge.id, code: wrong },
        { database: db, clock: clock(new Date(start.getTime() + attempt * 1000)), otpSecret: OTP_SECRET },
      );
      expect(response.status).toBe("invalid-code");
      if (response.status === "invalid-code") expect(response.attemptsRemaining).toBe(5 - attempt);
    }

    const challenge = await getOtpChallengeById(db, f.barbershop.id, result.challenge.id);
    expect(challenge?.attempts).toBe(5);
    expect(challenge?.invalidatedAt).not.toBeNull();

    const sixth = await verifyPublicCustomerOtp(
      { slug: f.barbershop.slug, challengeId: result.challenge.id, code },
      { database: db, clock: clock(new Date(start.getTime() + 10_000)), otpSecret: OTP_SECRET },
    );
    expect(sixth.status).toBe("invalidated");
  });

  it("expires challenges after ten minutes", async () => {
    const { result, code } = await startChallenge(f);
    const response = await verifyPublicCustomerOtp(
      { slug: f.barbershop.slug, challengeId: result.challenge.id, code },
      { database: db, clock: clock(new Date(start.getTime() + 10 * 60_000 + 1)), otpSecret: OTP_SECRET },
    );
    expect(response.status).toBe("expired");
  });

  it("enforces resend interval, invalidates the old challenge, and sends a new code", async () => {
    const first = await startChallenge(f);
    const tooSoon = await resendPublicCustomerOtp(
      { slug: f.barbershop.slug, challengeId: first.result.challenge.id },
      { database: db, clock: clock(new Date(start.getTime() + 59_000)), otpSecret: OTP_SECRET },
    );
    expect(tooSoon.status).toBe("too-soon");

    const resent = await resendPublicCustomerOtp(
      { slug: f.barbershop.slug, challengeId: first.result.challenge.id },
      { database: db, clock: clock(new Date(start.getTime() + 60_000)), otpSecret: OTP_SECRET },
    );
    expect(resent.status).toBe("ok");
    if (resent.status !== "ok") return;
    expect(resent.challenge.id).not.toBe(first.result.challenge.id);

    const old = await getOtpChallengeById(db, f.barbershop.id, first.result.challenge.id);
    expect(old?.invalidatedAt).not.toBeNull();

    const [nextJob] = await db
      .select({ payload: notificationJobs.payload })
      .from(notificationJobs)
      .where(eq(notificationJobs.otpChallengeId, resent.challenge.id));
    expect((nextJob.payload as { code?: string }).code).toMatch(/^\d{6}$/);
  });
});
