import type { Prisma, PrismaClient } from "@prisma/client";
import { logger } from "../../logger.js";
import { getStorage } from "./storage.js";

type Db = Prisma.TransactionClient | PrismaClient;

/** Storage keys of a task's attachments and those of its subtasks (depth is 1). */
export async function collectTaskAttachmentKeys(db: Db, taskId: number): Promise<string[]> {
  const rows = await db.taskAttachment.findMany({
    where: { task: { OR: [{ id: taskId }, { parentTaskId: taskId }] } },
    select: { storageKey: true },
  });
  return rows.map((r) => r.storageKey);
}

/** Storage keys of every attachment on every task of a project. */
export async function collectProjectAttachmentKeys(db: Db, projectId: number): Promise<string[]> {
  const rows = await db.taskAttachment.findMany({
    where: { task: { projectId } },
    select: { storageKey: true },
  });
  return rows.map((r) => r.storageKey);
}

/**
 * Deletes stored objects after the database delete has committed. A failure is
 * logged, never thrown: the orphan sweep removes whatever is left.
 */
export async function deleteStoredObjects(keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  const storage = getStorage();
  const queue = [...keys];
  const worker = async () => {
    for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
      try {
        await storage.delete(key);
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), key },
          "Could not delete a stored attachment",
        );
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, keys.length) }, worker));
}
