import { Router } from "express";
import { z } from "zod";
import { RiskCategory, RiskStatus } from "@prisma/client";
import { prisma } from "../prisma.js";
import { requireAuth, requirePermission } from "../http/auth.js";
import { HttpError } from "../http/errors.js";
import { validate } from "../http/validate.js";
import { ensureProjectVisible } from "../lib/visibility.js";
import { diffRiskChanges, recordActivity, shortLabel } from "../lib/activity.js";

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

const updateRiskSchema = z.object({
  description: z.string().min(1).max(2000).optional(),
  category: z.nativeEnum(RiskCategory).optional(),
  probability: z.number().int().min(1).max(5).optional(),
  impact: z.number().int().min(1).max(5).optional(),
  status: z.nativeEnum(RiskStatus).optional(),
  mitigationPlan: z.string().max(4000).nullable().optional(),
  contingencyPlan: z.string().max(4000).nullable().optional(),
});

export const risksRouter = Router();

risksRouter.use(requireAuth);

risksRouter.patch(
  "/:id",
  requirePermission("project:write"),
  validate("params", idParamSchema),
  validate("body", updateRiskSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const existing = await prisma.risk.findUnique({
      where: { id },
      select: { projectId: true },
    });
    if (!existing) throw new HttpError(404, "not_found", "Risk not found");
    await ensureProjectVisible(req.user!, existing.projectId);

    const updated = await prisma.$transaction(async (tx) => {
      // Lock first so a concurrent save serialises and the diff below is
      // against the row it actually replaced.
      await tx.$queryRaw`SELECT id FROM risks WHERE id = ${id} FOR NO KEY UPDATE`;
      const before = await tx.risk.findUnique({ where: { id } });
      if (!before) throw new HttpError(404, "not_found", "Risk not found");
      const result = await tx.risk.update({
        where: { id },
        data: req.body as z.infer<typeof updateRiskSchema>,
      });
      await recordActivity(tx, {
        projectId: result.projectId,
        actorId: req.user!.sub,
        entityType: "risk",
        entityId: id,
        action: "updated",
        entityLabel: shortLabel(result.description),
        changes: diffRiskChanges(before, result),
      });
      return result;
    });
    res.json(updated);
  },
);

risksRouter.delete(
  "/:id",
  requirePermission("project:write"),
  validate("params", idParamSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const existing = await prisma.risk.findUnique({
      where: { id },
      select: { projectId: true, description: true },
    });
    if (!existing) throw new HttpError(404, "not_found", "Risk not found");
    await ensureProjectVisible(req.user!, existing.projectId);

    await prisma.$transaction(async (tx) => {
      await tx.risk.delete({ where: { id } });
      await recordActivity(tx, {
        projectId: existing.projectId,
        actorId: req.user!.sub,
        entityType: "risk",
        entityId: id,
        action: "deleted",
        entityLabel: shortLabel(existing.description),
      });
    });
    res.status(204).end();
  },
);
