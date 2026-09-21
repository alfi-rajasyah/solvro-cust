import type { Task, TaskStatus } from "@/lib/queries";

// Column order mirrors the old board's `COLUMNS` constant
// (ProjectKanban.tsx) — TODO / IN_PROGRESS / DONE. All three are always
// present in a projected value, empty arrays allowed, so ReUI's Kanban never
// sees a missing column key.
export const KANBAN_STATUSES: readonly TaskStatus[] = ["TODO", "IN_PROGRESS", "DONE"];

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
 * see below) + a visibility predicate for the currently active filters ->
 * `Record<TaskStatus, Task[]>` shaped for ReUI Kanban's `value` prop.
 *
 * - Columns TODO/IN_PROGRESS/DONE are always present, empty arrays allowed.
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
  isVisible: TaskVisibilityPredicate = () => true,
): Record<TaskStatus, Task[]> {
  const columns: Record<TaskStatus, Task[]> = { TODO: [], IN_PROGRESS: [], DONE: [] };
  for (const task of topLevelTasks) {
    if (task.parentTaskId !== null) continue;
    if (!isVisible(task)) continue;
    columns[task.status].push(task);
  }
  for (const status of KANBAN_STATUSES) {
    columns[status].sort(compareTasksByPosition);
  }
  return columns;
}
