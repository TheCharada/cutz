import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/infrastructure/db/client";
import type { MessagingProvider } from "@/modules/notifications";
import { FixedClock } from "@/shared/clock";
import {
  runNotificationLoop,
  runWaitlistMaintenanceLoop,
  waitForAbortableDelay,
  type WorkerRuntimeConfig,
} from "./runtime";

const database = {} as Database;
const provider: MessagingProvider = {
  async send() {
    return {};
  },
};
const config: WorkerRuntimeConfig = {
  appOrigin: "http://localhost:3000",
  notificationPollMs: 1000,
  waitlistPollMs: 1000,
  waitlistEntrySweepMs: 60_000,
  notificationBatchSize: 25,
  notificationConcurrency: 5,
  processingLeaseMs: 120_000,
  recoveryIntervalMs: 60_000,
  providerTimeoutMs: 15_000,
  dbErrorBackoffMs: 5000,
};
const clock = new FixedClock(new Date("2026-09-05T10:00:00.000Z"));

describe("worker runtime", () => {
  it("interrupts polling delays through AbortSignal", async () => {
    const controller = new AbortController();
    const delay = waitForAbortableDelay(60_000, controller.signal);
    controller.abort();
    await expect(delay).resolves.toBeUndefined();
  });

  it("does not claim notifications when shutdown arrives during lease recovery", async () => {
    const stop = new AbortController();
    const providerAbort = new AbortController();
    const recoverNotifications = vi.fn(async () => {
      stop.abort();
      return { recovered: 0 };
    });
    const processNotifications = vi.fn(async () => ({ claimed: 0, results: [] }));

    await runNotificationLoop({
      database,
      provider,
      config,
      stopSignal: stop.signal,
      providerSignal: providerAbort.signal,
      clock,
      operations: {
        recoverNotifications,
        processNotifications,
        expireWaitlistOffers: async () => ({ scanned: 0, processed: 0 }),
        expireWaitlistEntries: async () => ({ scanned: 0, processed: 0 }),
      },
    });

    expect(recoverNotifications).toHaveBeenCalledTimes(1);
    expect(processNotifications).not.toHaveBeenCalled();
  });

  it("stops notification polling after an in-flight processing cycle observes shutdown", async () => {
    const stop = new AbortController();
    const providerAbort = new AbortController();
    const recoverNotifications = vi.fn(async () => ({ recovered: 0 }));
    const processNotifications = vi.fn(async () => {
      stop.abort();
      return { claimed: 0, results: [] };
    });

    await runNotificationLoop({
      database,
      provider,
      config,
      stopSignal: stop.signal,
      providerSignal: providerAbort.signal,
      clock,
      operations: {
        recoverNotifications,
        processNotifications,
        expireWaitlistOffers: async () => ({ scanned: 0, processed: 0 }),
        expireWaitlistEntries: async () => ({ scanned: 0, processed: 0 }),
      },
    });

    expect(recoverNotifications).toHaveBeenCalledTimes(1);
    expect(processNotifications).toHaveBeenCalledTimes(1);
  });

  it("does not start the entry sweep when shutdown arrives during offer maintenance", async () => {
    const stop = new AbortController();
    const expireWaitlistOffers = vi.fn(async () => {
      stop.abort();
      return { scanned: 0, processed: 0 };
    });
    const expireWaitlistEntries = vi.fn(async () => ({ scanned: 0, processed: 0 }));

    await runWaitlistMaintenanceLoop({
      database,
      config,
      stopSignal: stop.signal,
      clock,
      operations: {
        recoverNotifications: async () => ({ recovered: 0 }),
        processNotifications: async () => ({ claimed: 0, results: [] }),
        expireWaitlistOffers,
        expireWaitlistEntries,
      },
    });

    expect(expireWaitlistOffers).toHaveBeenCalledTimes(1);
    expect(expireWaitlistEntries).not.toHaveBeenCalled();
  });
});
