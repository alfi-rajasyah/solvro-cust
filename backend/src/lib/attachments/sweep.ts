// Orphan sweep for attachment storage: an in-process daily job that deletes
// stored objects no TaskAttachment row points at (a failed post-commit delete,
// a crash between the upload and the insert). Same lifecycle as
// lib/activityCleanup.ts (started once from src/index.ts, unref'd timer, off
// under NODE_ENV=test).
import { env } from "../../env.js";
import { logger } from "../../logger.js";
import { prisma } from "../../prisma.js";
import { getStorage } from "./storage.js";
import type { AttachmentStorage } from "./types.js";

/** Objects younger than this are never swept: an upload may still be in flight. */
export const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 5 * 60_000;
const INTERVAL_MS = 24 * 60 * 60 * 1000;
const BATCH = 500;

let started = false;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Deletes old stored objects that have no row; returns how many went. */
export async function sweepOrphanAttachments(
  now: Date = new Date(),
  storage: AttachmentStorage = getStorage(),
): Promise<number> {
  const cutoff = now.getTime() - ORPHAN_MIN_AGE_MS;
  let deleted = 0;

  const flush = async (keys: string[]) => {
    if (keys.length === 0) return;
    const known = await prisma.taskAttachment.findMany({
      where: { storageKey: { in: keys } },
      select: { storageKey: true },
    });
    const referenced = new Set(known.map((r) => r.storageKey));
    for (const key of keys) {
      if (referenced.has(key)) continue;
      try {
        await storage.delete(key);
        deleted += 1;
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), key },
          "Attachment sweep could not delete an orphan",
        );
      }
    }
  };

  let batch: string[] = [];
  for await (const item of storage.list()) {
    if (item.lastModified.getTime() >= cutoff) continue;
    batch.push(item.key);
    if (batch.length >= BATCH) {
      await flush(batch);
      batch = [];
    }
  }
  await flush(batch);
  return deleted;
}

async function run(): Promise<void> {
  try {
    const count = await sweepOrphanAttachments();
    if (count > 0) logger.info({ count }, "Attachment sweep removed orphan files");
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "Attachment sweep failed",
    );
  }
  scheduleNext(INTERVAL_MS);
}

function scheduleNext(delayMs: number): void {
  if (!started) return;
  timer = setTimeout(() => {
    void run();
  }, delayMs);
  timer.unref?.();
}

/** No-op under test (`NODE_ENV=test`) — call once from `src/index.ts` after `listen`. */
export function startAttachmentSweep(): void {
  if (env.NODE_ENV === "test") return;
  if (started) return;
  started = true;
  scheduleNext(FIRST_RUN_DELAY_MS);
}

export function stopAttachmentSweep(): void {
  started = false;
  if (timer) clearTimeout(timer);
  timer = undefined;
}
