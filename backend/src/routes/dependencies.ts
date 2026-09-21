import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth, requirePermission } from "../http/auth.js";
import { HttpError } from "../http/errors.js";
import { validate } from "../http/validate.js";
import { ensureProjectVisible } from "../lib/visibility.js";

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

const updateDependencySchema = z.object({
  type: z.enum(["HARD", "SOFT"]),
});

export const dependenciesRouter = Router();

dependenciesRouter.use(requireAuth);

async function loadVisibleDependency(req: Parameters<typeof requireAuth>[0], id: number) {
  const dep = await prisma.taskDependency.findUnique({
    where: { id },
    select: { id: true, projectId: true },
  });
  if (!dep) throw new HttpError(404, "not_found", "Dependency not found");
  // Reuse the shared helper for the parent-project visibility check, matching
  // every other router (404 on not-visible).
  await ensureProjectVisible(req.user!, dep.projectId);
  return dep;
}

dependenciesRouter.patch(
  "/:id",
  requirePermission("task:write"),
  validate("params", idParamSchema),
  validate("body", updateDependencySchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    await loadVisibleDependency(req, id);
    const body = req.body as z.infer<typeof updateDependencySchema>;
    const updated = await prisma.taskDependency.update({
      where: { id },
      data: { type: body.type },
    });
    res.json(updated);
  },
);

dependenciesRouter.delete(
  "/:id",
  requirePermission("task:write"),
  validate("params", idParamSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    await loadVisibleDependency(req, id);
    await prisma.taskDependency.delete({ where: { id } });
    res.status(204).end();
  },
);
