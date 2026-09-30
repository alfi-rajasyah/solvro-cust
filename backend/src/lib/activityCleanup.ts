// Retention for the project activity log (lib/activity.ts): an in-process daily
// job that deletes events older than RETENTION_DAYS. Same lifecycle as
// lib/itop/scheduler.ts (started once from src/index.ts, unref'd timer, off
// under NODE_ENV=test).
import { env } from "../env.js";
import { logger } from "../logger.js";
import { prisma } from "../prisma.js";

export const ACTIVITY_RETENTION_DAYS = 180;
const FIRST_RUN_DELAY_MS = 60_000;
const INTERVAL_MS = 24 * 60 * 60 * 1000;

let started = false;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Deletes events created before `now - 180 days`; returns how many went. */
export async function deleteExpiredActivityEvents(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const { count } = await prisma.activityEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return count;
}

async function runCleanup(): Promise<void> {
  try {
    const count = await deleteExpiredActivityEvents();
    if (count > 0) logger.info({ count }, "Activity cleanup removed expired events");
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "Activity cleanup failed",
    );
  }
  scheduleNext(INTERVAL_MS);
}

function scheduleNext(delayMs: number): void {
  if (!started) return;
  timer = setTimeout(() => {
    void runCleanup();
  }, delayMs);
  timer.unref?.();
}

/** No-op under test (`NODE_ENV=test`) — call once from `src/index.ts` after `listen`. */
export function startActivityCleanup(): void {
  if (env.NODE_ENV === "test") return;
  if (started) return;
  started = true;
  scheduleNext(FIRST_RUN_DELAY_MS);
}

export function stopActivityCleanup(): void {
  started = false;
  if (timer) clearTimeout(timer);
  timer = undefined;
}
