// A full sync requested by Refresh while another run holds the sync lock is
// re-queued until the lock frees, not dropped.
import "../env.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const syncTickets = vi.fn();
vi.mock("../../src/lib/itop/sync.js", () => ({ syncTickets: (...a: unknown[]) => syncTickets(...a) }));

const { requestSync, stopItopScheduler } = await import("../../src/lib/itop/scheduler.js");

const summary = (busy: boolean) => ({ ran: !busy, busy, full: true });

beforeEach(() => {
  vi.useFakeTimers();
  syncTickets.mockReset();
});

afterEach(() => {
  stopItopScheduler();
  vi.useRealTimers();
});

describe("requestSync with the sync lock held", () => {
  it("retries a full request until the lock frees", async () => {
    syncTickets
      .mockResolvedValueOnce(summary(true))
      .mockResolvedValueOnce(summary(true))
      .mockResolvedValueOnce(summary(false));
    requestSync({ full: true });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(syncTickets).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(syncTickets).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(syncTickets).toHaveBeenCalledTimes(3);
    expect(syncTickets).toHaveBeenLastCalledWith({ full: true });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(syncTickets).toHaveBeenCalledTimes(3);
  });

  it("does not retry an incremental request", async () => {
    syncTickets.mockResolvedValue(summary(true));
    requestSync({ full: false });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(syncTickets).toHaveBeenCalledTimes(1);
  });

  it("does not retry when the run was not blocked by the lock", async () => {
    syncTickets.mockResolvedValue({ ran: false, busy: false, full: true });
    requestSync({ full: true });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(syncTickets).toHaveBeenCalledTimes(1);
  });

  it("gives up after the retry cap", async () => {
    syncTickets.mockResolvedValue(summary(true));
    requestSync({ full: true });
    await vi.advanceTimersByTimeAsync(10_000 + 61 * 30_000);
    expect(syncTickets).toHaveBeenCalledTimes(61);
  });

  it("a repeated Refresh does not extend the retry deadline", async () => {
    syncTickets.mockResolvedValue(summary(true));
    requestSync({ full: true });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(syncTickets).toHaveBeenCalledTimes(1);
    // A Refresh about once a minute for 29 minutes while the lock stays held.
    for (let i = 0; i < 29; i++) {
      await vi.advanceTimersByTimeAsync(50_000);
      requestSync({ full: true });
      await vi.advanceTimersByTimeAsync(10_000);
    }
    // The window opened at t=10 s and closes at t=1810 s; Refreshes stopped at ~1750 s.
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    const callsAfterDeadline = syncTickets.mock.calls.length;
    // With a per-call counter the last Refresh would keep retrying for another 30 minutes.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(syncTickets.mock.calls.length).toBe(callsAfterDeadline);
  });

  it("starts a fresh window after the lock frees", async () => {
    syncTickets.mockResolvedValueOnce(summary(true)).mockResolvedValueOnce(summary(false));
    requestSync({ full: true });
    await vi.advanceTimersByTimeAsync(10_000 + 30_000);
    expect(syncTickets).toHaveBeenCalledTimes(2);
    syncTickets.mockResolvedValue(summary(true));
    requestSync({ full: true });
    await vi.advanceTimersByTimeAsync(10_000 + 60 * 30_000);
    expect(syncTickets).toHaveBeenCalledTimes(2 + 61);
  });

  it("starts a fresh window after a failed attempt", async () => {
    syncTickets.mockResolvedValueOnce(summary(true)).mockRejectedValueOnce(new Error("boom"));
    requestSync({ full: true });
    await vi.advanceTimersByTimeAsync(10_000 + 30_000);
    expect(syncTickets).toHaveBeenCalledTimes(2);
    syncTickets.mockResolvedValue(summary(true));
    requestSync({ full: true });
    await vi.advanceTimersByTimeAsync(10_000 + 60 * 30_000);
    expect(syncTickets).toHaveBeenCalledTimes(2 + 61);
  });

  it("an incremental nudge does not cancel a pending full retry", async () => {
    syncTickets.mockResolvedValueOnce(summary(true));
    syncTickets.mockResolvedValue(summary(false));
    requestSync({ full: true });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(syncTickets).toHaveBeenCalledTimes(1);
    // A full retry is now queued 30 s out; a webhook nudge arrives meanwhile.
    requestSync({ full: false });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(syncTickets).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(syncTickets).toHaveBeenCalledTimes(2);
    expect(syncTickets).toHaveBeenLastCalledWith({ full: true });
  });
});
