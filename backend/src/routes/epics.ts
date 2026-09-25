import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { TaskStatus } from "@prisma/client";
import { prisma } from "../prisma.js";
import { requireAuth, requirePermission, type JwtPayload } from "../http/auth.js";
import { HttpError } from "../http/errors.js";
import { validate } from "../http/validate.js";
import { ensureProjectVisible } from "../lib/visibility.js";

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
  startDate: z.coerce.date().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
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

epicsRouter.use(requireAuth);

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

    if (body.position === undefined) {
      // No ordering change: single update, same as before this task.
      const updated = await prisma.epic.update({
        where: { id },
        data,
        include: { owner: { select: { id: true, username: true, email: true } } },
      });
      const progress = await getEpicProgress(id);
      res.json({ ...updated, progress });
      return;
    }

    // Ordering patch: apply any non-position change first, then splice this
    // epic into the clamped index and re-pack the whole list dense 0..n-1,
    // all inside one transaction so the list is never observed half-moved —
    // mirrors sections.ts's PATCH /:id.
    const updated = await prisma.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) {
        await tx.epic.update({ where: { id }, data });
      }
      await insertEpicAt(tx, projectId, id, body.position!);
      return tx.epic.findUniqueOrThrow({
        where: { id },
        include: { owner: { select: { id: true, username: true, email: true } } },
      });
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
    await ensureEpicVisible(req.user!, id);
    // Tasks linked to this epic have epicId set to NULL via onDelete: SetNull
    // (docs/archive/plans/epics-spec.md §4) — they keep their data.
    await prisma.epic.delete({ where: { id } });
    res.status(204).end();
  },
);
