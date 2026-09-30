import { ApiError } from "@/lib/api";
import { dayFromIso } from "@/lib/dateField";
import { fmtDayFull } from "@/lib/formatDate";
import { PRIORITY_LABEL, TASK_STATUS_LABEL } from "@/lib/labels";
import type { Label, Priority, Task, TaskStatus, UpdateTaskInput } from "@/lib/queries";

/**
 * Pure logic behind the task conflict warning (`PATCH /tasks/:id` with an
 * `expected` body → 409 `stale_write`). Per-field, not per-row: the client
 * sends the value it last saw for each field it changes, and the server
 * rejects the save only when someone changed that same field.
 * No React here — see `taskConflict.test.ts`.
 */

/** Fields the server can compare (`expected` keys). Order = dialog row order. */
export const TRACKED_FIELDS = [
  "title",
  "description",
  "status",
  "priority",
  "startDate",
  "dueDate",
  "assignedToId",
  "sectionId",
  "epicId",
  "parentTaskId",
  "isMilestone",
  "isCriticalPath",
  "labelIds",
] as const;

export type TrackedField = (typeof TRACKED_FIELDS)[number];

/** The value the client last saw, per tracked field — same shape as the PATCH body. */
export interface TaskExpected {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: Priority;
  startDate?: string | null;
  dueDate?: string | null;
  assignedToId?: number | null;
  sectionId?: number | null;
  epicId?: number | null;
  parentTaskId?: number | null;
  isMilestone?: boolean;
  isCriticalPath?: boolean;
  labelIds?: number[];
}

export interface StaleWriteConflict {
  field: TrackedField;
  expected: unknown;
  current: unknown;
}

/** Details of a 409 `stale_write`: what clashed, plus the server's current task. */
export interface StaleWrite {
  conflicts: StaleWriteConflict[];
  task: Task;
}

/**
 * Thrown in place of a queued save that was never sent: an earlier save of the
 * same task was refused with `stale_write`, and this one carried an `expected`
 * built on top of that rejected edit. Callers ignore it — the first conflict
 * is the one the user is asked about.
 */
export class SupersededWriteError extends Error {
  constructor() {
    super("Save dropped: an earlier save of this task was refused");
  }
}

export function isSupersededWrite(err: unknown): boolean {
  return err instanceof SupersededWriteError;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Detects and parses a `stale_write` from an API error. Null for any other
 * error (including a 409 with a different code, or a malformed body).
 */
export function parseStaleWrite(err: unknown): StaleWrite | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const body = err.body;
  if (!isRecord(body) || body.code !== "stale_write") return null;
  const details = body.details;
  if (!isRecord(details) || !Array.isArray(details.conflicts)) return null;
  const conflicts: StaleWriteConflict[] = [];
  for (const c of details.conflicts) {
    if (!isRecord(c) || typeof c.field !== "string") continue;
    if (!(TRACKED_FIELDS as readonly string[]).includes(c.field)) continue;
    conflicts.push({
      field: c.field as TrackedField,
      expected: c.expected,
      current: c.current,
    });
  }
  if (conflicts.length === 0) return null;
  return { conflicts, task: details.task as Task };
}

/** The value of one tracked field as it is on `task`, in PATCH-body shape. */
function taskFieldValue(task: Task, field: TrackedField): unknown {
  switch (field) {
    case "labelIds":
      return task.labels.map((l) => l.id);
    case "description":
      return task.description ?? null;
    default:
      return task[field];
  }
}

/**
 * `expected` for a patch: the task's current value for exactly the tracked
 * fields the patch changes. Undefined when the patch touches none (position,
 * iTop ref, baseline …) so callers send no `expected` at all.
 */
export function buildExpected(
  task: Task,
  patch: UpdateTaskInput,
): TaskExpected | undefined {
  const expected: Record<string, unknown> = {};
  for (const field of TRACKED_FIELDS) {
    if (patch[field] !== undefined) expected[field] = taskFieldValue(task, field);
  }
  return Object.keys(expected).length > 0 ? (expected as TaskExpected) : undefined;
}

/**
 * The date part of a panel date edit: only the date(s) whose calendar day
 * differs from `base` (the task as it was when the edit began). Sending the
 * untouched date too would conflict on, or silently revert, someone else's
 * change to it. Empty when neither day changed.
 */
export function datePatchFromEdit(
  base: Pick<Task, "startDate" | "dueDate">,
  startDate: string | null,
  dueDate: string | null,
): UpdateTaskInput {
  const patch: UpdateTaskInput = {};
  if (dayFromIso(startDate) !== dayFromIso(base.startDate)) patch.startDate = startDate;
  if (dayFromIso(dueDate) !== dayFromIso(base.dueDate)) patch.dueDate = dueDate;
  return patch;
}

/**
 * The `labels` a task carries after a `labelIds` patch, for the optimistic
 * cache write: each id resolves against the project's labels, then the task's
 * current labels, and only then becomes a name-less placeholder (a label
 * created a moment ago that the project list has not refetched yet). Order
 * follows `ids`. Without this the row keeps its old `labels` while the patch
 * says otherwise, and the next quick toggle computes from a stale set.
 */
export function labelsFromIds(
  ids: number[],
  projectLabels: Label[] | undefined,
  current: Label[],
  projectId: number,
): Label[] {
  return ids.map(
    (id) =>
      projectLabels?.find((l) => l.id === id) ??
      current.find((l) => l.id === id) ?? { id, projectId, name: "", color: "#888780" },
  );
}

/**
 * After "Use theirs" in the edit form: which fields take the server's value.
 * The conflicting ones, plus every field the user never changed (their form
 * copy is just the old base, and keeping it would overwrite someone else's
 * change on the next save). Only fields the user changed without a clash keep
 * the user's value.
 */
export function fieldsToAdopt(
  patch: UpdateTaskInput,
  conflicts: { field: TrackedField }[],
): Set<TrackedField> {
  const clashing = new Set(conflicts.map((c) => c.field));
  return new Set(TRACKED_FIELDS.filter((f) => clashing.has(f) || patch[f] === undefined));
}

/** What the edit form currently holds, already normalised for the wire. */
export interface TaskFormValues {
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  startDate: string | null;
  dueDate: string | null;
  assignedToId: number | null;
  parentTaskId: number | null;
  sectionId: number | null;
  epicId: number | null;
  labelIds: number[];
  isCriticalPath: boolean;
}

function sameSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}

/**
 * Diffs the edit form against `base` — the task as it was when the form
 * opened, not the live-refreshed one — and returns only the changed fields
 * plus `expected` (base values) for those same fields. Dates compare as
 * calendar days; labels as a set; empty and null description are the same.
 */
export function diffTaskForm(
  base: Task,
  form: TaskFormValues,
): { patch: UpdateTaskInput; expected: TaskExpected | undefined } {
  const patch: UpdateTaskInput = {};
  if (form.title !== base.title) patch.title = form.title;
  const baseDescription = base.description?.trim() || null;
  if (form.description !== baseDescription) patch.description = form.description;
  if (form.status !== base.status) patch.status = form.status;
  if (form.priority !== base.priority) patch.priority = form.priority;
  if (dayFromIso(form.startDate) !== dayFromIso(base.startDate)) {
    patch.startDate = form.startDate;
  }
  if (dayFromIso(form.dueDate) !== dayFromIso(base.dueDate)) {
    patch.dueDate = form.dueDate;
  }
  if (form.assignedToId !== base.assignedToId) patch.assignedToId = form.assignedToId;
  if (form.parentTaskId !== base.parentTaskId) patch.parentTaskId = form.parentTaskId;
  if (form.sectionId !== base.sectionId) patch.sectionId = form.sectionId;
  if (form.epicId !== base.epicId) patch.epicId = form.epicId;
  if (!sameSet(form.labelIds, base.labels.map((l) => l.id))) {
    patch.labelIds = form.labelIds;
  }
  if (form.isCriticalPath !== (base.isCriticalPath ?? false)) {
    patch.isCriticalPath = form.isCriticalPath;
  }
  return { patch, expected: buildExpected(base, patch) };
}

/** Human names for the fields shown in the conflict dialog. */
export const CONFLICT_FIELD_LABEL: Record<TrackedField, string> = {
  title: "Title",
  description: "Description",
  status: "Status",
  priority: "Priority",
  startDate: "Start date",
  dueDate: "Due date",
  assignedToId: "Assignee",
  sectionId: "Section",
  epicId: "Epic",
  parentTaskId: "Parent task",
  isMilestone: "Milestone",
  isCriticalPath: "Critical path",
  labelIds: "Labels",
};

/** Name lookups for id-valued fields; a missing id falls back to `#id`. */
export interface ConflictLookups {
  users?: { id: number; username: string }[];
  sections?: { id: number; name: string }[];
  epics?: { id: number; title: string }[];
  labels?: { id: number; name: string }[];
  tasks?: { id: number; title: string }[];
}

export interface ConflictRow {
  field: TrackedField;
  label: string;
  /** Their value, as it is on the server now. */
  now: string;
  /** Your value — what this save was about to write. */
  yours: string;
}

/**
 * Adds the names the server's own task carries (assignee, section, labels) to
 * `lookups`, so "Now" resolves even for a value the client's lists never held
 * (a label or member added in the meantime).
 */
export function withServerTask(lookups: ConflictLookups, task: Task | undefined): ConflictLookups {
  if (!task) return lookups;
  return {
    ...lookups,
    users: [...(lookups.users ?? []), ...(task.assignedTo ? [task.assignedTo] : [])],
    sections: [...(lookups.sections ?? []), ...(task.section ? [task.section] : [])],
    labels: [...(lookups.labels ?? []), ...(task.labels ?? [])],
  };
}

function named<T extends { id: number }>(
  list: T[] | undefined,
  id: unknown,
  pick: (x: T) => string,
  empty: string,
): string {
  if (id === null || id === undefined) return empty;
  const found = list?.find((x) => x.id === id);
  return found ? pick(found) : `#${String(id)}`;
}

/** Display text for one field value (any shape the server or patch carries). */
export function formatConflictValue(
  field: TrackedField,
  value: unknown,
  lookups: ConflictLookups = {},
): string {
  switch (field) {
    case "title":
      return typeof value === "string" && value !== "" ? value : "(empty)";
    case "description":
      return typeof value === "string" && value.trim() !== "" ? value : "(empty)";
    case "status":
      return TASK_STATUS_LABEL[value as TaskStatus] ?? String(value);
    case "priority":
      return PRIORITY_LABEL[value as Priority] ?? String(value);
    case "startDate":
    case "dueDate":
      return (typeof value === "string" ? fmtDayFull(value) : "") || "No date";
    case "assignedToId":
      return named(lookups.users, value, (u) => u.username, "Unassigned");
    case "sectionId":
      return named(lookups.sections, value, (s) => s.name, "No section");
    case "epicId":
      return named(lookups.epics, value, (e) => e.title, "No epic");
    case "parentTaskId":
      return named(lookups.tasks, value, (t) => t.title, "No parent");
    case "isMilestone":
      return value ? "Yes" : "No";
    case "isCriticalPath":
      return value ? "Yes" : "No";
    case "labelIds": {
      const ids = Array.isArray(value) ? (value as number[]) : [];
      if (ids.length === 0) return "No labels";
      return ids.map((id) => named(lookups.labels, id, (l) => l.name, "")).join(", ");
    }
  }
}

/**
 * One dialog row per conflicting field: "Now" is the server's current value,
 * "Yours" the value this save carried (read from `patch` — the conflict's own
 * `expected` is what you last saw, not what you were setting).
 */
export function formatConflictRows(
  conflicts: StaleWriteConflict[],
  patch: UpdateTaskInput,
  lookups: ConflictLookups = {},
): ConflictRow[] {
  return conflicts.map((c) => ({
    field: c.field,
    label: CONFLICT_FIELD_LABEL[c.field],
    now: formatConflictValue(c.field, c.current, lookups),
    yours: formatConflictValue(c.field, patch[c.field], lookups),
  }));
}
