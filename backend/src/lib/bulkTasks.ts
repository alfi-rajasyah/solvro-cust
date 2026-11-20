import { z } from "zod";
import { Prisma, Priority } from "@prisma/client";
import { prisma } from "../prisma.js";
import { HttpError } from "../http/errors.js";
import type { JwtPayload } from "../http/auth.js";
import { projectVisibilityFilter } from "./visibility.js";
import { assertLabelsInProject } from "./taskOrdering.js";
import { lockProjectOrder } from "./orderLock.js";
import { assertEpicNotOnSubtask, assertValidEpic } from "./epics.js";
import { lockStatusListShared, resolveStatusWrite, statusDefInclude } from "./taskStatuses.js";
import { ensureAssigneeIsMember } from "./projectMembers.js";
import { diffTaskChanges, recordActivity } from "./activity.js";
import { notifyForEvent } from "./notifications.js";

export const BULK_TASK_LIMIT = 200;

const id = z.number().int().positive();

// POST /tasks/bulk body. No `expected` (the per-field stale-write check of
// PATCH /tasks/:id): a bulk edit applies to the rows as they are now.
export const bulkTasksSchema = z
  .object({
    taskIds: z.array(id).min(1).max(BULK_TASK_LIMIT),
    addLabelIds: z.array(id).max(100).optional(),
    removeLabelIds: z.array(id).max(100).optional(),
    statusId: id.optional(),
    assignedToId: id.nullable().optional(),
    priority: z.nativeEnum(Priority).optional(),
    epicId: id.nullable().optional(),
  })
  .strict()
  .refine((b) => new Set(b.taskIds).size === b.taskIds.length, {
    message: "taskIds must be unique",
    path: ["taskIds"],
  })
  .refine(
    (b) =>
      (b.addLabelIds?.length ?? 0) > 0 ||
      (b.removeLabelIds?.length ?? 0) > 0 ||
      b.statusId !== undefined ||
      b.assignedToId !== undefined ||
      b.priority !== undefined ||
      b.epicId !== undefined,
    { message: "At least one change is required" },
  )
  .refine(
    (b) => {
      const removed = new Set(b.removeLabelIds ?? []);
      return !(b.addLabelIds ?? []).some((l) => removed.has(l));
    },
    { message: "A label cannot be both added and removed", path: ["removeLabelIds"] },
  );
export type BulkTasksBody = z.infer<typeof bulkTasksSchema>;

const snapshotInclude = {
  assignedTo: { select: { id: true, username: true } },
  labels: { select: { id: true, name: true } },
  ...statusDefInclude,
} satisfies Prisma.TaskInclude;

/**
 * Applies one change set to many tasks of ONE project, all or nothing. Reuses
 * the single-update rules (PATCH /tasks/:id): status through
 * resolveStatusWrite under the shared status-list lock, labels in project,
 * epic on top-level tasks only, a non-member assignee becomes a member,
 * activity and assignee notification per task. `position` is never touched.
 * Returns the number of tasks that actually changed.
 */
export async function bulkUpdateTasks(user: JwtPayload, body: BulkTasksBody): Promise<number> {
  // Visibility first, so a hidden or missing id is a plain 404 and nothing
  // below can act as an existence oracle.
  const visible = await prisma.task.findMany({
    where: { id: { in: body.taskIds }, project: projectVisibilityFilter(user) },
    select: { id: true, projectId: true },
  });
  if (
    visible.length !== body.taskIds.length ||
    new Set(visible.map((t) => t.projectId)).size !== 1
  ) {
    throw new HttpError(404, "not_found", "Task not found");
  }
  const projectId = visible[0].projectId;
  const ids = [...body.taskIds].sort((a, b) => a - b);

  return prisma.$transaction(
    async (tx) => {
      // Lock order (lib/orderLock.ts): status list, then the project's task
      // order, then the rows. The order lock is unconditional: this write
      // row-locks many members of the task list, so it must queue behind any
      // reorder, delete or status-delete move that re-packs the list.
      if (body.statusId !== undefined) await lockStatusListShared(tx, 10_000);
      await lockProjectOrder(tx, "tasks", projectId);
      // Ascending id order so two overlapping bulk writes cannot deadlock.
      await tx.$queryRaw`SELECT id FROM tasks WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR NO KEY UPDATE`;
      const before = await tx.task.findMany({
        where: { id: { in: ids } },
        orderBy: { id: "asc" },
        include: snapshotInclude,
      });

      const nextStatus =
        body.statusId !== undefined ? await resolveStatusWrite(tx, { statusId: body.statusId }) : null;

      const labelIds = [...(body.addLabelIds ?? []), ...(body.removeLabelIds ?? [])];
      if (labelIds.length > 0) await assertLabelsInProject(tx, projectId, labelIds);

      if (body.epicId != null) {
        for (const t of before) assertEpicNotOnSubtask(body.epicId, t.parentTaskId);
        await assertValidEpic(tx, projectId, body.epicId);
      }

      if (body.assignedToId != null) {
        const assignee = await tx.user.findUnique({
          where: { id: body.assignedToId },
          select: { active: true },
        });
        if (!assignee) throw new HttpError(400, "assignee_not_found", "Assignee not found");
        if (!assignee.active) {
          throw new HttpError(400, "assignee_inactive", "Assignee is deactivated");
        }
        if (before.some((t) => t.assignedToId !== body.assignedToId)) {
          const added = await ensureAssigneeIsMember(
            tx,
            projectId,
            body.assignedToId,
            user.sub,
          );
          if (added) {
            await recordActivity(tx, {
              projectId,
              actorId: user.sub,
              entityType: "member",
              entityId: body.assignedToId,
              action: "added",
              entityLabel: added.username,
            });
          }
        }
      }

      const data: Prisma.TaskUpdateInput = {};
      if (body.priority !== undefined) data.priority = body.priority;
      if (body.assignedToId !== undefined) {
        data.assignedTo =
          body.assignedToId === null ? { disconnect: true } : { connect: { id: body.assignedToId } };
      }
      if (body.epicId !== undefined) {
        data.epic = body.epicId === null ? { disconnect: true } : { connect: { id: body.epicId } };
      }
      if (nextStatus) {
        data.status = nextStatus.status;
        data.statusDef = { connect: { id: nextStatus.statusId } };
      }
      const addLabels = (body.addLabelIds ?? []).map((l) => ({ id: l }));
      const removeLabels = (body.removeLabelIds ?? []).map((l) => ({ id: l }));
      if (addLabels.length > 0 || removeLabels.length > 0) {
        data.labels = {
          ...(addLabels.length > 0 ? { connect: addLabels } : {}),
          ...(removeLabels.length > 0 ? { disconnect: removeLabels } : {}),
        };
      }

      let changed = 0;
      for (const prev of before) {
        // A subtask never carries an epic: clearing is a no-op, linking was
        // refused above. Skip the epic field for it so nothing is written.
        const rowData: Prisma.TaskUpdateInput = { ...data };
        if (prev.parentTaskId !== null) delete rowData.epic;
        const after = await tx.task.update({
          where: { id: prev.id },
          data: rowData,
          include: snapshotInclude,
        });
        const event = await recordActivity(tx, {
          projectId,
          actorId: user.sub,
          entityType: "task",
          entityId: prev.id,
          action: "updated",
          entityLabel: after.title,
          changes: diffTaskChanges(prev, after),
        });
        if (event) changed += 1;
        await notifyForEvent(tx, event);
      }
      return changed;
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}
