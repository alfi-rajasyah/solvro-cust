import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { TaskStatus } from "@prisma/client";
import { prisma } from "../prisma.js";
import { requireAuth, requirePermission, type JwtPayload } from "../http/auth.js";
import { HttpError } from "../http/errors.js";
import { dateInput } from "../lib/dateInput.js";
import { validate } from "../http/validate.js";
import { ensureProjectVisible } from "../lib/visibility.js";
import { recordActivity, shortLabel } from "../lib/activity.js";
import { diffEpicChanges, epicSnapshotSelect } from "../lib/epicActivity.js";
import { lockProjectOrder } from "../lib/orderLock.js";

// Resolve the epic's owning project and 404 if the caller can't see it.
// Mirrors ensureSectionVisible (backend/src/routes/sections.ts) — 404, never
// 403, so a hidden epic's existence isn't leaked via a permission error.
async function ensureEpicVisible(
  user: JwtPayload,
  epicId: number,
): Promise<{ projectId: number }> {
  const epic = await prisma.epic.findUnique({
    where: { id: epicId },
    select: { projectId: true },
  });
  if (!epic) throw new HttpError(404, "not_found", "Epic not found");
  await ensureProjectVisible(user, epic.projectId);
  return epic;
}

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

const updateEpicSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  ownerId: z.number().int().positive().nullable().optional(),
  startDate: dateInput.nullable().optional(),
  dueDate: dateInput.nullable().optional(),
  position: z.number().int().min(0).optional(),
});

const TASK_ROW_INCLUDE = {
  assignedTo: { select: { id: true, username: true, email: true } },
  labels: true,
  section: { select: { id: true, name: true, position: true, color: true } },
  _count: { select: { subtasks: true, comments: true } },
} satisfies Prisma.TaskInclude;

/**
 * Insert `epicId` into its project's epic list at `requestedPosition`
 * (clamped to [0, siblings.length]), then re-pack the whole list to dense
 * 0..n-1. Mirrors sections.ts's `insertSectionAt` exactly (same ordering
 * contract, same tie-break order as `GET /projects/:id/epics`). Must run
 * inside a `prisma.$transaction`. Returns the final position assigned to
 * `epicId`.
 */
async function insertEpicAt(
  tx: Prisma.TransactionClient,
  projectId: number,
  epicId: number,
  requestedPosition: number,
): Promise<number> {
  await lockProjectOrder(tx, "epics", projectId);
  const siblings = await tx.epic.findMany({
    where: { projectId, id: { not: epicId } },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { id: true },
  });

  const clamped = Math.max(0, Math.min(requestedPosition, siblings.length));

  const ordered = siblings.map((s) => s.id);
  ordered.splice(clamped, 0, epicId);

  for (let i = 0; i < ordered.length; i++) {
    await tx.epic.update({ where: { id: ordered[i] }, data: { position: i } });
  }

  return clamped;
}

/**
 * Progress for one epic: `total` is its top-level tasks (subtasks never
 * carry epicId — see lib/epics.ts), `done` is however many of them are
 * DONE. Same definition GET /:id derives from its already-fetched `tasks`
 * list (no extra query there) and GET /projects/:id/epics derives from one
 * groupBy across every epic in the project; this is the single-epic case —
 * used by PATCH /:id, which doesn't otherwise fetch the task list.
 */
async function getEpicProgress(epicId: number): Promise<{ done: number; total: number }> {
  const [total, done] = await Promise.all([
    prisma.task.count({ where: { epicId, parentTaskId: null } }),
    prisma.task.count({ where: { epicId, parentTaskId: null, status: "DONE" } }),
  ]);
  return { done, total };
}

export const epicsRouter = Router();

// Same `project:read` gate as /projects and /tasks (see routes/tasks.ts).
epicsRouter.use(requireAuth, requirePermission("project:read"));

epicsRouter.get("/:id", validate("params", idParamSchema), async (req, res) => {
  const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
  await ensureEpicVisible(req.user!, id);

  const epic = await prisma.epic.findUniqueOrThrow({
    where: { id },
    include: { owner: { select: { id: true, username: true, email: true } } },
  });

  // Top-level tasks only (subtasks never carry epicId — see lib/epics.ts).
  // Progress is derived from this same list, so no extra query: total is its
  // length, done is however many of them are DONE.
  const tasks = await prisma.task.findMany({
    where: { epicId: id, parentTaskId: null },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    include: TASK_ROW_INCLUDE,
  });
  const done = tasks.filter((t) => t.status === "DONE").length;

  res.json({ ...epic, progress: { done, total: tasks.length }, tasks });
});

epicsRouter.patch(
  "/:id",
  requirePermission("project:write"),
  validate("params", idParamSchema),
  validate("body", updateEpicSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const body = req.body as z.infer<typeof updateEpicSchema>;
    const { projectId } = await ensureEpicVisible(req.user!, id);

    const data: Prisma.EpicUpdateInput = {};
    if (body.title !== undefined) data.title = body.title;
    if (body.description !== undefined) data.description = body.description;
    if (body.status !== undefined) data.status = body.status;
    if (body.color !== undefined) data.color = body.color;
    if (body.startDate !== undefined) data.startDate = body.startDate;
    if (body.dueDate !== undefined) data.dueDate = body.dueDate;
    if (body.ownerId !== undefined) {
      data.owner = body.ownerId === null ? { disconnect: true } : { connect: { id: body.ownerId } };
    }

    // One transaction: the diff is taken against the row this write replaced
    // and the activity event commits with it. With a `position`, any
    // non-position change is applied first, then this epic is spliced into the
    // clamped index and the whole list re-packed dense 0..n-1, so the list is
    // never observed half-moved — mirrors sections.ts's PATCH /:id. A
    // position-only write diffs to `{}` and records nothing
    // (docs/archive/plans/internal-sync.md).
    const updated = await prisma.$transaction(async (tx) => {
      // A reorder re-packs the project's epic list: take that lock before the
      // row lock below (lib/orderLock.ts explains the order).
      if (body.position !== undefined) await lockProjectOrder(tx, "epics", projectId);
      // Lock first so overlapping identical saves serialise and record one event.
      await tx.$queryRaw`SELECT id FROM epics WHERE id = ${id} FOR NO KEY UPDATE`;
      const before = await tx.epic.findUniqueOrThrow({
        where: { id },
        select: epicSnapshotSelect,
      });
      if (Object.keys(data).length > 0) {
        await tx.epic.update({ where: { id }, data });
      }
      if (body.position !== undefined) {
        await insertEpicAt(tx, projectId, id, body.position);
      }
      const result = await tx.epic.findUniqueOrThrow({
        where: { id },
        include: { owner: { select: { id: true, username: true, email: true } } },
      });
      await recordActivity(tx, {
        projectId,
        actorId: req.user!.sub,
        entityType: "epic",
        entityId: id,
        action: "updated",
        entityLabel: shortLabel(result.title),
        changes: diffEpicChanges(before, result),
      });
      return result;
    });
    const progress = await getEpicProgress(id);
    res.json({ ...updated, progress });
  },
);

epicsRouter.delete(
  "/:id",
  requirePermission("project:write"),
  validate("params", idParamSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const { projectId } = await ensureEpicVisible(req.user!, id);
    // Tasks linked to this epic have epicId set to NULL via onDelete: SetNull
    // (docs/archive/plans/epics-spec.md §4) — they keep their data. The event
    // snapshots the title and how many tasks lost the link.
    await prisma.$transaction(async (tx) => {
      const epic = await tx.epic.findUnique({ where: { id }, select: { title: true } });
      if (!epic) throw new HttpError(404, "not_found", "Epic not found");
      const taskCount = await tx.task.count({ where: { epicId: id } });
      await tx.epic.delete({ where: { id } });
      await recordActivity(tx, {
        projectId,
        actorId: req.user!.sub,
        entityType: "epic",
        entityId: id,
        action: "deleted",
        entityLabel: shortLabel(epic.title),
        changes: { taskCount },
      });
    });
    res.status(204).end();
  },
);
