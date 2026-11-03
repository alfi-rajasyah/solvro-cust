import type { Task, TaskStatusDef } from "@/lib/queries";
import { compareStatusDefs } from "@/lib/taskStatuses";

// Columns are the workspace's task statuses (docs/archive/plans/custom-task-statuses.md
// §3 B3): one column per `TaskStatusDef`. ReUI's Kanban keys its `value`
// record by string and resolves a dnd-kit id to a column OR an item by looking
// it up in that record — item ids are `String(task.id)`, so a bare def id
// ("5") could collide with task 5. Column ids are therefore `status-<defId>`.
// With the three seeded defs the board is the same TODO / IN_PROGRESS / DONE
// triplet as before.

const COLUMN_ID_PREFIX = "status-";

/** Column id of a status def (the key in the projected `Record<string, Task[]>`). */
export function columnIdOf(def: Pick<TaskStatusDef, "id">): string {
  return `${COLUMN_ID_PREFIX}${def.id}`;
}

/** Inverse of `columnIdOf`: the status def id a column id names, or `null` if it is not a column id. */
export function statusIdOfColumn(columnId: string): number | null {
  if (!columnId.startsWith(COLUMN_ID_PREFIX)) return null;
  const digits = columnId.slice(COLUMN_ID_PREFIX.length);
  if (!/^[1-9]\d*$/.test(digits)) return null;
  return Number(digits);
}

/**
 * Board column order: category (not started, active, done), then the def's own
 * `position`, then id. Does not mutate the input.
 */
export function sortStatusDefsForBoard(defs: readonly TaskStatusDef[]): TaskStatusDef[] {
  return [...defs].sort((a, b) => compareStatusDefs(a, b) || a.id - b.id);
}

/**
 * Canonical global top-level order comparator: position ascending, id
 * ascending tiebreak. Identical to the old board's `groupedAll` per-column
 * sort (`ProjectKanban.tsx:204-209`), just usable across the whole unfiltered
 * set as well as within a single column. Exported so T6's container (and
 * commitMapper's tests) can derive the same canonical order without
 * re-deriving this comparator.
 */
export function compareTasksByPosition(a: Task, b: Task): number {
  return a.position - b.position || a.id - b.id;
}

/** Sorts a task list into the canonical global top-level order (does not mutate input). */
export function sortTasksCanonical(tasks: Task[]): Task[] {
  return [...tasks].sort(compareTasksByPosition);
}

/** Filter predicate: `true` = task is visible under the active filters (assignee, priority, ...). */
export type TaskVisibilityPredicate = (task: Task) => boolean;

/**
 * Pure projection: a task list (top-level tasks expected, but not trusted —
 * see below) + the board's column defs (already in board order) + a
 * visibility predicate for the currently active filters ->
 * `Record<columnId, Task[]>` shaped for ReUI Kanban's `value` prop.
 *
 * - One key per entry of `columnDefs`, always present, empty arrays allowed.
 *   A task whose `statusId` has no column here (a collapsed/hidden column, or
 *   a def deleted since the task list loaded) is simply not rendered.
 * - Ordering within a column: position ascending, id ascending tiebreak —
 *   identical to the old board's `groupedAll`/`grouped`
 *   (`ProjectKanban.tsx:204-217`).
 * - Filtering only ever hides cards from view; it never touches the input
 *   list's ordering or any task's `position` field — mirrors the old board's
 *   `topLevel`/`grouped` (filtered, rendering-only) vs. `topLevelAll`/
 *   `groupedAll` (unfiltered, source of truth for drop math) split. This
 *   function only ever produces the *filtered/rendering* view; commitMapper
 *   separately takes the *unfiltered* canonical list for its drop math.
 * - Subtasks (`parentTaskId !== null`) are filtered out here defensively
 *   (Phase 1 review finding 8) rather than trusting the caller to have
 *   already narrowed to top-level tasks — the board has no subtask-drag
 *   surfaces (Architecture Decision 2/8), so a subtask leaking into a column
 *   would render an unintended, non-draggable-as-expected card.
 */
export function projectToColumns(
  topLevelTasks: Task[],
  columnDefs: readonly Pick<TaskStatusDef, "id">[],
  isVisible: TaskVisibilityPredicate = () => true,
): Record<string, Task[]> {
  const columns: Record<string, Task[]> = {};
  for (const def of columnDefs) columns[columnIdOf(def)] = [];
  for (const task of topLevelTasks) {
    if (task.parentTaskId !== null) continue;
    if (!isVisible(task)) continue;
    columns[columnIdOf({ id: task.statusId })]?.push(task);
  }
  for (const key of Object.keys(columns)) {
    columns[key].sort(compareTasksByPosition);
  }
  return columns;
}
