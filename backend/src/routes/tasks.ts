import { Router } from "express";
import { z } from "zod";
import { Prisma, Priority, TaskStatus } from "@prisma/client";
import { prisma } from "../prisma.js";
import { requireAuth, requirePermission, type JwtPayload } from "../http/auth.js";
import { HttpError } from "../http/errors.js";
import { validate } from "../http/validate.js";
import { ensureTaskVisible, projectVisibilityFilter } from "../lib/visibility.js";
import { isValidDayString, overdueBoundary } from "../lib/dateBoundary.js";
import {
  assertLabelsInProject,
  assertSectionInProject,
  assertValidParent,
  insertManyAfter,
  moveTaskWithinSiblings,
  siblingKeyEquals,
  type SiblingKey,
} from "../lib/taskOrdering.js";
import { duplicateTaskTree } from "../lib/duplicate.js";

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

const updateTaskSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    status: z.nativeEnum(TaskStatus).optional(),
    priority: z.nativeEnum(Priority).optional(),
    startDate: z.coerce.date().nullable().optional(),
    dueDate: z.coerce.date().nullable().optional(),
    isMilestone: z.boolean().optional(),
    isCriticalPath: z.boolean().optional(),
    // baselineStartDate / baselineDueDate are intentionally NOT accepted here —
    // they are server-set only, snapshotted by POST /projects/:id/baseline.
    // Accepting them from clients would let any task:write user overwrite the
    // Gantt planned-vs-actual baseline. (The data mapping never wrote them, but
    // keep them out of the schema so that stays true.)
    assignedToId: z.number().int().positive().nullable().optional(),
    parentTaskId: z.number().int().positive().nullable().optional(),
    sectionId: z.number().int().positive().nullable().optional(),
    labelIds: z.array(z.number().int().positive()).optional(),
    position: z.number().int().min(0).optional(),
  })
  .refine((b) => !(b.isMilestone === true && b.dueDate === null), {
    message: "A milestone requires a due date",
    path: ["dueDate"],
  });

const tasksListQuerySchema = z.object({
  status: z.nativeEnum(TaskStatus).optional(),
  priority: z.nativeEnum(Priority).optional(),
  assignedToId: z.coerce.number().int().positive().optional(),
  labelId: z.coerce.number().int().positive().optional(),
  customerId: z.coerce.number().int().positive().optional(),
  overdue: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .optional(),
  topLevel: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .optional(),
  // Caller's local calendar day ("yyyy-MM-dd"), used only when overdue=true
  // — see lib/dateBoundary.ts for the full contract. Ignored otherwise.
  today: z
    .string()
    .refine(isValidDayString, { message: "today must be a valid yyyy-MM-dd date" })
    .optional(),
});

const createCommentSchema = z.object({
  body: z.string().min(1).max(5000),
});

function buildVisibilityWhere(user: JwtPayload): Prisma.TaskWhereInput {
  const projectWhere = projectVisibilityFilter(user);
  if (Object.keys(projectWhere).length === 0) return {};
  return { project: projectWhere };
}

export const tasksRouter = Router();

tasksRouter.use(requireAuth);

// Cross-project list with filters
tasksRouter.get("/", validate("query", tasksListQuerySchema), async (req, res) => {
  const { status, priority, assignedToId, labelId, customerId, overdue, topLevel, today } =
    req.query as unknown as z.infer<typeof tasksListQuerySchema>;

  const where: Prisma.TaskWhereInput = {
    ...buildVisibilityWhere(req.user!),
  };
  if (priority) where.priority = priority;
  if (assignedToId) where.assignedToId = assignedToId;
  if (labelId) where.labels = { some: { id: labelId } };
  if (customerId) {
    where.project = { ...(where.project as object | undefined), customerId };
  }
  if (topLevel) where.parentTaskId = null;
  if (overdue) {
    // Overdue = due before the CALLER's calendar day (param `today`),
    // falling back to the server's UTC day; DONE always excluded. See
    // lib/dateBoundary.ts for the full contract (shared with
    // lib/portfolio.ts's isOverdue/daysOverdue).
    where.dueDate = { lt: overdueBoundary(today) };
    // Overdue is not Done: the not-DONE exclusion always applies, and an
    // explicit ?status filter narrows by INTERSECTION rather than being
    // silently overwritten — status=TODO&overdue=true returns overdue
    // TODOs; status=DONE&overdue=true is a contradiction and returns
    // nothing, by construction.
    where.AND = status ? [{ status }, { status: { not: "DONE" } }] : [{ status: { not: "DONE" } }];
  } else if (status) {
    where.status = status;
  }

  const tasks = await prisma.task.findMany({
    where,
    orderBy: [{ position: "asc" }, { id: "asc" }],
    include: {
      assignedTo: { select: { id: true, username: true, email: true } },
      labels: true,
      project: {
        select: {
          id: true,
          name: true,
          customer: { select: { id: true, name: true } },
        },
      },
      _count: { select: { subtasks: true, comments: true } },
    },
    take: 200,
  });
  res.json(tasks);
});

tasksRouter.patch(
  "/:id",
  requirePermission("task:write"),
  validate("params", idParamSchema),
  validate("body", updateTaskSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const body = req.body as z.infer<typeof updateTaskSchema>;

    // Visibility first: a caller who can't see the task must get a 404 before
    // any field-level validation, so the self-parent guard can't be used as a
    // 400-vs-404 existence oracle for tasks on projects they can't see.
    await ensureTaskVisible(req.user!, id);

    if (body.parentTaskId === id) {
      throw new HttpError(400, "invalid_parent", "Task cannot be its own parent");
    }

    const current = await prisma.task.findUniqueOrThrow({
      where: { id },
      select: {
        projectId: true,
        status: true,
        parentTaskId: true,
        position: true,
        isMilestone: true,
        dueDate: true,
      },
    });

    const nextStatus = body.status ?? current.status;
    const nextParentTaskId =
      body.parentTaskId !== undefined ? body.parentTaskId : current.parentTaskId;

    const oldKey: SiblingKey = {
      projectId: current.projectId,
      parentTaskId: current.parentTaskId,
    };
    const newKey: SiblingKey = {
      projectId: current.projectId,
      parentTaskId: nextParentTaskId,
    };

    // A patch only re-orders when it sets an explicit position OR moves the
    // task to a different sibling list (i.e. a re-parent). A status-only
    // change is NOT a reorder for any task, top-level or subtask: sibling
    // lists are keyed on parentTaskId alone (status doesn't partition them),
    // so siblingKeyEquals reports the keys equal and the row keeps its slot.
    // Previously a top-level task's key included status, so any status
    // change re-appended the row to the end of its destination column —
    // that's the exact behavior this task removes.
    const touchesOrdering =
      body.position !== undefined || !siblingKeyEquals(oldKey, newKey);

    const updated = await prisma.$transaction(async (tx) => {
      if (nextParentTaskId !== null) {
        await assertValidParent(tx, current.projectId, id, nextParentTaskId);
      }
      if (body.sectionId != null) {
        await assertSectionInProject(tx, current.projectId, body.sectionId);
      }
      if (body.labelIds && body.labelIds.length > 0) {
        await assertLabelsInProject(tx, current.projectId, body.labelIds);
      }

      const data: Prisma.TaskUpdateInput = {};
      if (body.title !== undefined) data.title = body.title;
      if (body.description !== undefined) data.description = body.description;
      if (body.priority !== undefined) data.priority = body.priority;
      if (body.startDate !== undefined) data.startDate = body.startDate;
      if (body.dueDate !== undefined) data.dueDate = body.dueDate;
      if (body.isMilestone !== undefined) data.isMilestone = body.isMilestone;
      if (body.isCriticalPath !== undefined) data.isCriticalPath = body.isCriticalPath;
      // Milestone due-date lockstep: whatever this patch results in, a
      // milestone with a due date must have startDate === dueDate.
      const willBeMilestone = body.isMilestone ?? current.isMilestone;
      const effectiveDue =
        body.dueDate !== undefined ? body.dueDate : current.dueDate;
      if (willBeMilestone && effectiveDue) data.startDate = effectiveDue;
      if (body.assignedToId !== undefined) {
        data.assignedTo = body.assignedToId === null
          ? { disconnect: true }
          : { connect: { id: body.assignedToId } };
      }
      if (body.parentTaskId !== undefined) {
        data.parent = body.parentTaskId === null
          ? { disconnect: true }
          : { connect: { id: body.parentTaskId } };
      }
      if (body.sectionId !== undefined) {
        data.section = body.sectionId === null
          ? { disconnect: true }
          : { connect: { id: body.sectionId } };
      }
      if (body.labelIds !== undefined) {
        data.labels = { set: body.labelIds.map((lid) => ({ id: lid })) };
      }

      if (touchesOrdering) {
        // Status is never part of the sibling key, so it can't be what makes
        // touchesOrdering true here — this branch only runs for an explicit
        // position or a re-parent. Still apply nextStatus: a caller can send
        // status and position together (e.g. drag a card to a new column at
        // a specific row), and that combined write must land in the same
        // update as the position/parent change.
        data.status = nextStatus;

        // Apply the non-ordering fields (and the parent/status change) first,
        // then compute the new dense position for this row and every sibling
        // it displaced. moveTaskWithinSiblings issues its own updates for
        // position, so exclude it from `data` to avoid a redundant write.
        await tx.task.update({ where: { id }, data });
        const finalPosition = await moveTaskWithinSiblings(
          tx,
          id,
          oldKey,
          newKey,
          body.position,
        );
        return tx.task.update({
          where: { id },
          data: { position: finalPosition },
          include: {
            assignedTo: { select: { id: true, username: true, email: true } },
            labels: true,
            section: { select: { id: true, name: true, position: true, color: true } },
            _count: { select: { subtasks: true, comments: true } },
          },
        });
      }

      if (body.status !== undefined) data.status = body.status;
      return tx.task.update({
        where: { id },
        data,
        include: {
          assignedTo: { select: { id: true, username: true, email: true } },
          labels: true,
          section: { select: { id: true, name: true, position: true, color: true } },
          _count: { select: { subtasks: true, comments: true } },
        },
      });
    });

    res.json(updated);
  },
);

tasksRouter.delete(
  "/:id",
  requirePermission("task:write"),
  validate("params", idParamSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    await ensureTaskVisible(req.user!, id);
    await prisma.task.delete({ where: { id } });
    res.status(204).end();
  },
);

// Duplicate a task (and, when it's a top-level task, its subtasks) — no
// body. A top-level source copies with its subtasks nested under the copy;
// a subtask source copies just that one row under the same parentTaskId.
// See docs/plans/duplicate-tasks-sections.md §3-4 for the settled field
// rules (status -> TODO, baseline cleared, dependencies dropped, comments
// never copied) implemented by duplicateTaskTree.
tasksRouter.post(
  "/:id/duplicate",
  requirePermission("task:write"),
  validate("params", idParamSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    await ensureTaskVisible(req.user!, id);

    const newTask = await prisma.$transaction(async (tx) => {
      const source = await tx.task.findUniqueOrThrow({
        where: { id },
        select: { projectId: true, parentTaskId: true },
      });

      const idMap = await duplicateTaskTree(tx, [id]);
      const newId = idMap.get(id)!;

      // The copy lands at the end of the same sibling list duplicateTaskTree
      // appended it to (source's own list, since no overrides were passed) —
      // move it to right after the source. Placed by the source's identity
      // (insertManyAfter), not `source.position + 1` as an index: DELETE
      // /tasks/:id never re-packs its sibling list, so a stale position
      // value can point at the wrong row once an earlier sibling was
      // deleted. insertManyAfter re-packs the whole list dense regardless.
      const key: SiblingKey = { projectId: source.projectId, parentTaskId: source.parentTaskId };
      await insertManyAfter(tx, key, id, [newId]);

      return tx.task.findUniqueOrThrow({
        where: { id: newId },
        include: {
          assignedTo: { select: { id: true, username: true, email: true } },
          labels: true,
          section: { select: { id: true, name: true, position: true, color: true } },
          _count: { select: { subtasks: true, comments: true } },
        },
      });
    });

    res.status(201).json(newTask);
  },
);

// Comments thread
tasksRouter.get(
  "/:id/comments",
  validate("params", idParamSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    await ensureTaskVisible(req.user!, id);
    const comments = await prisma.comment.findMany({
      where: { taskId: id },
      orderBy: { createdAt: "asc" },
      include: { author: { select: { id: true, username: true, email: true } } },
    });
    res.json(comments);
  },
);

tasksRouter.post(
  "/:id/comments",
  validate("params", idParamSchema),
  validate("body", createCommentSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const { body } = req.body as z.infer<typeof createCommentSchema>;
    await ensureTaskVisible(req.user!, id);
    const comment = await prisma.comment.create({
      data: {
        taskId: id,
        authorId: req.user!.sub,
        body,
      },
      include: { author: { select: { id: true, username: true, email: true } } },
    });
    res.status(201).json(comment);
  },
);
