import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth, requirePermission, type JwtPayload } from "../http/auth.js";
import { HttpError } from "../http/errors.js";
import { validate } from "../http/validate.js";
import { ensureProjectVisible } from "../lib/visibility.js";

// Resolve the label's owning project and 404 if the caller can't see it.
// `task:write` alone doesn't scope the caller to a project, so without this any
// writer could mutate labels by guessing the id (IDOR).
async function ensureLabelVisible(user: JwtPayload, labelId: number) {
  const label = await prisma.label.findUnique({
    where: { id: labelId },
    select: { projectId: true },
  });
  if (!label) throw new HttpError(404, "not_found", "Label not found");
  await ensureProjectVisible(user, label.projectId);
}

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

const updateLabelSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

export const labelsRouter = Router();

labelsRouter.use(requireAuth);

labelsRouter.patch(
  "/:id",
  requirePermission("task:write"),
  validate("params", idParamSchema),
  validate("body", updateLabelSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    await ensureLabelVisible(req.user!, id);
    const updated = await prisma.label.update({
      where: { id },
      data: req.body as z.infer<typeof updateLabelSchema>,
    });
    res.json(updated);
  },
);

labelsRouter.delete(
  "/:id",
  requirePermission("task:write"),
  validate("params", idParamSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    await ensureLabelVisible(req.user!, id);
    await prisma.label.delete({ where: { id } });
    res.status(204).end();
  },
);
