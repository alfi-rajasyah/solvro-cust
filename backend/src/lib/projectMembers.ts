import type { Prisma, PrismaClient } from "@prisma/client";
import { hasPermission } from "../http/auth.js";
import { recordActivity } from "./activity.js";
import { lockProjectOrder } from "./orderLock.js";
import { projectVisibilityFilter } from "./visibility.js";

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * Task assignment makes the assignee a project member
 * (docs/archive/plans/collaboration-and-sharing.md, C2): when `assigneeId` is
 * neither the project's TAM nor already a member, insert the `ProjectMember`
 * row (`addedById` = the acting user). Call it inside the same transaction as
 * the task write. Idempotent — `skipDuplicates` (ON CONFLICT DO NOTHING) makes
 * concurrent assigns of the same person safe and never touches an existing
 * row. Removing the assignment later never removes the membership.
 *
 * A user who already has access through a linked customer's team gets no
 * member row (GitHub #93): the team is the access path, and removing them from
 * the team must remove it.
 *
 * An unknown or inactive assignee is a no-op here (the members API refuses
 * inactive users too). An unknown id is reported by the caller: task create
 * checks it first (`assertUserExists`, 400 `assignee_not_found`), task update
 * connects the relation (404). Callers invoke this only when the assignee actually
 * changes, so re-saving a task never re-adds a member who was removed.
 *
 * Returns the added member's username when a NEW membership row was created
 * (so the caller can record the activity event), else null.
 *
 * Assignment is gated by `task:write` while the members API needs
 * `project:write`, so a user with only `task:write` can still add a member by
 * assigning a task. That is a known, accepted limitation.
 */
export async function ensureAssigneeIsMember(
  tx: Tx,
  projectId: number,
  assigneeId: number,
  addedById: number,
): Promise<{ username: string } | null> {
  const project = await tx.project.findUnique({
    where: { id: projectId },
    select: { tamId: true },
  });
  if (!project || project.tamId === assigneeId) return null;
  const assignee = await tx.user.findUnique({
    where: { id: assigneeId },
    select: { active: true, username: true },
  });
  if (!assignee?.active) return null;
  const onTeam = await tx.customerTeamMember.findFirst({
    where: { userId: assigneeId, customer: { projects: { some: { projectId } } } },
    select: { userId: true },
  });
  if (onTeam) return null;
  const { count } = await tx.projectMember.createMany({
    data: [{ projectId, userId: assigneeId, addedById }],
    skipDuplicates: true,
  });
  return count === 1 ? { username: assignee.username } : null;
}

/**
 * Unassigns every task of `userId` in `projectId` and returns how many were
 * changed (user decision 2026-09-30: nothing stays assigned to a person who
 * can no longer open the project). Takes the project's task-order lock first,
 * since it rewrites several rows (lib/orderLock.ts).
 */
export async function unassignUserTasks(
  tx: Prisma.TransactionClient,
  projectId: number,
  userId: number,
): Promise<number> {
  await lockProjectOrder(tx, "tasks", projectId);
  const { count } = await tx.task.updateMany({
    where: { projectId, assignedToId: userId },
    data: { assignedToId: null },
  });
  return count;
}

/**
 * Access ended for `userIds` on `projectIds`: a customer-team member removed,
 * a project unlinked from the customer, a customer deleted
 * (`via: "customerTeam"`, the default), or a project's TAM replaced
 * (`via: "tamChange"`; the old TAM is the user). Call it
 * inside the transaction AFTER the change: for each user and project that the
 * user can no longer see (projectVisibilityFilter built from their role, so
 * any other path to the project — TAM, member, other customer, view-all —
 * keeps their tasks) the user's tasks there are unassigned and a member
 * `removed` event records the count.
 */
export async function unassignWhereAccessLost(
  tx: Prisma.TransactionClient,
  opts: {
    userIds: readonly number[];
    projectIds: readonly number[];
    actorId: number;
    via?: "customerTeam" | "tamChange";
  },
): Promise<void> {
  if (opts.userIds.length === 0 || opts.projectIds.length === 0) return;
  const users = await tx.user.findMany({
    where: { id: { in: [...opts.userIds] } },
    select: { id: true, username: true, role: { select: { roleName: true, permissions: true } } },
  });
  for (const u of users) {
    const permissions = Array.isArray(u.role.permissions)
      ? u.role.permissions.filter((p): p is string => typeof p === "string")
      : [];
    const payload = { sub: u.id, role: u.role.roleName, permissions };
    if (hasPermission(payload, "project:view-all")) continue;
    const lost = await tx.project.findMany({
      where: {
        id: { in: [...opts.projectIds] },
        tasks: { some: { assignedToId: u.id } },
        NOT: projectVisibilityFilter(payload),
      },
      select: { id: true },
      // Fixed lock order across projects (as lib/taskStatuses.ts does).
      orderBy: { id: "asc" },
    });
    for (const project of lost) {
      const unassigned = await unassignUserTasks(tx, project.id, u.id);
      if (unassigned > 0) {
        await recordActivity(tx, {
          projectId: project.id,
          actorId: opts.actorId,
          entityType: "member",
          entityId: u.id,
          action: "removed",
          entityLabel: u.username,
          changes:
            opts.via === "tamChange"
              ? { unassignedTasks: unassigned, viaTamChange: true }
              : { unassignedTasks: unassigned, viaCustomerTeam: true },
        });
      }
    }
  }
}
