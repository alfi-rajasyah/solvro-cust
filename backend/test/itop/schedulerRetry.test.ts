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
});
