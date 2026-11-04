// Pure draft logic behind Admin → Task statuses
// (docs/archive/plans/custom-task-statuses.md §3 B1). The editor edits a local
// copy of the workspace status list and saves it whole (`PUT
// /admin/task-statuses`); everything that decides what to send lives here so it
// can be unit-tested without a DOM.
import type { StatusTone, TaskStatus, TaskStatusDef } from "@/lib/queries";
import { CATEGORY_DEFAULT_TONE, STATUS_CATEGORY_ORDER } from "@/lib/taskStatuses";

export const STATUS_TONES: readonly StatusTone[] = ["gray", "primary", "emerald", "amber", "violet"];

/** What a brand-new status in a category starts as. */
export const NEW_STATUS_TONE: Record<TaskStatus, StatusTone> = CATEGORY_DEFAULT_TONE;

export const STATUS_NAME_MAX = 40;

export interface DraftStatus {
  /** Stable React / drag key: `s<id>` for a saved status, `n<seq>` for a new one. */
  key: string;
  id?: number;
  name: string;
  category: TaskStatus;
  color: StatusTone;
  isDefault: boolean;
  taskCount: number;
}

export interface EditorState {
  /** Kept and new statuses, grouped by category, in display order. */
  rows: DraftStatus[];
  /** Saved statuses the admin deleted (still holding their id and task count). */
  removed: DraftStatus[];
  /** removed status id -> kept status id its tasks move to. */
  moveTo: Record<number, number>;
}

export type AdminStatusDef = TaskStatusDef & { taskCount: number };

export interface SaveBody {
  statuses: Array<{
    id?: number;
    name: string;
    category: TaskStatus;
    color: StatusTone;
    isDefault: boolean;
  }>;
  moveTo?: Record<string, number>;
}

/** Group rows by category (fixed order), keeping each group's relative order. */
function regroup(rows: DraftStatus[]): DraftStatus[] {
  return STATUS_CATEGORY_ORDER.flatMap((c) => rows.filter((r) => r.category === c));
}

export function seedState(defs: readonly AdminStatusDef[]): EditorState {
  const sorted = [...defs].sort((a, b) => a.position - b.position || a.id - b.id);
  return {
    rows: regroup(
      sorted.map((d) => ({
        key: `s${d.id}`,
        id: d.id,
        name: d.name,
        category: d.category,
        color: d.color,
        isDefault: d.isDefault,
        taskCount: d.taskCount,
      })),
    ),
    removed: [],
    moveTo: {},
  };
}

export function rowsIn(state: EditorState, category: TaskStatus): DraftStatus[] {
  return state.rows.filter((r) => r.category === category);
}

export function reorderCategory(
  state: EditorState,
  category: TaskStatus,
  next: DraftStatus[],
): EditorState {
  const others = state.rows.filter((r) => r.category !== category);
  return { ...state, rows: regroup([...others, ...next]) };
}

export function updateRow(
  state: EditorState,
  key: string,
  patch: Partial<Pick<DraftStatus, "name" | "color">>,
): EditorState {
  return { ...state, rows: state.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) };
}

export function addStatus(state: EditorState, category: TaskStatus, key: string): EditorState {
  const row: DraftStatus = {
    key,
    name: "",
    category,
    color: NEW_STATUS_TONE[category],
    isDefault: false,
    taskCount: 0,
  };
  return { ...state, rows: regroup([...state.rows, row]) };
}

export function setDefault(state: EditorState, key: string): EditorState {
  const target = state.rows.find((r) => r.key === key);
  if (!target) return state;
  return {
    ...state,
    rows: state.rows.map((r) =>
      r.category === target.category ? { ...r, isDefault: r.key === key } : r,
    ),
  };
}

/** Tasks that will land on `id` if the removed statuses are saved as drafted. */
function movedInto(state: EditorState, id: number): number {
  return state.removed
    .filter((r) => state.moveTo[r.id!] === id)
    .reduce((n, r) => n + r.taskCount, 0);
}

/** Tasks a delete of this row would orphan: its own plus those already moved onto it. */
export function pendingMoveCount(state: EditorState, row: DraftStatus): number {
  return row.taskCount + (row.id === undefined ? 0 : movedInto(state, row.id));
}

/** A delete needs a "move to" target when tasks would otherwise be left behind. */
export function needsMoveTarget(state: EditorState, row: DraftStatus): boolean {
  return pendingMoveCount(state, row) > 0;
}

/** Why a row cannot be deleted right now, or null when it can. */
export function deleteBlocker(state: EditorState, row: DraftStatus): string | null {
  if (rowsIn(state, row.category).length <= 1) return "Each category needs at least one status";
  if (row.isDefault) return "Make another status the default first";
  return null;
}

/** Statuses a deleted row's tasks may move to: every kept, already-saved status. */
export function moveTargets(state: EditorState, row: DraftStatus): DraftStatus[] {
  return state.rows.filter((r) => r.id !== undefined && r.key !== row.key);
}

export function removeStatus(state: EditorState, key: string, moveToId?: number): EditorState {
  const row = state.rows.find((r) => r.key === key);
  if (!row || deleteBlocker(state, row)) return state;
  const rows = state.rows.filter((r) => r.key !== key);
  // A new (never-saved) status just disappears.
  if (row.id === undefined) return { ...state, rows };
  if (needsMoveTarget(state, row) && (moveToId === undefined || moveToId === row.id)) return state;
  const moveTo = { ...state.moveTo };
  if (moveToId !== undefined) {
    // Statuses already queued to move onto this one now follow it.
    for (const [from, to] of Object.entries(moveTo)) {
      if (to === row.id) moveTo[Number(from)] = moveToId;
    }
    if (row.taskCount > 0) moveTo[row.id] = moveToId;
  }
  return { rows, removed: [...state.removed, row], moveTo };
}

/** Per-row problems that block a save, keyed by row key. */
export function validateState(state: EditorState): Record<string, string> {
  const errors: Record<string, string> = {};
  const seen = new Map<string, string>();
  for (const r of state.rows) {
    const name = r.name.trim();
    if (!name) {
      errors[r.key] = "Give this status a name";
      continue;
    }
    if (name.length > STATUS_NAME_MAX) {
      errors[r.key] = `Keep names under ${STATUS_NAME_MAX} characters`;
      continue;
    }
    const lower = name.toLowerCase();
    const first = seen.get(lower);
    if (first !== undefined) {
      errors[r.key] = "Another status already has this name";
      errors[first] ??= "Another status already has this name";
    } else {
      seen.set(lower, r.key);
    }
  }
  return errors;
}

export function buildSaveBody(state: EditorState): SaveBody {
  const body: SaveBody = {
    statuses: state.rows.map((r) => ({
      ...(r.id === undefined ? {} : { id: r.id }),
      name: r.name.trim(),
      category: r.category,
      color: r.color,
      isDefault: r.isDefault,
    })),
  };
  const moves = state.removed.filter((r) => r.taskCount > 0 && state.moveTo[r.id!] !== undefined);
  if (moves.length > 0) {
    body.moveTo = Object.fromEntries(moves.map((r) => [String(r.id), state.moveTo[r.id!]]));
  }
  return body;
}

/** True when the draft differs from the saved list. */
export function isDirty(state: EditorState, saved: readonly AdminStatusDef[]): boolean {
  if (state.removed.length > 0) return true;
  const base = seedState(saved).rows;
  if (base.length !== state.rows.length) return true;
  return state.rows.some((r, i) => {
    const b = base[i];
    return (
      r.id !== b.id ||
      r.name !== b.name ||
      r.category !== b.category ||
      r.color !== b.color ||
      r.isDefault !== b.isDefault
    );
  });
}

export const DEFAULT_STATUSES: ReadonlyArray<{
  name: string;
  category: TaskStatus;
  color: StatusTone;
}> = [
  { name: "To do", category: "TODO", color: CATEGORY_DEFAULT_TONE.TODO },
  { name: "In progress", category: "IN_PROGRESS", color: CATEGORY_DEFAULT_TONE.IN_PROGRESS },
  { name: "Done", category: "DONE", color: CATEGORY_DEFAULT_TONE.DONE },
];

/**
 * Puts a deleted status back in its category (used when the server reports it
 * still has tasks, so the admin can pick a "move to" target) with the task
 * count the server just reported.
 */
export function restoreRemoved(state: EditorState, id: number, taskCount: number): EditorState {
  const row = state.removed.find((r) => r.id === id);
  if (!row) return state;
  const moveTo = { ...state.moveTo };
  delete moveTo[id];
  return {
    rows: regroup([...state.rows, { ...row, taskCount }]),
    removed: state.removed.filter((r) => r.id !== id),
    moveTo,
  };
}

/** Refreshes task counts from a newer server list without touching the draft's edits. */
export function mergeTaskCounts(state: EditorState, defs: readonly AdminStatusDef[]): EditorState {
  const counts = new Map(defs.map((d) => [d.id, d.taskCount]));
  const patch = (r: DraftStatus) =>
    r.id !== undefined && counts.has(r.id) ? { ...r, taskCount: counts.get(r.id)! } : r;
  return { ...state, rows: state.rows.map(patch), removed: state.removed.map(patch) };
}

/**
 * "Reset to defaults": To do / In progress / Done, one per category. Each
 * default slot reuses a SAVED status of its own category (name match first,
 * then the category's default, then any), so its tasks keep their id and never
 * change category; a never-saved row is only used when the category has no
 * saved one. Every other saved status is deleted and its tasks move to the
 * kept saved status of its own category.
 */
export function resetToDefaults(state: EditorState): EditorState {
  const all = [...state.rows];
  const used = new Set<string>();
  const kept: DraftStatus[] = [];
  const take = (pred: (r: DraftStatus) => boolean) => {
    const r = all.find((x) => !used.has(x.key) && pred(x));
    if (r) used.add(r.key);
    return r;
  };
  for (const [i, d] of DEFAULT_STATUSES.entries()) {
    const inCat = (r: DraftStatus) => r.category === d.category;
    const saved = (r: DraftStatus) => r.id !== undefined && inCat(r);
    const named = (r: DraftStatus) => r.name.trim().toLowerCase() === d.name.toLowerCase();
    const hit =
      take((r) => saved(r) && named(r)) ??
      take((r) => saved(r) && r.isDefault) ??
      take(saved) ??
      take((r) => inCat(r) && named(r));
    kept.push({
      key: hit?.key ?? `reset${i}`,
      id: hit?.id,
      name: d.name,
      category: d.category,
      color: d.color,
      isDefault: true,
      taskCount: hit?.taskCount ?? 0,
    });
  }
  // Saved statuses dropped by the reset (plus any removed earlier in the session).
  const dropped = all.filter((r) => !used.has(r.key) && r.id !== undefined);
  const removed = [...state.removed, ...dropped];
  const moveTo: Record<number, number> = {};
  for (const r of removed) {
    const target = kept.find((k) => k.category === r.category && k.id !== undefined)?.id;
    if (target !== undefined && r.taskCount + movedInto(state, r.id!) > 0) moveTo[r.id!] = target;
  }
  return { rows: kept, removed, moveTo };
}
