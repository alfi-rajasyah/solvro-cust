import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth, requirePermission } from "../http/auth.js";
import { validate } from "../http/validate.js";
import { ensureProjectVisible } from "../lib/visibility.js";
import { activityEventInclude, toActivityEventDto } from "../lib/activity.js";

// Project activity feed (docs/archive/plans/collaboration-and-sharing.md, C5a). Events
// are written by lib/activity.ts#recordActivity inside each write's own
// transaction; this router only reads them. Mounted on /projects next to
// projectsRouter (kept out of that file).

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.coerce.number().int().positive().optional(),
  actorId: z.coerce.number().int().positive().optional(),
});

export const activityRouter = Router();

activityRouter.use(requireAuth);

activityRouter.get(
  "/:id/activity",
  requirePermission("project:read"),
  validate("params", paramsSchema),
  validate("query", querySchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof paramsSchema>;
    const { limit, before, actorId } = req.query as unknown as z.infer<typeof querySchema>;
    await ensureProjectVisible(req.user!, id);

    // Newest first, ordered by id (not createdAt); `before` is the id of the
    // last event of the previous page. One extra row tells whether more remain.
    const rows = await prisma.activityEvent.findMany({
      where: {
        projectId: id,
        ...(before !== undefined && { id: { lt: before } }),
        ...(actorId !== undefined && { actorId }),
      },
      orderBy: { id: "desc" },
      take: limit + 1,
      include: activityEventInclude,
    });
    const page = rows.slice(0, limit);
    res.json({
      events: page.map(toActivityEventDto),
      nextBefore: rows.length > limit ? page[page.length - 1]!.id : null,
    });
  },
);
