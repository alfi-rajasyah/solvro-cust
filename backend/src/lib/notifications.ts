import type { ActivityEvent, Prisma, PrismaClient } from "@prisma/client";
import { canUserSeeProject, type ProjectVisibilityFacts } from "./visibility.js";

// In-app notifications (docs/archive/plans/collaboration-and-sharing.md, C5b).
// `notifyForEvent` runs in the SAME transaction as the activity event that
// triggers it (call it with the row `recordActivity` returned), so a rolled-back
// write leaves neither an event nor a notification.

type Tx = Prisma.TransactionClient | PrismaClient;

export type NotificationReason = "assigned" | "commented" | "mentioned";

export interface NotifyOptions {
  /**
   * `comment` events only: the task's CURRENT assignee (the comment route
   * already has the task row) — they get a `commented` notification.
   */
  taskAssigneeId?: number | null;
  /**
   * Hook for C5c (@mentions): ids the comment mentions. A mention wins over
   * `commented` for the same user (one notification per user per event), so
   * these are applied first. The candidates are still filtered by the same
   * actor / active / can-see-project rules below (in one batch).
   */
  mentionedUserIds?: readonly number[];
}

/** The user `changes.assignee.to` names on a task event, if any. */
function assigneeFromChanges(event: ActivityEvent): number | null {
  const changes = event.changes as { assignee?: { to?: { id?: unknown } | null } } | null;
  const id = changes?.assignee?.to?.id;
  return typeof id === "number" ? id : null;
}

/**
 * Which of `userIds` are active users who can see `projectId`, in a fixed
 * number of queries (users + roles, then the project's TAM / customer owner /
 * candidate members) however many ids are passed. It loads the project's facts
 * and applies `canUserSeeProject` (lib/visibility.ts), the pure twin of
 * `projectVisibilityFilter`; test/notifications.test.ts compares the two.
 */
export async function filterActiveUsersWhoCanSeeProject(
  tx: Tx,
  projectId: number,
  userIds: readonly number[],
): Promise<Set<number>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Set();
  const [users, project] = await Promise.all([
    tx.user.findMany({
      where: { id: { in: ids }, active: true },
      select: { id: true, role: { select: { roleName: true, permissions: true } } },
    }),
    tx.project.findUnique({
      where: { id: projectId },
      select: {
        tamId: true,
        customer: { select: { tamId: true } },
        members: { where: { userId: { in: ids } }, select: { userId: true } },
      },
    }),
  ]);
  const visible = new Set<number>();
  if (!project) return visible;
  const facts: ProjectVisibilityFacts = {
    tamId: project.tamId,
    customerTamId: project.customer?.tamId ?? null,
    memberIds: new Set(project.members.map((m) => m.userId)),
  };
  for (const u of users) {
    const permissions = Array.isArray(u.role.permissions)
      ? u.role.permissions.filter((p): p is string => typeof p === "string")
      : [];
    if (canUserSeeProject({ sub: u.id, role: u.role.roleName, permissions }, facts)) {
      visible.add(u.id);
    }
  }
  return visible;
}

/**
 * Creates the notifications an event triggers:
 *  - `assigned`: a task created or updated with an assignee (`changes.assignee.to`);
 *  - `commented`: a comment on a task that has an assignee (`opts.taskAssigneeId`);
 *  - `mentioned`: `opts.mentionedUserIds` (C5c).
 * One notification per user per event (mention > assigned > commented), never
 * the actor, never an inactive user or one who cannot see the project. Events
 * recorded without calling this (task duplicates, everything else) never notify.
 * Returns the number of rows created.
 */
export async function notifyForEvent(
  tx: Tx,
  event: ActivityEvent | null,
  opts: NotifyOptions = {},
): Promise<number> {
  if (!event) return 0;
  const reasons = new Map<number, NotificationReason>();
  const add = (userId: number | null | undefined, reason: NotificationReason) => {
    if (userId == null || userId === event.actorId || reasons.has(userId)) return;
    reasons.set(userId, reason);
  };

  for (const userId of opts.mentionedUserIds ?? []) add(userId, "mentioned");
  if (event.entityType === "task" && (event.action === "created" || event.action === "updated")) {
    add(assigneeFromChanges(event), "assigned");
  }
  if (event.entityType === "comment" && event.action === "created") {
    add(opts.taskAssigneeId, "commented");
  }

  if (reasons.size === 0) return 0;
  const eligible = await filterActiveUsersWhoCanSeeProject(tx, event.projectId, [...reasons.keys()]);
  const rows: Prisma.NotificationCreateManyInput[] = [];
  for (const [userId, reason] of reasons) {
    if (eligible.has(userId)) rows.push({ userId, activityEventId: event.id, reason });
  }
  if (rows.length === 0) return 0;
  const { count } = await tx.notification.createMany({ data: rows });
  return count;
}
