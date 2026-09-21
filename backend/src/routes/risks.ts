import { Router } from "express";
import { z } from "zod";
import { RiskCategory, RiskStatus } from "@prisma/client";
import { prisma } from "../prisma.js";
import { requireAuth, requirePermission } from "../http/auth.js";
import { HttpError } from "../http/errors.js";
import { validate } from "../http/validate.js";
import { ensureProjectVisible } from "../lib/visibility.js";

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

    const updated = await prisma.risk.update({
      where: { id },
      data: req.body as z.infer<typeof updateRiskSchema>,
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
      select: { projectId: true },
    });
    if (!existing) throw new HttpError(404, "not_found", "Risk not found");
    await ensureProjectVisible(req.user!, existing.projectId);

    await prisma.risk.delete({ where: { id } });
    res.status(204).end();
  },
);
