import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { env } from "../env.js";
import { requireAuth, requirePermission } from "../http/auth.js";
import { HttpError } from "../http/errors.js";
import { validate } from "../http/validate.js";
import { ensureProjectOwnerAccess } from "../lib/visibility.js";
import { seal } from "../lib/secretBox.js";
import { generateSecret } from "../lib/webhooks/sign.js";
import { generateInboundToken, inboundUrl } from "../lib/inbound/token.js";

// Management of a project's incoming webhook URLs (docs/archive/plans/webhooks.md,
// Phase 2). Owner-only, like share links: the project's TAM or the owner of a
// linked customer. The token (and so the URL) and the signing secret are
// returned once, by create, rotate-token and signing-secret, and never read
// back. Rotating the token, setting a signing secret and enabling a URL make
// the caller its author (the user future comments are written as), so one
// owner cannot take over another's URL and keep posting under that name. The unauthenticated receiver lives in routes/webhook.ts.
// Mounted on /projects next to shareLinksRouter.

const MAX_HOOKS_PER_PROJECT = 5;

const projectParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const hookParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  hookId: z.coerce.number().int().positive(),
});
const nameSchema = z.string().trim().min(1).max(80);
const createSchema = z.object({ name: nameSchema });
const updateSchema = z.object({ name: nameSchema.optional(), active: z.boolean().optional() });

const hookSelect = {
  id: true,
  name: true,
  tokenPreview: true,
  active: true,
  disabledReason: true,
  lastReceivedAt: true,
  createdAt: true,
  signingSecretEnc: true,
  createdBy: { select: { id: true, username: true } },
} as const;

type HookRow = {
  id: number;
  name: string;
  tokenPreview: string;
  active: boolean;
  disabledReason: string | null;
  lastReceivedAt: Date | null;
  createdAt: Date;
  signingSecretEnc: string | null;
  createdBy: { id: number; username: string };
};

function toDto(h: HookRow) {
  return {
    id: h.id,
    name: h.name,
    tokenPreview: h.tokenPreview,
    active: h.active,
    disabledReason: h.disabledReason,
    lastReceivedAt: h.lastReceivedAt,
    createdAt: h.createdAt,
    createdBy: { id: h.createdBy.id, name: h.createdBy.username },
    hasSigningSecret: h.signingSecretEnc !== null,
  };
}

// Visibility 404, then 403 `owner_only`, before body validation so a hidden
// project cannot be told apart from a missing one by a 400.
async function requireOwner(req: Request, _res: Response, next: NextFunction) {
  const { id } = req.params as unknown as z.infer<typeof projectParamsSchema>;
  await ensureProjectOwnerAccess(req.user!, id);
  next();
}

async function findHook(projectId: number, hookId: number) {
  const hook = await prisma.inboundHook.findFirst({ where: { id: hookId, projectId }, select: { id: true } });
  if (!hook) throw new HttpError(404, "not_found", "Incoming URL not found");
}

/** `url` is null when APP_URL is unset; the token is then returned so the UI can explain. */
function urlFields(token: string) {
  const url = inboundUrl(env.APP_URL ?? undefined, token);
  return url ? { url } : { url: null, token };
}

export const inboundHooksRouter = Router();

inboundHooksRouter.use(requireAuth);

inboundHooksRouter.get(
  "/:id/inbound-hooks",
  requirePermission("project:write"),
  validate("params", projectParamsSchema),
  requireOwner,
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof projectParamsSchema>;
    const rows = await prisma.inboundHook.findMany({
      where: { projectId: id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: hookSelect,
    });
    res.json({ hooks: rows.map(toDto) });
  },
);

inboundHooksRouter.post(
  "/:id/inbound-hooks",
  requirePermission("project:write"),
  validate("params", projectParamsSchema),
  requireOwner,
  validate("body", createSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof projectParamsSchema>;
    const { name } = req.body as z.infer<typeof createSchema>;
    const { token, hash, preview } = generateInboundToken();

    const created = await prisma.$transaction(async (tx) => {
      // Serialises one project's creates so two requests cannot both pass the limit.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7303, ${id}::int)`;
      const count = await tx.inboundHook.count({ where: { projectId: id } });
      if (count >= MAX_HOOKS_PER_PROJECT) {
        throw new HttpError(
          409,
          "inbound_hook_limit",
          `A project can have at most ${MAX_HOOKS_PER_PROJECT} incoming URLs. Delete one to add another.`,
        );
      }
      return tx.inboundHook.create({
        data: { projectId: id, createdById: req.user!.sub, name, tokenHash: hash, tokenPreview: preview },
        select: hookSelect,
      });
    });
    res.status(201).json({ hook: toDto(created), ...urlFields(token) });
  },
);

inboundHooksRouter.patch(
  "/:id/inbound-hooks/:hookId",
  requirePermission("project:write"),
  validate("params", hookParamsSchema),
  requireOwner,
  validate("body", updateSchema),
  async (req, res) => {
    const { id, hookId } = req.params as unknown as z.infer<typeof hookParamsSchema>;
    const body = req.body as z.infer<typeof updateSchema>;
    await findHook(id, hookId);
    const updated = await prisma.inboundHook.update({
      where: { id: hookId },
      data: {
        name: body.name,
        // Enabling hands the URL to the caller: a URL whose author lost access works again under a current owner.
        ...(body.active === true && { active: true, disabledReason: null, createdById: req.user!.sub }),
        ...(body.active === false && { active: false, disabledReason: null }),
      },
      select: hookSelect,
    });
    res.json({ hook: toDto(updated) });
  },
);

inboundHooksRouter.delete(
  "/:id/inbound-hooks/:hookId",
  requirePermission("project:write"),
  validate("params", hookParamsSchema),
  requireOwner,
  async (req, res) => {
    const { id, hookId } = req.params as unknown as z.infer<typeof hookParamsSchema>;
    await findHook(id, hookId);
    await prisma.inboundHook.delete({ where: { id: hookId } });
    res.status(204).end();
  },
);

inboundHooksRouter.post(
  "/:id/inbound-hooks/:hookId/rotate-token",
  requirePermission("project:write"),
  validate("params", hookParamsSchema),
  requireOwner,
  async (req, res) => {
    const { id, hookId } = req.params as unknown as z.infer<typeof hookParamsSchema>;
    await findHook(id, hookId);
    const { token, hash, preview } = generateInboundToken();
    const updated = await prisma.inboundHook.update({
      where: { id: hookId },
      data: { tokenHash: hash, tokenPreview: preview, createdById: req.user!.sub },
      select: hookSelect,
    });
    res.json({ hook: toDto(updated), ...urlFields(token) });
  },
);

inboundHooksRouter.post(
  "/:id/inbound-hooks/:hookId/signing-secret",
  requirePermission("project:write"),
  validate("params", hookParamsSchema),
  requireOwner,
  async (req, res) => {
    const { id, hookId } = req.params as unknown as z.infer<typeof hookParamsSchema>;
    await findHook(id, hookId);
    const secret = generateSecret();
    const updated = await prisma.inboundHook.update({
      where: { id: hookId },
      data: { signingSecretEnc: seal(secret), createdById: req.user!.sub },
      select: hookSelect,
    });
    res.json({ hook: toDto(updated), secret });
  },
);

inboundHooksRouter.delete(
  "/:id/inbound-hooks/:hookId/signing-secret",
  requirePermission("project:write"),
  validate("params", hookParamsSchema),
  requireOwner,
  async (req, res) => {
    const { id, hookId } = req.params as unknown as z.infer<typeof hookParamsSchema>;
    await findHook(id, hookId);
    const updated = await prisma.inboundHook.update({
      where: { id: hookId },
      data: { signingSecretEnc: null },
      select: hookSelect,
    });
    res.json({ hook: toDto(updated) });
  },
);
