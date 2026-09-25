import type { Prisma, PrismaClient } from "@prisma/client";
import { HttpError } from "../http/errors.js";

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * Guard: an `epicId` set on a task write must reference an epic in the same
 * project (400 `epic_not_found` — same convention as `customer_not_found`;
 * mirrors taskOrdering.ts's assertSectionInProject for the same cross-project
 * IDOR reasoning: without this a `task:write` caller could connect their task
 * to an epic id from a project they can't see, and the task read-back would
 * leak that epic's title/color). Kept out of taskOrdering.ts (spine file) —
 * see docs/archive/plans/epics-spec.md §4/§7 T1.
 */
export async function assertValidEpic(
  tx: Tx,
  projectId: number,
  epicId: number,
): Promise<void> {
  const epic = await tx.epic.findUnique({
    where: { id: epicId },
    select: { projectId: true },
  });
  if (!epic || epic.projectId !== projectId) {
    throw new HttpError(400, "epic_not_found", "Epic not found");
  }
}

/**
 * Guard: `epicId` may only be set on a top-level task. Epics group stories
 * (top-level tasks); a subtask always inherits its parent's epic for display
 * rather than carrying its own (400 `epic_on_subtask`). `parentTaskId` here
 * is whatever the task's parent will be AFTER this write is applied (the
 * caller resolves that first — current value, or the new value from the
 * same request when it also sets parentTaskId).
 */
export function assertEpicNotOnSubtask(
  epicId: number | null | undefined,
  effectiveParentTaskId: number | null,
): void {
  if (epicId != null && effectiveParentTaskId !== null) {
    throw new HttpError(
      400,
      "epic_on_subtask",
      "Cannot set an epic on a subtask; epics apply to top-level tasks only",
    );
  }
}
