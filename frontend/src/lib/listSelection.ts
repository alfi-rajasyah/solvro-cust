import type { Task } from "@/lib/queries";

/**
 * Row selection for the List view's bulk edit. Selection is kept by task id,
 * as a set, so it survives re-sorts and refetches. Every helper is pure and
 * returns the same set instance when nothing changed (React skips the render).
 */

export type SelectAllState = "none" | "some" | "all";

/**
 * Ids of the rows actually on screen: every top-level task, plus its subtasks
 * unless that row's subtask list is collapsed. Collapsed sections are left out
 * by the caller (it passes only the expanded sections' nodes).
 */
export function collectVisibleIds(
  nodes: { task: Pick<Task, "id">; subtasks: Pick<Task, "id">[] }[],
  collapsedRows: ReadonlySet<number> = new Set(),
): number[] {
  const ids: number[] = [];
  for (const n of nodes) {
    ids.push(n.task.id);
    if (collapsedRows.has(n.task.id)) continue;
    for (const s of n.subtasks) ids.push(s.id);
  }
  return ids;
}

/** Success line after a bulk request; `updated` counts tasks that actually changed. */
export function bulkResultMessage(updated: number): string {
  if (updated === 0) return "No tasks changed.";
  return `Updated ${updated} ${updated === 1 ? "task" : "tasks"}.`;
}

/** Drops ids that are no longer visible (filtered out, deleted). */
export function pruneSelection(selected: ReadonlySet<number>, visible: ReadonlySet<number>): Set<number> {
  let dropped = false;
  const next = new Set<number>();
  for (const id of selected) {
    if (visible.has(id)) next.add(id);
    else dropped = true;
  }
  return dropped ? next : (selected as Set<number>);
}

export function toggleSelected(selected: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function selectAllState(selected: ReadonlySet<number>, visibleIds: readonly number[]): SelectAllState {
  if (visibleIds.length === 0) return "none";
  let hits = 0;
  for (const id of visibleIds) if (selected.has(id)) hits += 1;
  if (hits === 0) return "none";
  return hits === visibleIds.length ? "all" : "some";
}

/** Header checkbox: select every visible id unless all are already selected, then clear them. */
export function toggleAllVisible(selected: ReadonlySet<number>, visibleIds: readonly number[]): Set<number> {
  if (selectAllState(selected, visibleIds) === "all") {
    const next = new Set(selected);
    for (const id of visibleIds) next.delete(id);
    return next;
  }
  const next = new Set(selected);
  for (const id of visibleIds) next.add(id);
  return next;
}

/** True when any selected task is a subtask (epics apply to top-level tasks only). */
export function selectionHasSubtask(
  selected: ReadonlySet<number>,
  tasks: readonly Pick<Task, "id" | "parentTaskId">[],
): boolean {
  return tasks.some((t) => t.parentTaskId !== null && selected.has(t.id));
}
