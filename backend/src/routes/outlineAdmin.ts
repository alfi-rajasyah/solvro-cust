// Admin API for the Outline settings: GET/PATCH /admin/settings/outline (the
// deployment's Outline base URL plus the OAuth client the admin registered in
// Outline) and POST /admin/settings/outline/webhook-secret/rotate. Its own
// router (not folded into routes/admin.ts, a spine file), mirroring
// routes/itopAdmin.ts. Solvro holds no Outline API key or admin token: the
// OAuth client secret and webhook secret are sealed at rest and write-only
// (never returned by any route); the webhook secret is generated here and
// shown exactly once (docs/archive/plans/outline-integration.md, D2).
import crypto from "node:crypto";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth, requireAdmin } from "../http/auth.js";
import { validate } from "../http/validate.js";
import { env } from "../env.js";
import { outlineBaseUrlWarning, outlineUrlSchema } from "../lib/outlineUrl.js";
import { appUrlWarning, outlineRedirectUri, outlineWebhookUrl } from "../lib/outline/appUrl.js";
import { seal } from "../lib/secretBox.js";
import { notifyOutlineAuthChanged } from "../lib/outline/cacheHooks.js";

export const outlineAdminRouter = Router();

outlineAdminRouter.use(requireAuth, requireAdmin);

const SINGLETON = { id: "default" } as const;
const withUpdater = {
  updatedBy: { select: { id: true, username: true } },
} satisfies Prisma.OutlineConfigInclude;

async function loadConfig() {
  try {
    return await prisma.outlineConfig.upsert({
      where: SINGLETON,
      create: SINGLETON,
      update: {},
      include: withUpdater,
    });
  } catch (err) {
    // Two first-ever concurrent reads can race on the upsert; the loser re-reads.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return prisma.outlineConfig.findUniqueOrThrow({ where: SINGLETON, include: withUpdater });
    }
    throw err;
  }
}

function serialize(row: Awaited<ReturnType<typeof loadConfig>>) {
  return {
    baseUrl: row.baseUrl,
    baseUrlWarning: outlineBaseUrlWarning(row.baseUrl),
    oauthClientId: row.oauthClientId,
    // The secrets themselves never leave the server — only whether they are set.
    oauthClientSecretSet: row.oauthClientSecretEnc !== null,
    webhookSecretSet: row.webhookSecretEnc !== null,
    lastWebhookAt: row.lastWebhookAt,
    // Browser-facing URLs the admin registers in Outline. The `/api` prefix is
    // stripped by the vite proxy / nginx, so these reach the backend routes
    // /outline/oauth/callback and /webhook/outline.
    // APP_URL has no production default: null here means "not configured".
    appUrlConfigured: env.APP_URL !== null,
    appUrlWarning: appUrlWarning(env.APP_URL),
    redirectUri: env.APP_URL === null ? null : outlineRedirectUri(env.APP_URL),
    webhookUrl: env.APP_URL === null ? null : outlineWebhookUrl(env.APP_URL),
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

outlineAdminRouter.get("/", async (_req, res) => {
  res.json(serialize(await loadConfig()));
});

// The base URL is shown to every signed-in user and is the Outline origin a
// later phase allows to frame Solvro, so it is a plain address: no login,
// query string or fragment.
const baseUrlSchema = outlineUrlSchema.refine(
  (v) => {
    // Zod still runs this after the shared rule rejected the value, so
    // anything but a string has already failed — don't throw on it.
    if (typeof v !== "string") return true;
    try {
      const u = new URL(v);
      return u.username === "" && u.password === "" && u.search === "" && u.hash === "";
    } catch {
      return false;
    }
  },
  { message: "The Outline address must not contain a login, query string or fragment" },
);

// The OAuth client id Outline shows after the admin registers the application.
const oauthClientIdSchema = z
  .string()
  .nullable()
  .transform((raw, ctx) => {
    const value = raw === null ? "" : raw.trim();
    if (value === "") return null;
    // eslint-disable-next-line no-control-regex
    if (value.length > 255 || /[\u0000-\u001F\u007F]/.test(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid OAuth client id" });
      return z.NEVER;
    }
    return value;
  });

// Write-only. `null` clears it; an empty string is refused rather than read as
// "clear" so a blank form field cannot wipe a working secret by accident.
const oauthClientSecretSchema = z
  .string()
  .trim()
  .min(1, "The client secret must not be empty")
  .max(512)
  // eslint-disable-next-line no-control-regex
  .refine((v) => !/[\u0000-\u001F\u007F]/.test(v), "Invalid OAuth client secret")
  .nullable();

const updateOutlineSettingsSchema = z
  .object({
    baseUrl: baseUrlSchema.optional(),
    oauthClientId: oauthClientIdSchema.optional(),
    oauthClientSecret: oauthClientSecretSchema.optional(),
  })
  .refine(
    (v) => v.baseUrl !== undefined || v.oauthClientId !== undefined || v.oauthClientSecret !== undefined,
    { message: "Provide at least one setting to change" },
  );

// Pointing Solvro at a different Outline (baseUrl) or OAuth client would send the
// stored per-user tokens to the new server on the next call - token exfiltration
// by whoever controls the new address. So a REAL change of either (including
// to/from null) disconnects everyone in the same transaction: every user's
// Outline tokens/identity and every pending OAuth state go, and a baseUrl change
// also drops the mention index (its doc ids belong to the old Outline). A
// same-value re-save or a client-secret-only change keeps everything.
outlineAdminRouter.patch("/", validate("body", updateOutlineSettingsSchema), async (req, res) => {
  const { baseUrl, oauthClientId, oauthClientSecret } = req.body as z.infer<typeof updateOutlineSettingsSchema>;
  await loadConfig(); // make sure the singleton exists
  const row = await prisma.$transaction(async (tx) => {
    // Serialise concurrent admin saves so the comparison below sees the stored value.
    await tx.$queryRaw`SELECT 1 FROM outline_config WHERE id = 'default' FOR UPDATE`;
    const current = await tx.outlineConfig.findUniqueOrThrow({ where: SINGLETON });
    const data: Prisma.OutlineConfigUncheckedUpdateInput = {
      updatedById: req.user!.sub,
      updatedAt: new Date(),
    };
    let baseUrlChanged = false;
    let clientChanged = false;
    if (baseUrl !== undefined) {
      const next = baseUrl === null ? null : baseUrl.replace(/\/+$/, "");
      baseUrlChanged = next !== current.baseUrl;
      data.baseUrl = next;
    }
    if (oauthClientId !== undefined) {
      clientChanged = oauthClientId !== current.oauthClientId;
      data.oauthClientId = oauthClientId;
    }
    if (oauthClientSecret !== undefined) {
      data.oauthClientSecretEnc = oauthClientSecret === null ? null : seal(oauthClientSecret);
    }
    const updated = await tx.outlineConfig.update({ where: SINGLETON, data, include: withUpdater });
    if (baseUrlChanged || clientChanged) {
      await tx.user.updateMany({
        where: {
          OR: [
            { outlineAccessTokenEnc: { not: null } },
            { outlineRefreshTokenEnc: { not: null } },
            { outlineTokenExpiresAt: { not: null } },
            { outlineUserId: { not: null } },
            { outlineEmail: { not: null } },
          ],
        },
        data: {
          outlineAccessTokenEnc: null,
          outlineRefreshTokenEnc: null,
          outlineTokenExpiresAt: null,
          outlineUserId: null,
          outlineEmail: null,
        },
      });
      await tx.outlineOAuthState.deleteMany();
      if (baseUrlChanged) await tx.outlineMention.deleteMany();
    }
    return { updated, wiped: baseUrlChanged || clientChanged };
  });
  // Everyone was disconnected: forget what the Docs tree / mention-visibility caches learned under their tokens.
  if (row.wiped) notifyOutlineAuthChanged(null);
  res.json(serialize(row.updated));
});

// Generates a fresh webhook signing secret (32 random bytes, hex), stores it
// sealed and returns it ONCE — the admin pastes it into Outline's webhook form
// (Outline signs deliveries with it; without a secret it sends no signature
// header at all, so the webhook receiver refuses unsigned deliveries). Rotating
// invalidates the previous secret immediately.
outlineAdminRouter.post("/webhook-secret/rotate", async (req, res) => {
  await loadConfig();
  const secret = crypto.randomBytes(32).toString("hex");
  await prisma.outlineConfig.update({
    where: SINGLETON,
    data: { webhookSecretEnc: seal(secret), updatedById: req.user!.sub, updatedAt: new Date() },
  });
  res.set("Cache-Control", "no-store");
  res.json({ webhookSecret: secret });
});
