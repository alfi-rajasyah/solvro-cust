import type { Task, TaskStatus, TaskStatusRef } from "./queries";

// Test support: the three seeded workspace statuses (ids as migrated), so task
// fixtures can carry the `statusId` / `statusDef` every task payload has.
const SEEDED: Record<TaskStatus, TaskStatusRef> = {
  TODO: { id: 1, name: "To do", color: "gray", category: "TODO", position: 0 },
  IN_PROGRESS: { id: 2, name: "In progress", color: "primary", category: "IN_PROGRESS", position: 1 },
  DONE: { id: 3, name: "Done", color: "emerald", category: "DONE", position: 2 },
};

/** Fills `statusId` / `statusDef` from `status` unless the fixture set them. */
export function withStatus<T extends Omit<Task, "statusId" | "statusDef"> & Partial<Pick<Task, "statusId" | "statusDef">>>(
  task: T,
): Task {
  const def = task.statusDef ?? SEEDED[task.status];
  return { ...task, statusId: task.statusId ?? def.id, statusDef: def };
}
