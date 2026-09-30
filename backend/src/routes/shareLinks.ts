import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth, requirePermission } from "../http/auth.js";
import { HttpError } from "../http/errors.js";
import { validate } from "../http/validate.js";
import { ensureProjectOwnerAccess } from "../lib/visibility.js";
import { recordActivity } from "../lib/activity.js";
import {
  SHARE_DEFAULT_EXPIRY_DAYS,
  SHARE_LABEL_MAX,
  SHARE_MAX_EXPIRY_DAYS,
  generateShareToken,
  hashShareToken,
} from "../lib/shareLinks.js";

// Owner-side management of guest links (docs/archive/plans/collaboration-and-sharing.md,
// L4). Only owners (the project's TAM, the customer owner, `project:view-all`
// users) can create, list or revoke — membership alone cannot share a project
// externally. The token itself is returned only by POST; it is never stored.
// Mounted on /projects next to projectMembersRouter. The unauthenticated
// counterpart lives in routes/publicShare.ts.

const projectParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const linkParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  linkId: z.coerce.number().int().positive(),
});
const createSchema = z.object({
  label: z
    .string()
    .trim()
    .max(SHARE_LABEL_MAX)
    .nullish()
    .transform((v) => (v ? v : null)),
  expiresInDays: z
    .number()
    .int()
    .min(1)
    .max(SHARE_MAX_EXPIRY_DAYS)
    .default(SHARE_DEFAULT_EXPIRY_DAYS),
});

// Visibility 404, then 403 `owner_only`, before any body validation so a hidden
// project cannot be told apart from a missing one by a 400.
async function requireOwner(req: Request, _res: Response, next: NextFunction) {
  const { id } = req.params as unknown as z.infer<typeof projectParamsSchema>;
  await ensureProjectOwnerAccess(req.user!, id);
  next();
}

export const shareLinksRouter = Router();

shareLinksRouter.use(requireAuth);

shareLinksRouter.post(
  "/:id/share-links",
  requirePermission("project:write"),
  validate("params", projectParamsSchema),
  requireOwner,
  validate("body", createSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof projectParamsSchema>;
    const { label, expiresInDays } = req.body as z.infer<typeof createSchema>;

    const token = generateShareToken();
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    const link = await prisma.$transaction(async (tx) => {
      const created = await tx.shareLink.create({
        data: {
          projectId: id,
          tokenHash: hashShareToken(token),
          label,
          createdById: req.user!.sub,
          expiresAt,
        },
        select: { id: true, label: true, expiresAt: true, createdAt: true },
      });
      // The event carries the label only — never the token or its hash.
      await recordActivity(tx, {
        projectId: id,
        actorId: req.user!.sub,
        entityType: "share_link",
        entityId: created.id,
        action: "created",
        entityLabel: label,
      });
      return created;
    });

    // Relative on purpose: the backend has no public-base-URL setting, so the
    // client prefixes window.location.origin. Returned only here.
    res.status(201).json({ ...link, url: `/share/${token}` });
  },
);

shareLinksRouter.get(
  "/:id/share-links",
  requirePermission("project:read"),
  validate("params", projectParamsSchema),
  requireOwner,
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof projectParamsSchema>;
    const links = await prisma.shareLink.findMany({
      where: { projectId: id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        label: true,
        createdAt: true,
        expiresAt: true,
        revokedAt: true,
        lastUsedAt: true,
        createdBy: { select: { id: true, username: true } },
      },
    });
    res.json(links);
  },
);

shareLinksRouter.delete(
  "/:id/share-links/:linkId",
  requirePermission("project:write"),
  validate("params", linkParamsSchema),
  requireOwner,
  async (req, res) => {
    const { id, linkId } = req.params as unknown as z.infer<typeof linkParamsSchema>;
    const link = await prisma.shareLink.findFirst({
      where: { id: linkId, projectId: id },
      select: { id: true, label: true },
    });
    if (!link) throw new HttpError(404, "not_found", "Share link not found");

    // Idempotent: only the call that actually revokes records an event.
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.shareLink.updateMany({
        where: { id: linkId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (count === 1) {
        await recordActivity(tx, {
          projectId: id,
          actorId: req.user!.sub,
          entityType: "share_link",
          entityId: linkId,
          action: "removed",
          entityLabel: link.label,
        });
      }
    });
    res.status(204).end();
  },
);
