// In-process scheduler for the iTop ticket sync: a periodic tick (interval
// from ItopConfig.refreshMinutes, re-read every tick so an admin change
// applies without a restart) plus a debounced `requestSync()` for the
// Refresh button, the admin "Sync now" route, and the later webhook nudge.
// Guarded by lib/itop/sync.ts's Postgres advisory lock, so a second backend
// instance (or an overlapping tick/request) cannot double-sync — see
// docs/archive/plans/itop-integration.md §2 deviation 7 and Task 1.4.
import { env } from "../../env.js";
import { logger } from "../../logger.js";
import { getItopConfig, isItopConfigured } from "./config.js";
import { syncTickets } from "./sync.js";

const FIRST_TICK_DELAY_MS = 15_000;
const MIN_INTERVAL_MINUTES = 1;
const DEBOUNCE_MS = 10_000;
// A full request that finds the sync lock held is re-queued, not dropped. The
// lock holder can work up to RUN_BUDGET_MS (25 min), so retry every 30 s for
// 30 min at most.
const LOCK_RETRY_MS = 30_000;
const LOCK_RETRY_MAX = 60;

let started = false;
let tickTimer: ReturnType<typeof setTimeout> | undefined;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let debouncedFull = false;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let running = false;

async function runTick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const config = await getItopConfig();
    if (!isItopConfigured(config)) {
      logger.debug("iTop scheduler tick: iTop is not configured, skipping");
    } else {
      await syncTickets();
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "iTop scheduler tick failed");
  } finally {
    running = false;
  }
  await scheduleNextTick();
}

async function scheduleNextTick(): Promise<void> {
  if (!started) return;
  let minutes = 5;
  try {
    const config = await getItopConfig();
    minutes = config.refreshMinutes;
  } catch {
    // keep the default; a transient config read failure shouldn't stop the loop
  }
  const delayMs = Math.max(minutes, MIN_INTERVAL_MINUTES) * 60_000;
  tickTimer = setTimeout(() => {
    void runTick();
  }, delayMs);
  tickTimer.unref?.();
}

/** No-op under test (`NODE_ENV=test`) or when `ITOP_SYNC_DISABLED=true` — call once from `src/index.ts` after `listen`. */
export function startItopScheduler(): void {
  if (env.NODE_ENV === "test" || env.ITOP_SYNC_DISABLED) return;
  if (started) return;
  started = true;
  tickTimer = setTimeout(() => {
    void runTick();
  }, FIRST_TICK_DELAY_MS);
  tickTimer.unref?.();
}

export function stopItopScheduler(): void {
  started = false;
  if (tickTimer) clearTimeout(tickTimer);
  if (debounceTimer) clearTimeout(debounceTimer);
  if (retryTimer) clearTimeout(retryTimer);
  tickTimer = undefined;
  debounceTimer = undefined;
  retryTimer = undefined;
  debouncedFull = false;
}

/**
 * Debounced 10s trailing: several calls in quick succession (e.g. a user
 * mashing Refresh) collapse into one `syncTickets()` call. `full: true` in
 * any pending call wins. Safe to call even when the scheduler itself hasn't
 * been started (e.g. under test) — it only schedules a sync, it doesn't
 * gate on `started`.
 *
 * A full request that finds another run holding the sync lock is retried
 * every LOCK_RETRY_MS until the lock frees (a scheduled tick may be running),
 * so a Refresh is never lost. An incremental request is dropped in that case:
 * the run holding the lock already pulls what it would have.
 */
export function requestSync(opts: { full?: boolean } = {}): void {
  debouncedFull = debouncedFull || Boolean(opts.full);
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const full = debouncedFull;
    debouncedFull = false;
    debounceTimer = undefined;
    void runRequested(full, 0);
  }, DEBOUNCE_MS);
  debounceTimer.unref?.();
}

async function runRequested(full: boolean, attempt: number): Promise<void> {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = undefined;
  }
  try {
    const summary = await syncTickets({ full });
    if (!summary.busy || !full) return;
    if (attempt >= LOCK_RETRY_MAX) {
      logger.warn("iTop requestSync: a full sync was dropped, the sync lock stayed held");
      return;
    }
    // A newer request has its own debounce timer and carries full forward.
    if (debounceTimer) {
      debouncedFull = true;
      return;
    }
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      void runRequested(true, attempt + 1);
    }, LOCK_RETRY_MS);
    retryTimer.unref?.();
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "iTop requestSync sync failed");
  }
}
