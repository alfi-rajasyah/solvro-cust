import type { Priority, Task } from "@/lib/queries";

/**
 * Shared task-filter model for List, Kanban, Gantt and Timeline: one set of
 * pure predicates plus the URL encoding, so the four views cannot drift.
 *
 * URL params (all optional, absent = inactive):
 *   epicFilter  `none` (tasks without an epic) or an epic id
 *   labels      comma list of label ids and/or `none` (e.g. `3,7,none`)
 *   assignee    user id (Kanban)
 *   priority    LOW | MEDIUM | HIGH | URGENT (Kanban)
 * `?epic=` (the Epics tab's detail panel) and `?task=` are deliberately not
 * part of this set and are never carried between tabs.
 */

export type EpicFilter = "all" | "none" | number;

export interface TaskFilters {
  epic: EpicFilter;
  /** Selected label ids (OR among them). */
  labelIds: number[];
  /** "No label" option, ORed with `labelIds`. */
  noLabel: boolean;
  assigneeId: number | null;
  priority: Priority | null;
}

export const EMPTY_FILTERS: TaskFilters = {
  epic: "all",
  labelIds: [],
  noLabel: false,
  assigneeId: null,
  priority: null,
};

export const FILTER_PARAMS = ["epicFilter", "labels", "assignee", "priority"] as const;

const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];

function parseId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

export function parseTaskFilters(params: URLSearchParams): TaskFilters {
  const epicRaw = params.get("epicFilter");
  let epic: EpicFilter = "all";
  if (epicRaw === "none") epic = "none";
  else if (epicRaw) {
    const id = parseId(epicRaw);
    if (id !== null) epic = id;
  }

  const labelIds: number[] = [];
  let noLabel = false;
  for (const part of (params.get("labels") ?? "").split(",")) {
    if (part === "none") noLabel = true;
    else {
      const id = parseId(part);
      if (id !== null && !labelIds.includes(id)) labelIds.push(id);
    }
  }

  const assigneeRaw = params.get("assignee");
  const assigneeId = assigneeRaw ? parseId(assigneeRaw) : null;
  const priorityRaw = params.get("priority");
  const priority = PRIORITIES.find((p) => p === priorityRaw) ?? null;

  return { epic, labelIds, noLabel, assigneeId, priority };
}

/** Writes `filters` into a copy of `params`, leaving every other param alone. */
export function writeTaskFilters(params: URLSearchParams, filters: TaskFilters): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of FILTER_PARAMS) next.delete(key);
  if (filters.epic === "none") next.set("epicFilter", "none");
  else if (filters.epic !== "all") next.set("epicFilter", String(filters.epic));
  const labelParts = filters.labelIds.map(String);
  if (filters.noLabel) labelParts.push("none");
  if (labelParts.length > 0) next.set("labels", labelParts.join(","));
  if (filters.assigneeId !== null) next.set("assignee", String(filters.assigneeId));
  if (filters.priority !== null) next.set("priority", filters.priority);
  return next;
}

/**
 * The patch that drops epic and label ids no longer in the project (a deleted
 * epic or label, an old shared link), or null when nothing needs dropping.
 * Pass `undefined` for a list that has not loaded: its filter is left alone.
 * `none` / "No label" is always valid.
 */
export function stalePrunePatch(
  filters: TaskFilters,
  known: { epicIds?: number[]; labelIds?: number[] },
): Partial<TaskFilters> | null {
  const patch: Partial<TaskFilters> = {};
  if (typeof filters.epic === "number" && known.epicIds && !known.epicIds.includes(filters.epic)) {
    patch.epic = "all";
  }
  if (known.labelIds) {
    const kept = filters.labelIds.filter((id) => known.labelIds!.includes(id));
    if (kept.length !== filters.labelIds.length) patch.labelIds = kept;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

/** Query string (with leading `?`, or empty) holding only the filter params. */
export function carryFilterSearch(params: URLSearchParams): string {
  const kept = new URLSearchParams();
  for (const key of FILTER_PARAMS) {
    const v = params.get(key);
    if (v) kept.set(key, v);
  }
  const s = kept.toString();
  return s ? `?${s}` : "";
}

/** Which dimensions a view applies: the rest of the shared state is ignored there. */
export type FilterScope = "epic" | "list" | "board";

export function scopeFilters(filters: TaskFilters, scope: FilterScope): TaskFilters {
  if (scope === "board") return filters;
  return {
    ...EMPTY_FILTERS,
    epic: filters.epic,
    ...(scope === "list" ? { labelIds: filters.labelIds, noLabel: filters.noLabel } : {}),
  };
}

/** Patch that resets only the controls a view shows, leaving the other views' state in the URL. */
export function clearPatch(scope: FilterScope): Partial<TaskFilters> {
  if (scope === "board") return { ...EMPTY_FILTERS };
  if (scope === "list") return { epic: "all", labelIds: [], noLabel: false };
  return { epic: "all" };
}

export function hasLabelFilter(f: TaskFilters): boolean {
  return f.labelIds.length > 0 || f.noLabel;
}

/** Badge number: each active control counts once (the label control counts 1, not per label). */
export function countActiveFilters(f: TaskFilters): number {
  return (
    (f.epic !== "all" ? 1 : 0) +
    (hasLabelFilter(f) ? 1 : 0) +
    (f.assigneeId !== null ? 1 : 0) +
    (f.priority !== null ? 1 : 0)
  );
}

export interface FilterContext {
  tasksById: Map<number, Task>;
  subtasksOf: Map<number, Task[]>;
}

export function buildFilterContext(tasks: Task[]): FilterContext {
  const tasksById = new Map<number, Task>();
  const subtasksOf = new Map<number, Task[]>();
  for (const t of tasks) {
    tasksById.set(t.id, t);
    if (t.parentTaskId !== null) {
      const arr = subtasksOf.get(t.parentTaskId) ?? [];
      arr.push(t);
      subtasksOf.set(t.parentTaskId, arr);
    }
  }
  return { tasksById, subtasksOf };
}

/** A subtask belongs to its parent's epic; its own `epicId` is only a fallback. */
export function resolveEpicId(task: Task, tasksById: Map<number, Task>): number | null {
  if (task.parentTaskId !== null) {
    const parent = tasksById.get(task.parentTaskId);
    if (parent) return parent.epicId;
  }
  return task.epicId;
}

export function taskMatchesEpic(task: Task, tasksById: Map<number, Task>, epic: EpicFilter): boolean {
  if (epic === "all") return true;
  const epicId = resolveEpicId(task, tasksById);
  return epic === "none" ? epicId === null : epicId === epic;
}

/** OR among the selected labels; "No label" matches a task with no labels. A task's own labels only. */
export function taskMatchesLabels(task: Task, f: Pick<TaskFilters, "labelIds" | "noLabel">): boolean {
  if (f.labelIds.length === 0 && !f.noLabel) return true;
  if (task.labels.length === 0) return f.noLabel;
  return task.labels.some((l) => f.labelIds.includes(l.id));
}

/**
 * Whether a task row is shown. All active controls combine with AND.
 *
 * - Epic: a subtask inherits its parent's epic.
 * - Assignee / priority apply to top-level tasks only (the board's cards).
 * - Labels: a subtask matches on its own labels; a top-level task stays
 *   visible when it matches itself or any of its subtasks does.
 */
export function taskVisible(task: Task, f: TaskFilters, ctx: FilterContext): boolean {
  if (!taskMatchesEpic(task, ctx.tasksById, f.epic)) return false;
  if (task.parentTaskId !== null) return taskMatchesLabels(task, f);
  if (f.assigneeId !== null && task.assignedToId !== f.assigneeId) return false;
  if (f.priority !== null && task.priority !== f.priority) return false;
  if (!hasLabelFilter(f)) return true;
  return (
    taskMatchesLabels(task, f) || (ctx.subtasksOf.get(task.id) ?? []).some((s) => taskMatchesLabels(s, f))
  );
}

/** True when dropping `movedId` at `index` among the rows the user sees leaves their order as it was. */
export function visibleOrderUnchanged<T>(visible: T[], movedId: T, index: number): boolean {
  const others = visible.filter((id) => id !== movedId);
  const next = [...others];
  next.splice(Math.max(0, Math.min(index, others.length)), 0, movedId);
  return next.length === visible.length && next.every((id, i) => id === visible[i]);
}

/**
 * Reorder with filtered-out rows. `fullIds` is the full order, `visibleIds` the
 * subset on screen (both include `movedId`), `index` the drop slot among the
 * OTHER visible rows. Returns the new full order, anchored on the visible
 * neighbour the row was dropped next to so hidden rows keep their place, or
 * `null` when nothing changes on screen (including when no other row is visible),
 * so the caller saves nothing.
 */
export function reorderAmongVisible<T>(
  fullIds: T[],
  visibleIds: T[],
  movedId: T,
  index: number,
): T[] | null {
  const visibleOthers = visibleIds.filter((id) => id !== movedId);
  if (visibleOthers.length === 0) return null;
  if (visibleOrderUnchanged(visibleIds, movedId, index)) return null;
  const next = fullIds.filter((id) => id !== movedId);
  if (index >= visibleOthers.length) {
    next.splice(next.indexOf(visibleOthers[visibleOthers.length - 1]) + 1, 0, movedId);
  } else {
    next.splice(next.indexOf(visibleOthers[Math.max(0, index)]), 0, movedId);
  }
  return next;
}
