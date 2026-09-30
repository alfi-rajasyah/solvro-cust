import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { requireAuth, requirePermission, type JwtPayload } from "../http/auth.js";
import { HttpError } from "../http/errors.js";
import { validate } from "../http/validate.js";
import { ensureProjectVisible } from "../lib/visibility.js";
import { insertManyAfter, type SiblingKey } from "../lib/taskOrdering.js";
import { duplicateTaskTree } from "../lib/duplicate.js";
import { recordActivity } from "../lib/activity.js";

// Resolve the section's owning project and 404 if the caller can't see it.
// Permission alone (`project:write`) doesn't scope the caller to a project, so
// without this any writer could mutate sections by guessing the id (IDOR).
async function ensureSectionVisible(
  user: JwtPayload,
  sectionId: number,
): Promise<{ projectId: number }> {
  const section = await prisma.section.findUnique({
    where: { id: sectionId },
    select: { projectId: true },
  });
  if (!section) throw new HttpError(404, "not_found", "Section not found");
  await ensureProjectVisible(user, section.projectId);
  return section;
}

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

const updateSectionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  position: z.number().int().min(0).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

/**
 * Insert `sectionId` into its project's section list at `requestedPosition`
 * (clamped to [0, siblings.length]), then re-pack the whole list to dense
 * 0..n-1. Mirrors taskOrdering.ts's `insertAt`: siblings are fetched
 * excluding self, ordered [{position:"asc"},{id:"asc"}] — the same order
 * `GET /projects/:id/sections` reads back, so ties resolve identically.
 * Must run inside a `prisma.$transaction`. Returns the final position
 * assigned to `sectionId`.
 */
async function insertSectionAt(
  tx: Prisma.TransactionClient,
  projectId: number,
  sectionId: number,
  requestedPosition: number,
): Promise<number> {
  const siblings = await tx.section.findMany({
    where: { projectId, id: { not: sectionId } },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { id: true },
  });

  const clamped = Math.max(0, Math.min(requestedPosition, siblings.length));

  const ordered = siblings.map((s) => s.id);
  ordered.splice(clamped, 0, sectionId);

  for (let i = 0; i < ordered.length; i++) {
    await tx.section.update({ where: { id: ordered[i] }, data: { position: i } });
  }

  return clamped;
}

/**
 * Insert a brand-new section (`newSectionId`) into `projectId`'s section
 * list directly after `afterSectionId`, BY IDENTITY, then re-pack the whole
 * list to dense 0..n-1 in one pass. Deliberately not `insertSectionAt`
 * (which inserts by INDEX via a requested position): the section list can
 * be sparse after `DELETE /sections/:id` (a bare delete with no re-pack —
 * see the delete handler below), so treating `source.position + 1` as an
 * index into the list can land the new section on the wrong row or collide
 * with an existing position value. Mirrors taskOrdering.ts's
 * `insertManyAfter` (same identity-based approach, singular instead of
 * batched since a section-duplicate only ever creates one new section) but
 * carries no membership guard of its own — the caller created
 * `newSectionId` in this project one statement earlier.
 *
 * `newSectionId` must already be a row in this project's section list (the
 * caller just created it); `afterSectionId` is excluded from the "existing
 * members" read below, so the splice below finds it in `others` correctly
 * regardless of where the create landed it.
 *
 * Must run inside a `prisma.$transaction`.
 */
async function insertSectionAfter(
  tx: Prisma.TransactionClient,
  projectId: number,
  newSectionId: number,
  afterSectionId: number,
): Promise<void> {
  const others = await tx.section.findMany({
    where: { projectId, id: { not: newSectionId } },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { id: true },
  });

  const afterIndex = others.findIndex((s) => s.id === afterSectionId);
  const insertIndex = afterIndex === -1 ? others.length : afterIndex + 1;

  const ordered = others.map((s) => s.id);
  ordered.splice(insertIndex, 0, newSectionId);

  for (let i = 0; i < ordered.length; i++) {
    await tx.section.update({ where: { id: ordered[i] }, data: { position: i } });
  }
}

export const sectionsRouter = Router();

sectionsRouter.use(requireAuth);

sectionsRouter.patch(
  "/:id",
  requirePermission("project:write"),
  validate("params", idParamSchema),
  validate("body", updateSectionSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const body = req.body as z.infer<typeof updateSectionSchema>;
    const { projectId } = await ensureSectionVisible(req.user!, id);

    if (body.position === undefined) {
      // No ordering change: single update, same as before this task.
      const updated = await prisma.section.update({ where: { id }, data: body });
      res.json(updated);
      return;
    }

    // Ordering patch: apply any name/color change first (excluding
    // position — the re-pack below issues its own position writes for every
    // displaced sibling), then splice this section into the clamped index
    // and re-pack the whole list dense 0..n-1, all inside one transaction so
    // the list is never observed half-moved.
    const { position, ...rest } = body;
    const updated = await prisma.$transaction(async (tx) => {
      if (Object.keys(rest).length > 0) {
        await tx.section.update({ where: { id }, data: rest });
      }
      // insertSectionAt's re-pack loop already writes id's dense position as
      // part of rewriting every displaced sibling — read the row back
      // instead of issuing a redundant identical write.
      await insertSectionAt(tx, projectId, id, position);
      return tx.section.findUniqueOrThrow({ where: { id } });
    });
    res.json(updated);
  },
);

// Duplicate a section — its own name/color plus every top-level task
// (sectionId = id, parentTaskId = null) and each of THEIR subtasks — no
// body. See docs/plans/duplicate-tasks-sections.md §3-4 for the settled
// field rules (status -> TODO, baseline cleared, dependencies dropped,
// comments never copied) implemented by duplicateTaskTree — the same
// engine POST /tasks/:id/duplicate uses. The new section carries the
// source's name and color verbatim (decision 1) and is placed directly
// after the source in the project's section list (decision 10); its
// top-level task copies land directly after the source section's own last
// top-level task in the project's task order (also decision 10) — NOT at
// the end of the project and NOT interleaved with the source's tasks.
sectionsRouter.post(
  "/:id/duplicate",
  requirePermission("project:write"),
  validate("params", idParamSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const { projectId } = await ensureSectionVisible(req.user!, id);

    const result = await prisma.$transaction(async (tx) => {
      const source = await tx.section.findUniqueOrThrow({
        where: { id },
        select: { name: true, color: true },
      });

      // Position is a placeholder here: insertSectionAfter places the new
      // row by identity (right after `id`) and re-packs the whole list
      // itself in the same pass, overwriting whatever position the create
      // below lands on.
      const newSection = await tx.section.create({
        data: { projectId, name: source.name, color: source.color, position: 0 },
      });
      await insertSectionAfter(tx, projectId, newSection.id, id);

      // The source's top-level tasks, in the project's manual order. A task
      // that carries this section's id directly but is itself a subtask
      // (parentTaskId != null) is NOT in this list — it's picked up below
      // only if its own parent is one of these top-level tasks, exactly as
      // duplicateTaskTree already handles for POST /tasks/:id/duplicate.
      const sourceTasks = await tx.task.findMany({
        where: { sectionId: id, parentTaskId: null },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: { id: true },
      });
      // Counts TOP-LEVEL copies only — subtasks copied alongside them are
      // not added to this count, so it matches what a caller would see
      // counting this section's direct rows, not a full descendant count.
      const taskCount = sourceTasks.length;

      if (taskCount > 0) {
        const sourceTaskIds = sourceTasks.map((t) => t.id);
        const idMap = await duplicateTaskTree(tx, sourceTaskIds, { sectionId: newSection.id });
        const newTopLevelIds = sourceTaskIds.map((sourceId) => idMap.get(sourceId)!);

        // Drop the whole copied batch in right after the source section's
        // OWN last top-level task, in one re-pack of the project's
        // top-level list — not `insertManyAfter` once per copy.
        const lastSourceTopLevelId = sourceTaskIds[sourceTaskIds.length - 1];
        const key: SiblingKey = { projectId, parentTaskId: null };
        await insertManyAfter(tx, key, lastSourceTopLevelId, newTopLevelIds);

        // One `task created` event per copied top-level task (subtasks ride
        // along unlogged), oldest copy first.
        const copies = await tx.task.findMany({
          where: { id: { in: newTopLevelIds } },
          select: { id: true, title: true },
        });
        const titleById = new Map(copies.map((c) => [c.id, c.title]));
        for (const copyId of newTopLevelIds) {
          await recordActivity(tx, {
            projectId,
            actorId: req.user!.sub,
            entityType: "task",
            entityId: copyId,
            action: "created",
            entityLabel: titleById.get(copyId) ?? null,
          });
        }
      }

      const finalSection = await tx.section.findUniqueOrThrow({ where: { id: newSection.id } });
      return { section: finalSection, taskCount };
    }, {
      // Statement count scales with the whole project (every top-level row is
      // re-packed); Prisma's default 5s interactive-transaction budget is too
      // tight for a large section.
      timeout: 30_000,
      maxWait: 10_000,
    });

    res.status(201).json(result);
  },
);

sectionsRouter.delete(
  "/:id",
  requirePermission("project:write"),
  validate("params", idParamSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    await ensureSectionVisible(req.user!, id);
    // Tasks in this section have sectionId set to NULL via onDelete: SetNull.
    await prisma.section.delete({ where: { id } });
    res.status(204).end();
  },
);
