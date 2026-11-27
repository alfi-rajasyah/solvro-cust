// Writes the comments an incoming webhook produced (docs/archive/plans/webhooks.md,
// Phase 2). The author is the user who created the URL; each comment records the
// same `comment` `created` activity and notifications as a comment typed in the
// task (routes/tasks.ts), and carries `source: "incoming"` so outgoing webhooks
// never relay it.
import type { Prisma } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { recordActivity } from "../activity.js";
import { filterActiveUsersWhoCanSeeProject, notifyForEvent } from "../notifications.js";
import { permissionsOf } from "../../http/auth.js";
import { MAX_COMMENTS_PER_REQUEST, MAX_TASKS_PER_REQUEST, type CommentCandidate } from "./scan.js";

export interface HookForWrite {
  id: number;
  projectId: number;
  createdById: number;
}

export interface WriteResult {
  linked: number;
  duplicate?: true;
}

/** Codes stored in `InboundHook.disabledReason`; the frontend turns them into sentences (lib/labels.ts). */
export const DISABLED_REASONS = {
  inactive: "creator_inactive",
  lostAccess: "creator_lost_access",
  lostPermission: "creator_lost_permission",
} as const;

/**
 * One transaction: records the `webhook-id` (when signed), checks the author
 * still counts, writes the comments for the hook's own tasks that no earlier
 * delivery covered, and stamps `lastReceivedAt`.
 */
export async function writeInboundComments(
  hook: HookForWrite,
  candidates: CommentCandidate[],
  messageId: string | null,
): Promise<WriteResult> {
  return prisma.$transaction(async (tx) => {
    if (messageId !== null) {
      const inserted = await tx.inboundHookMessage.createMany({ data: [{ hookId: hook.id, messageId }], skipDuplicates: true });
      if (inserted.count === 0) return { linked: 0, duplicate: true as const };
    }
    await tx.inboundHook.update({ where: { id: hook.id }, data: { lastReceivedAt: new Date() } });

    // The author must still be an active user who can see the project and may
    // comment (task:comment, like POST /tasks/:id/comments); otherwise the URL
    // turns itself off and nothing is written.
    const creator = await tx.user.findUnique({
      where: { id: hook.createdById },
      select: { active: true, role: { select: { permissions: true } } },
    });
    let disabled: string | null = null;
    if (!creator?.active) disabled = DISABLED_REASONS.inactive;
    else if (!(await filterActiveUsersWhoCanSeeProject(tx, hook.projectId, [hook.createdById])).has(hook.createdById)) {
      disabled = DISABLED_REASONS.lostAccess;
    } else {
      const permissions = permissionsOf(creator.role.permissions);
      if (!permissions.includes("*") && !permissions.includes("task:comment")) disabled = DISABLED_REASONS.lostPermission;
    }
    if (disabled !== null) {
      await tx.inboundHook.update({ where: { id: hook.id }, data: { active: false, disabledReason: disabled } });
      return { linked: 0 };
    }
    if (candidates.length === 0) return { linked: 0 };

    // Only tasks of the hook's own project: any other id is ignored.
    const tasks = await tx.task.findMany({
      where: { id: { in: [...new Set(candidates.map((c) => c.taskId))] }, projectId: hook.projectId },
      select: { id: true, title: true, assignedToId: true },
    });
    const byId = new Map(tasks.map((t) => [t.id, t]));

    // The caps count only tasks of this project, so links to other projects
    // cannot use them up.
    const taken = new Set<number>();
    let linked = 0;
    let written = 0;
    for (const c of candidates) {
      const task = byId.get(c.taskId);
      if (!task) continue;
      if (!taken.has(task.id) && taken.size >= MAX_TASKS_PER_REQUEST) continue;
      if (written >= MAX_COMMENTS_PER_REQUEST) break;
      taken.add(task.id);
      written += 1;
      const claimed = await tx.inboundHookLink.createMany({
        data: [{ hookId: hook.id, taskId: task.id, sourceKey: c.sourceKey }],
        skipDuplicates: true,
      });
      if (claimed.count === 0) continue;
      const comment = await tx.comment.create({
        data: {
          taskId: task.id,
          authorId: hook.createdById,
          body: c.body,
          source: "incoming",
          inboundHookId: hook.id,
        } satisfies Prisma.CommentUncheckedCreateInput,
        select: { id: true },
      });
      const event = await recordActivity(tx, {
        projectId: hook.projectId,
        actorId: hook.createdById,
        entityType: "comment",
        entityId: comment.id,
        action: "created",
        entityLabel: task.title,
        changes: { taskId: task.id, source: "incoming" },
      });
      await notifyForEvent(tx, event, { taskAssigneeId: task.assignedToId, mentionedUserIds: [] });
      linked += 1;
    }
    return { linked };
    // Up to 100 comments, each with activity and notification rows.
  }, { timeout: 30_000, maxWait: 10_000 });
}
