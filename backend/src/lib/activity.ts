import type { Prisma, PrismaClient } from "@prisma/client";
import { utcMidnightOf } from "./dateBoundary.js";

// Project activity log (docs/archive/plans/collaboration-and-sharing.md, C5a). Every
// write path calls recordActivity inside the SAME transaction as the change,
// so an event exists exactly when the write committed.
//
// PRIVACY INVARIANT: `changes` holds short scalar diffs only. It must never
// carry a note body, a comment body, or description text — a note event holds
// only its id (entityId) and visibility, so an INTERNAL note can never leak
// through the log. The diff helpers below encode this: a description is
// reported as `{ changed: true }` and nothing else.

type Tx = Prisma.TransactionClient | PrismaClient;

export type ActivityEntityType =
  | "project"
  | "task"
  | "comment"
  | "risk"
  | "note"
  | "member"
  | "share_link";
export type ActivityAction = "created" | "updated" | "deleted" | "added" | "removed";

/** JSON object stored in `ActivityEvent.changes`. */
export type ActivityChanges = Record<string, Prisma.InputJsonValue>;

export interface RecordActivityInput {
  projectId: number;
  actorId: number | null;
  entityType: ActivityEntityType;
  entityId: number;
  action: ActivityAction;
  /** Short display snapshot (task/risk title, member username) — null for notes. */
  entityLabel?: string | null;
  /** Null or empty means "nothing worth listing". */
  changes?: ActivityChanges | null;
}

const LABEL_MAX = 120;

/** Trims a display label to a short snapshot (risk descriptions can be long). */
export function shortLabel(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > LABEL_MAX ? `${flat.slice(0, LABEL_MAX - 1)}…` : flat;
}

/**
 * Writes one event through `tx`. An `updated` action with no changes to list
 * (a reorder-only task write, a re-save of identical values) records nothing
 * and returns null — callers need no emptiness check of their own.
 */
export async function recordActivity(tx: Tx, input: RecordActivityInput) {
  const hasChanges = input.changes != null && Object.keys(input.changes).length > 0;
  if (input.action === "updated" && !hasChanges) return null;
  return tx.activityEvent.create({
    data: {
      projectId: input.projectId,
      actorId: input.actorId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      entityLabel: input.entityLabel ?? null,
      changes: hasChanges ? (input.changes as Prisma.InputJsonObject) : undefined,
    },
  });
}

// ---------------------------------------------------------------------------
// Change computation (pure)
// ---------------------------------------------------------------------------

/** "yyyy-MM-dd" (UTC calendar day, the date contract in lib/dateBoundary.ts). */
export function dayString(d: Date | null): string | null {
  return d === null ? null : utcMidnightOf(d).toISOString().slice(0, 10);
}

export interface TaskSnapshot {
  title: string;
  description: string | null;
  status: string;
  priority: string;
  startDate: Date | null;
  dueDate: Date | null;
  isMilestone: boolean;
  isCriticalPath: boolean;
  sectionId: number | null;
  epicId: number | null;
  parentTaskId: number | null;
  itopTicketRef: string | null;
  assignedTo: { id: number; username: string } | null;
  labels: { id: number; name: string }[];
}

function fromTo(from: unknown, to: unknown): Prisma.InputJsonValue {
  return { from, to } as Prisma.InputJsonValue;
}

/**
 * What changed between two states of a task. Position is deliberately not
 * compared, so a reorder-only write yields `{}` (and records nothing).
 */
export function diffTaskChanges(before: TaskSnapshot, after: TaskSnapshot): ActivityChanges {
  const changes: ActivityChanges = {};
  const scalars = [
    "title",
    "status",
    "priority",
    "isMilestone",
    "isCriticalPath",
    "sectionId",
    "epicId",
    "parentTaskId",
    "itopTicketRef",
  ] as const;
  for (const field of scalars) {
    if (before[field] !== after[field]) changes[field] = fromTo(before[field], after[field]);
  }
  for (const field of ["startDate", "dueDate"] as const) {
    const from = dayString(before[field]);
    const to = dayString(after[field]);
    if (from !== to) changes[field] = fromTo(from, to);
  }
  if (before.description !== after.description) changes.description = { changed: true };
  if ((before.assignedTo?.id ?? null) !== (after.assignedTo?.id ?? null)) {
    const pick = (a: TaskSnapshot["assignedTo"]) => (a ? { id: a.id, username: a.username } : null);
    changes.assignee = fromTo(pick(before.assignedTo), pick(after.assignedTo));
  }
  const beforeIds = new Set(before.labels.map((l) => l.id));
  const afterIds = new Set(after.labels.map((l) => l.id));
  const added = after.labels.filter((l) => !beforeIds.has(l.id)).map((l) => l.name);
  const removed = before.labels.filter((l) => !afterIds.has(l.id)).map((l) => l.name);
  if (added.length > 0 || removed.length > 0) changes.labels = { added, removed };
  return changes;
}

/** Changes recorded for a freshly created task: only who it was assigned to. */
export function taskCreatedChanges(after: Pick<TaskSnapshot, "assignedTo">): ActivityChanges {
  return after.assignedTo
    ? { assignee: fromTo(null, { id: after.assignedTo.id, username: after.assignedTo.username }) }
    : {};
}

export interface RiskSnapshot {
  description: string;
  category: string;
  probability: number;
  impact: number;
  status: string;
  mitigationPlan: string | null;
  contingencyPlan: string | null;
}

/** Risk text fields (description, plans) report `{ changed: true }` only. */
export function diffRiskChanges(before: RiskSnapshot, after: RiskSnapshot): ActivityChanges {
  const changes: ActivityChanges = {};
  for (const field of ["category", "probability", "impact", "status"] as const) {
    if (before[field] !== after[field]) changes[field] = fromTo(before[field], after[field]);
  }
  for (const field of ["description", "mitigationPlan", "contingencyPlan"] as const) {
    if (before[field] !== after[field]) changes[field] = { changed: true };
  }
  return changes;
}

export interface ProjectSnapshot {
  name: string;
  status: string;
  customerId: number | null;
}

/** Only the fields the log tracks: name, status, customer. */
export function diffProjectChanges(before: ProjectSnapshot, after: ProjectSnapshot): ActivityChanges {
  const changes: ActivityChanges = {};
  for (const field of ["name", "status", "customerId"] as const) {
    if (before[field] !== after[field]) changes[field] = fromTo(before[field], after[field]);
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Feed / notification serialisation
// ---------------------------------------------------------------------------

/** Include for reading events (feed and notifications share it). */
export const activityEventInclude = {
  actor: { select: { id: true, username: true, avatarUrl: true } },
} satisfies Prisma.ActivityEventInclude;

/** One activity event as the API returns it (feed item, notification `event`). */
export function toActivityEventDto(
  e: Prisma.ActivityEventGetPayload<{ include: typeof activityEventInclude }>,
) {
  return {
    id: e.id,
    entityType: e.entityType,
    entityId: e.entityId,
    action: e.action,
    entityLabel: e.entityLabel,
    changes: e.changes,
    createdAt: e.createdAt,
    actor: e.actor,
  };
}
