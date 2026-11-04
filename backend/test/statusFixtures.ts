import type { TaskStatus } from "@prisma/client";
import { prisma } from "../src/prisma.js";

// The three default task statuses globalSetup seeds after truncating, with
// fixed ids so fixtures can build tasks synchronously:
//   prisma.task.create({ data: { projectId, title, statusId: SID.TODO } })
// `status` (the category) must match the status's category — tests that need a
// non-default status create their own def. Prisma creates cannot omit
// `statusId` (NOT NULL, no DB default), so every fixture names one.
export const SID = { TODO: 1, IN_PROGRESS: 2, DONE: 3 } as const satisfies Record<TaskStatus, number>;

export const DEFAULT_STATUS_ROWS = [
  { id: 1, name: "To do", category: "TODO", color: "gray", position: 0 },
  { id: 2, name: "In progress", category: "IN_PROGRESS", color: "primary", position: 1 },
  { id: 3, name: "Done", category: "DONE", color: "emerald", position: 2 },
] as const;

/**
 * Puts the status list back to exactly the three seeded defaults (ids 1-3).
 * For tests that edit the list; tasks must be gone or already on ids 1-3.
 */
export async function resetStatusDefs(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Tasks must already be off any status above id 3 (Restrict FK would throw).
    await tx.taskStatusDef.deleteMany({ where: { id: { notIn: [1, 2, 3] } } });
    // Default flags first: a leftover default would trip the one-per-category index.
    await tx.taskStatusDef.updateMany({ data: { isDefault: false } });
    // Park the names first so a swapped/renamed list cannot trip the unique name.
    for (const row of DEFAULT_STATUS_ROWS) {
      await tx.taskStatusDef.updateMany({ where: { id: row.id }, data: { name: `__reset_${row.id}` } });
    }
    for (const row of DEFAULT_STATUS_ROWS) {
      await tx.taskStatusDef.upsert({
        where: { id: row.id },
        create: { ...row, isDefault: true },
        update: { ...row, isDefault: true },
      });
    }
    // A category edit carried tasks' `status` along; carry it back.
    await tx.$executeRaw`UPDATE tasks t SET status = d.category
      FROM task_status_defs d WHERE d.id = t.status_id AND t.status <> d.category`;
  });
}
