import { Router } from "express";
import { z } from "zod";
import type { WebhookDelivery, WebhookSubscription } from "@prisma/client";
import { prisma } from "../prisma.js";
import { requireAuth, requirePermission, type JwtPayload } from "../http/auth.js";
import { HttpError } from "../http/errors.js";
import { validate } from "../http/validate.js";
import { projectVisibilityFilter } from "../lib/visibility.js";
import { seal } from "../lib/secretBox.js";
import { WEBHOOK_EVENT_TYPES } from "../lib/webhooks/eventTypes.js";
import { buildTestPayload } from "../lib/webhooks/payload.js";
import { prepareRequest, sendRequest } from "../lib/webhooks/sender.js";
import { generateSecret } from "../lib/webhooks/sign.js";
import { assertWebhookTarget } from "../lib/webhooks/validateTarget.js";

// Outgoing webhooks (docs/archive/plans/webhooks.md): a user manages their own
// target URLs. Every route is owner-only (another user's id answers 404), and
// no response other than create and rotate-secret ever carries the secret.

const MAX_WEBHOOKS_PER_USER = 10;

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });
const nameSchema = z.string().trim().min(1).max(80);
const urlSchema = z.string().trim().min(1).max(2048);
const eventTypesSchema = z
  .array(z.enum(WEBHOOK_EVENT_TYPES))
  .min(1)
  .refine((list) => new Set(list).size === list.length, "eventTypes must not repeat");
const projectIdsSchema = z.array(z.number().int().positive()).max(50);

const createSchema = z.object({
  name: nameSchema,
  url: urlSchema,
  format: z.enum(["STANDARD", "GOOGLE_CHAT"]),
  eventTypes: eventTypesSchema,
  projectIds: projectIdsSchema.default([]),
});

const updateSchema = z.object({
  name: nameSchema.optional(),
  url: urlSchema.optional(),
  // Accepted only so a different value can answer `format_immutable`.
  format: z.string().optional(),
  eventTypes: eventTypesSchema.optional(),
  projectIds: projectIdsSchema.optional(),
  active: z.boolean().optional(),
});

type WebhookWithLast = WebhookSubscription & { deliveries: WebhookDelivery[] };

function toDto(w: WebhookWithLast) {
  const last = w.deliveries[0];
  return {
    id: w.id,
    name: w.name,
    url: w.url,
    format: w.format,
    eventTypes: w.eventTypes,
    projectIds: w.projectIds,
    active: w.active,
    disabledReason: w.disabledReason,
    consecutiveFailures: w.consecutiveFailures,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
    lastDelivery: last
      ? {
          status: last.status,
          statusCode: last.lastStatusCode,
          // A finished delivery keeps its finish time in nextAttemptAt.
          at: last.status === "PENDING" ? last.createdAt : last.nextAttemptAt,
        }
      : null,
  };
}

const withLast = { deliveries: { orderBy: { id: "desc" as const }, take: 1 } };

async function ownWebhook(userId: number, id: number) {
  const webhook = await prisma.webhookSubscription.findFirst({ where: { id, ownerId: userId }, include: withLast });
  if (!webhook) throw new HttpError(404, "webhook_not_found", "Webhook not found");
  return webhook;
}

async function assertProjectsVisible(user: JwtPayload | undefined, projectIds: number[]): Promise<number[]> {
  const unique = [...new Set(projectIds)];
  if (unique.length === 0) return unique;
  const count = await prisma.project.count({ where: { id: { in: unique }, ...projectVisibilityFilter(user!) } });
  if (count !== unique.length) throw new HttpError(400, "project_not_found", "A project in projectIds does not exist or is not visible to you");
  return unique;
}

export const webhooksRouter = Router();

webhooksRouter.use(requireAuth);
webhooksRouter.use(requirePermission("webhook:manage"));

webhooksRouter.get("/", async (req, res) => {
  const rows = await prisma.webhookSubscription.findMany({
    where: { ownerId: req.user!.sub },
    orderBy: { id: "desc" },
    include: withLast,
  });
  res.json({ webhooks: rows.map(toDto) });
});

webhooksRouter.post("/", validate("body", createSchema), async (req, res) => {
  const body = req.body as z.infer<typeof createSchema>;
  const userId = req.user!.sub;
  await assertWebhookTarget(body.url);
  const projectIds = await assertProjectsVisible(req.user, body.projectIds);
  const secret = body.format === "STANDARD" ? generateSecret() : null;

  const created = await prisma.$transaction(async (tx) => {
    // Serialises one user's creates so two requests cannot both pass the limit.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(7302, ${userId}::int)`;
    const count = await tx.webhookSubscription.count({ where: { ownerId: userId } });
    if (count >= MAX_WEBHOOKS_PER_USER) {
      throw new HttpError(409, "webhook_limit", `You can have at most ${MAX_WEBHOOKS_PER_USER} webhooks`);
    }
    return tx.webhookSubscription.create({
      data: {
        ownerId: userId,
        name: body.name,
        url: body.url,
        format: body.format,
        secretEnc: secret ? seal(secret) : null,
        eventTypes: body.eventTypes,
        projectIds,
      },
      include: withLast,
    });
  });
  res.status(201).json({ webhook: toDto(created), secret });
});

webhooksRouter.patch("/:id", validate("params", idParamSchema), validate("body", updateSchema), async (req, res) => {
  const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
  const body = req.body as z.infer<typeof updateSchema>;
  const current = await ownWebhook(req.user!.sub, id);
  if (body.format !== undefined && body.format !== current.format) {
    throw new HttpError(400, "format_immutable", "A webhook's format cannot be changed; create a new webhook instead");
  }
  if (body.url !== undefined && body.url !== current.url) await assertWebhookTarget(body.url);
  const projectIds = body.projectIds ? await assertProjectsVisible(req.user, body.projectIds) : undefined;

  const updated = await prisma.webhookSubscription.update({
    where: { id },
    data: {
      name: body.name,
      url: body.url,
      eventTypes: body.eventTypes,
      projectIds,
      ...(body.active === true && { active: true, consecutiveFailures: 0, disabledReason: null }),
      ...(body.active === false && { active: false, disabledReason: null }),
    },
    include: withLast,
  });
  res.json({ webhook: toDto(updated) });
});

webhooksRouter.delete("/:id", validate("params", idParamSchema), async (req, res) => {
  const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
  await ownWebhook(req.user!.sub, id);
  await prisma.webhookSubscription.delete({ where: { id } });
  res.status(204).end();
});

webhooksRouter.post("/:id/rotate-secret", validate("params", idParamSchema), async (req, res) => {
  const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
  const current = await ownWebhook(req.user!.sub, id);
  if (current.format !== "STANDARD") {
    throw new HttpError(400, "no_secret", "This webhook format is not signed, so it has no secret");
  }
  const secret = generateSecret();
  await prisma.webhookSubscription.update({ where: { id }, data: { secretEnc: seal(secret) } });
  res.json({ secret });
});

webhooksRouter.post("/:id/test", validate("params", idParamSchema), async (req, res) => {
  const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
  const current = await ownWebhook(req.user!.sub, id);
  const payload = buildTestPayload(current);
  let request;
  try {
    request = prepareRequest(current, `test_${Date.now()}`, payload);
  } catch {
    res.json({ ok: false, statusCode: null, error: "secret_unreadable" });
    return;
  }
  const result = await sendRequest(current.url, request);
  res.json({ ok: result.ok, statusCode: result.statusCode, error: result.error });
});

webhooksRouter.get("/:id/deliveries", validate("params", idParamSchema), async (req, res) => {
  const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
  await ownWebhook(req.user!.sub, id);
  const rows = await prisma.webhookDelivery.findMany({
    where: { subscriptionId: id },
    orderBy: { id: "desc" },
    take: 50,
  });
  res.json({
    deliveries: rows.map((d) => ({
      id: d.id,
      eventType: d.eventType,
      status: d.status,
      attempts: d.attempts,
      lastStatusCode: d.lastStatusCode,
      lastError: d.lastError,
      createdAt: d.createdAt,
      nextAttemptAt: d.status === "PENDING" ? d.nextAttemptAt : null,
    })),
  });
});
