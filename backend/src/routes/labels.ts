import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth, requirePermission, type JwtPayload } from "../http/auth.js";
import { HttpError } from "../http/errors.js";
import { isLabelNameConflict, labelExistsError } from "../lib/labelConflict.js";
import { validate } from "../http/validate.js";
import { ensureProjectVisible, projectVisibilityFilter } from "../lib/visibility.js";

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
  name: z.string().trim().min(1).max(50).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

export const labelsRouter = Router();

labelsRouter.use(requireAuth);

// Distinct label names across the projects the caller can see, for the
// cross-project Tasks filter. Grouped by lower(name); the display casing is the
// one used by the most projects (tie: alphabetical first, by code unit).
labelsRouter.get("/", requirePermission("project:read"), async (req, res) => {
  const rows = await prisma.label.findMany({
    where: { project: projectVisibilityFilter(req.user!) },
    select: { name: true, projectId: true },
  });
  const groups = new Map<string, { projects: Set<number>; casings: Map<string, Set<number>> }>();
  for (const { name, projectId } of rows) {
    const key = name.toLowerCase();
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { projects: new Set(), casings: new Map() }));
    g.projects.add(projectId);
    const c = g.casings.get(name) ?? new Set<number>();
    c.add(projectId);
    g.casings.set(name, c);
  }
  const out = [...groups.values()].map((g) => {
    const [name] = [...g.casings.entries()].sort(
      (a, b) => b[1].size - a[1].size || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
    )[0];
    return { name, projectCount: g.projects.size };
  });
  out.sort((a, b) => {
    const la = a.name.toLowerCase();
    const lb = b.name.toLowerCase();
    return la < lb ? -1 : la > lb ? 1 : 0;
  });
  res.json(out);
});

labelsRouter.patch(
  "/:id",
  requirePermission("task:write"),
  validate("params", idParamSchema),
  validate("body", updateLabelSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    await ensureLabelVisible(req.user!, id);
    try {
      const updated = await prisma.label.update({
        where: { id },
        data: req.body as z.infer<typeof updateLabelSchema>,
      });
      res.json(updated);
    } catch (e) {
      // Renaming onto a name the project already uses (unique per project).
      if (isLabelNameConflict(e)) throw labelExistsError();
      throw e;
    }
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
