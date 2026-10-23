import type { Prisma, PrismaClient } from "@prisma/client";

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
  const { count } = await tx.projectMember.createMany({
    data: [{ projectId, userId: assigneeId, addedById }],
    skipDuplicates: true,
  });
  return count === 1 ? { username: assignee.username } : null;
}
