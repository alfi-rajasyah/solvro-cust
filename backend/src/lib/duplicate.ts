import type { Prisma, PrismaClient } from "@prisma/client";
import { countSiblings, type SiblingKey } from "./taskOrdering.js";

type Tx = Prisma.TransactionClient | PrismaClient;

export interface DuplicateOverrides {
  sectionId?: number | null;
}

// Fields carried verbatim from source to copy — decisions 1, 3, 5, 6 and the
// date half of decision 4 in docs/plans/duplicate-tasks-sections.md §3.
// status always resets to TODO (decision 2) and baseline*Date always resets
// to null (decision 4) on every copy, top-level or subtask — never selected
// here since the copy never reads them. No TaskDependency row is ever
// created for a copy (decision 8); comments are never copied (decision 9) —
// this helper never touches the Comment or TaskDependency tables. itopTicketRef
// (docs/archive/plans/itop-integration.md Task 4.2) is likewise never
// selected/copied — a copy must not pin the same iTop ticket as its source.
// epicId IS carried verbatim (docs/archive/plans/epics-spec.md §4: "lib/duplicate.ts
// copies keep epicId") — same project, so no cross-project validation is
// needed here the way routes/tasks.ts and routes/projects.ts need it on a
// client-supplied epicId.
const TASK_SELECT = {
  id: true,
  projectId: true,
  title: true,
  description: true,
  priority: true,
  startDate: true,
  dueDate: true,
  isMilestone: true,
  isCriticalPath: true,
  assignedToId: true,
  sectionId: true,
  parentTaskId: true,
  epicId: true,
  labels: { select: { id: true } },
} satisfies Prisma.TaskSelect;

type SourceTask = Prisma.TaskGetPayload<{ select: typeof TASK_SELECT }>;

async function copyOne(
  tx: Tx,
  source: SourceTask,
  newParentTaskId: number | null,
  newSectionId: number | null,
  position: number,
): Promise<number> {
  const copy = await tx.task.create({
    data: {
      projectId: source.projectId,
      title: source.title,
      description: source.description,
      status: "TODO",
      priority: source.priority,
      startDate: source.startDate,
      dueDate: source.dueDate,
      isMilestone: source.isMilestone,
      isCriticalPath: source.isCriticalPath,
      baselineStartDate: null,
      baselineDueDate: null,
      assignedToId: source.assignedToId,
      parentTaskId: newParentTaskId,
      sectionId: newSectionId,
      epicId: source.epicId,
      position,
      labels:
        source.labels.length > 0
          ? { connect: source.labels.map((l) => ({ id: l.id })) }
          : undefined,
    },
    select: { id: true },
  });
  return copy.id;
}

/**
 * Copies every task in `sourceIds` (in the given order) plus, for each one,
 * its own subtasks (in source `position` then `id` order) — the shared
 * engine behind `POST /tasks/:id/duplicate` and `POST /sections/:id/duplicate`.
 * Every copy: resets `status` to `TODO`, clears both baseline date columns,
 * connects the same labels as its source, and gets no `TaskDependency` rows
 * (dependencies are dropped; comments are never copied). A subtask source
 * naturally copies with no subtasks of its own — max depth is 1, so it has
 * none to find. Every top-level copy keeps its source's own `parentTaskId`
 * (null for a top-level source, the shared parent for a subtask source) —
 * there is no way to re-parent a copy under a *different* task here, which
 * would risk building a depth-2 tree with no `assertValidParent` guard.
 *
 * `overrides.sectionId`, when given, replaces `sectionId` on the copy of
 * each id listed directly in `sourceIds` — e.g. the section-duplicate route
 * passes `{ sectionId: newSectionId }` to land its tasks' copies in the new
 * section. A subtask copy follows its parent's override only if the subtask
 * shared its parent's original section (`subtask.sectionId ===
 * source.sectionId`); a subtask that carried a different (or no) section of
 * its own keeps that value untouched — mirrors the app's normal
 * parent-to-subtask section inheritance instead of forcing every subtask
 * into the new section regardless of its prior assignment.
 *
 * Each copy (top-level or subtask) is appended at the end of its destination
 * sibling list — placement within that list (e.g. moving a task copy to
 * right after the source via `insertManyAfter`, or a batch of section copies
 * to right after the source section's last task) is the caller's job.
 *
 * Statement budget: the reads are batched (one query for every source, one
 * for every subtask of those sources), the append position is counted ONCE
 * per destination sibling list (`countSiblings`) and then incremented in
 * memory — a brand-new parent's subtask list starts at 0 with no count at
 * all — and each copy costs exactly one INSERT. So a section duplicate with
 * N top-level tasks and M subtasks each runs 2 + 1 + N + N·M statements, not
 * a COUNT before every row. Throws if any id in `sourceIds` doesn't resolve
 * to an existing task.
 *
 * Must run inside a `prisma.$transaction`. Returns a Map from every copied
 * source id — the top-level ids in `sourceIds` AND their copied subtask ids
 * — to its new copy's id.
 */
export async function duplicateTaskTree(
  tx: Tx,
  sourceIds: number[],
  overrides?: DuplicateOverrides,
): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  if (sourceIds.length === 0) return result;

  const sources = await tx.task.findMany({
    where: { id: { in: sourceIds } },
    select: TASK_SELECT,
  });
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const missing = sourceIds.filter((id) => !sourceById.has(id));
  if (missing.length > 0) {
    throw new Error(`duplicateTaskTree: source task(s) not found: ${missing.join(", ")}`);
  }

  const allSubtasks = await tx.task.findMany({
    where: { parentTaskId: { in: sourceIds } },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: TASK_SELECT,
  });
  const subtasksByParent = new Map<number, SourceTask[]>();
  for (const subtask of allSubtasks) {
    // Guaranteed non-null: the query above matched on parentTaskId being one
    // of sourceIds (all numbers), so a row here can't have a null parent.
    const parentId = subtask.parentTaskId!;
    const list = subtasksByParent.get(parentId);
    if (list) list.push(subtask);
    else subtasksByParent.set(parentId, [subtask]);
  }

  // Next append position per destination sibling list, seeded lazily with
  // one COUNT the first time a list is hit (the section-duplicate case hits
  // exactly one: the project's top-level list).
  const nextPosition = new Map<string, number>();
  async function takePosition(key: SiblingKey): Promise<number> {
    const k = `${key.projectId}:${key.parentTaskId ?? "top"}`;
    let next = nextPosition.get(k);
    if (next === undefined) next = await countSiblings(tx, key);
    nextPosition.set(k, next + 1);
    return next;
  }

  for (const sourceId of sourceIds) {
    const source = sourceById.get(sourceId)!;

    const newSectionId =
      overrides?.sectionId !== undefined ? overrides.sectionId : source.sectionId;

    const position = await takePosition({
      projectId: source.projectId,
      parentTaskId: source.parentTaskId,
    });
    const newTaskId = await copyOne(tx, source, source.parentTaskId, newSectionId, position);
    result.set(sourceId, newTaskId);

    // The new parent was created one statement ago and has no children yet,
    // so its subtask list starts at 0 — no COUNT needed.
    let subtaskPosition = 0;
    const subtasks = subtasksByParent.get(sourceId) ?? [];
    for (const subtask of subtasks) {
      const newSubtaskSectionId =
        overrides?.sectionId !== undefined && subtask.sectionId === source.sectionId
          ? overrides.sectionId
          : subtask.sectionId;
      const newSubtaskId = await copyOne(
        tx,
        subtask,
        newTaskId,
        newSubtaskSectionId,
        subtaskPosition++,
      );
      result.set(subtask.id, newSubtaskId);
    }
  }

  return result;
}
