import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { requireAuth, type JwtPayload } from "../http/auth.js";
import { HttpError } from "../http/errors.js";
import { validate } from "../http/validate.js";
import { projectVisibilityFilter } from "../lib/visibility.js";
import { activityEventInclude, toActivityEventDto } from "../lib/activity.js";

// In-app notifications (docs/archive/plans/collaboration-and-sharing.md, C5b).
// Rows are created by lib/notifications.ts inside the triggering write's
// transaction; this router only reads and marks them. A caller only ever
// touches their own rows, and a row whose project they can no longer see is
// hidden from the list and the unread count.

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  before: z.coerce.number().int().positive().optional(),
});
const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

/** The caller's own notifications on projects they can currently see. */
function visibleOwn(user: JwtPayload): Prisma.NotificationWhereInput {
  return {
    userId: user.sub,
    activityEvent: { project: projectVisibilityFilter(user) },
  };
}

notificationsRouter.get("/", validate("query", listQuerySchema), async (req, res) => {
  const { limit, before } = req.query as unknown as z.infer<typeof listQuerySchema>;
  // Newest first by id; `before` is the id of the last row of the previous page.
  const rows = await prisma.notification.findMany({
    where: { ...visibleOwn(req.user!), ...(before !== undefined && { id: { lt: before } }) },
    orderBy: { id: "desc" },
    take: limit + 1,
    include: {
      activityEvent: {
        include: { ...activityEventInclude, project: { select: { id: true, name: true } } },
      },
    },
  });
  const page = rows.slice(0, limit);
  res.json({
    notifications: page.map((n) => ({
      id: n.id,
      reason: n.reason,
      readAt: n.readAt,
      createdAt: n.createdAt,
      event: toActivityEventDto(n.activityEvent),
      projectId: n.activityEvent.project.id,
      projectName: n.activityEvent.project.name,
    })),
    nextBefore: rows.length > limit ? page[page.length - 1]!.id : null,
  });
});

notificationsRouter.get("/unread-count", async (req, res) => {
  const count = await prisma.notification.count({
    where: { ...visibleOwn(req.user!), readAt: null },
  });
  res.json({ count });
});

notificationsRouter.post("/read-all", async (req, res) => {
  const { count } = await prisma.notification.updateMany({
    where: { userId: req.user!.sub, readAt: null },
    data: { readAt: new Date() },
  });
  res.json({ updated: count });
});

notificationsRouter.post("/:id/read", validate("params", idParamSchema), async (req, res) => {
  const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
  // Someone else's row is a 404, like every id-keyed route. Re-reading an
  // already-read row keeps its original readAt.
  const existing = await prisma.notification.findFirst({
    where: { id, userId: req.user!.sub },
    select: { readAt: true },
  });
  if (!existing) throw new HttpError(404, "not_found", "Notification not found");
  const readAt = existing.readAt ?? new Date();
  if (!existing.readAt) {
    await prisma.notification.updateMany({
      where: { id, userId: req.user!.sub, readAt: null },
      data: { readAt },
    });
  }
  res.json({ id, readAt });
});
