import type { Prisma } from "@prisma/client";
import { dayString, type ActivityChanges } from "./activity.js";

// Activity-log helpers for epics (docs/archive/plans/epics-spec.md). Kept next
// to, not inside, lib/activity.ts: the epic routes (routes/epics.ts and the
// create route in routes/projects.ts) are the only callers.
//
// PRIVACY INVARIANT (same as lib/activity.ts): the description is reported as
// `{ changed: true }` and never as text.

export interface EpicSnapshot {
  title: string;
  description: string | null;
  status: string;
  color: string;
  startDate: Date | null;
  dueDate: Date | null;
  owner: { id: number; username: string } | null;
}

/** Select that loads exactly the fields an `EpicSnapshot` needs. */
export const epicSnapshotSelect = {
  title: true,
  description: true,
  status: true,
  color: true,
  startDate: true,
  dueDate: true,
  owner: { select: { id: true, username: true } },
} satisfies Prisma.EpicSelect;

function fromTo(from: unknown, to: unknown): Prisma.InputJsonValue {
  return { from, to } as Prisma.InputJsonValue;
}

const pickOwner = (o: EpicSnapshot["owner"]) => (o ? { id: o.id, username: o.username } : null);

/** What changed between two states of an epic; `{}` when nothing worth listing did. */
export function diffEpicChanges(before: EpicSnapshot, after: EpicSnapshot): ActivityChanges {
  const changes: ActivityChanges = {};
  for (const field of ["title", "status", "color"] as const) {
    if (before[field] !== after[field]) changes[field] = fromTo(before[field], after[field]);
  }
  if ((before.owner?.id ?? null) !== (after.owner?.id ?? null)) {
    changes.owner = fromTo(pickOwner(before.owner), pickOwner(after.owner));
  }
  for (const field of ["startDate", "dueDate"] as const) {
    const from = dayString(before[field]);
    const to = dayString(after[field]);
    if (from !== to) changes[field] = fromTo(from, to);
  }
  if (before.description !== after.description) changes.description = { changed: true };
  return changes;
}

/** Changes recorded for a freshly created epic: owner and dates, when set. */
export function epicCreatedChanges(after: EpicSnapshot): ActivityChanges {
  const changes: ActivityChanges = {};
  if (after.owner) changes.owner = fromTo(null, pickOwner(after.owner));
  for (const field of ["startDate", "dueDate"] as const) {
    const to = dayString(after[field]);
    if (to !== null) changes[field] = fromTo(null, to);
  }
  return changes;
}
