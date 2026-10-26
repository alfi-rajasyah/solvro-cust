// Outline for signed-in users (docs/archive/plans/outline-integration.md):
//  - GET  /outline/config            -> { baseUrl } (sidebar item, header buttons; no Outline API)
//  - POST /outline/oauth/start       -> { authorizeUrl } (authenticated XHR, F12)
//  - GET  /outline/oauth/callback    -> 302 to the Settings page; UNAUTHENTICATED by necessity
//  - GET|DELETE /outline/me          -> connection status / disconnect
// Admin writes live in routes/outlineAdmin.ts. Every Outline call runs under the
// acting user's own OAuth token, accepted only when Outline's `auth.info` email is
// that user's Solvro email (D2) - Solvro stores no Outline API key or admin token.
import { Router, type Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { env } from "../env.js";
import { logger } from "../logger.js";
import { requireAuth } from "../http/auth.js";
import { HttpError } from "../http/errors.js";
import { createRateLimiter } from "../http/rateLimit.js";
import { open, seal } from "../lib/secretBox.js";
import { purgeExpiredOutlineStates, OUTLINE_OAUTH_STATE_TTL_MS } from "../lib/outline/oauthState.js";
import { requireAppUrl } from "../lib/outline/requireAppUrl.js";
import {
  buildAuthorizeUrl,
  createPkcePair,
  createStateId,
  exchangeAuthorizationCode,
  loadOutlineOAuthConfig,
  OutlineGrantError,
  requireOutlineOAuthConfig,
  revokeToken,
} from "../lib/outline/oauth.js";
import { rawOutlineCall } from "../lib/outline/client.js";
import { disconnectOutlineUser, OutlineConfigChanged, storeOutlineTokens } from "../lib/outline/tokens.js";
import { OutlineApiError } from "../lib/outline/errors.js";
import { absoluteOutlineUrl } from "../lib/outline/anchor.js";
import { outlineCall } from "../lib/outline/client.js";
import { parseSearchContext } from "../lib/outline/snippet.js";
import { validate } from "../http/validate.js";

export const outlineRouter = Router();

/** At most this many unfinished connection attempts per user; older ones are dropped. */
const MAX_PENDING_STATES_PER_USER = 5;

// ---- OAuth callback (no requireAuth: F12) ----------------------------------

// The callback is hit by a top-level browser navigation that carries no Solvro
// bearer token, so it is unauthenticated: the user is identified ONLY by the
// single-use `state`. Like every unauthenticated route it
// is rate-limited per IP, never cached or indexed, and every failure is a redirect
// to the Settings page with a fixed reason code - never an echo of Outline's text.
export const outlineCallbackRateLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

type CallbackReason = "state" | "identity_mismatch" | "already_linked" | "not_configured" | "exchange" | "unavailable";

function settingsRedirect(res: Response, params: Record<string, string>): void {
  const url = new URL("/settings", requireAppUrl());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  res.redirect(302, url.toString());
}

const callbackQuerySchema = z.object({
  code: z.string().min(1).max(2048).optional(),
  state: z
    .string()
    .regex(/^[A-Za-z0-9_-]{16,128}$/)
    .optional(),
  error: z.string().max(256).optional(),
});

/** Atomically takes the state row (delete-and-return); expiry is checked on what was taken. */
async function consumeState(
  id: string,
): Promise<{ userId: number; verifierEnc: string; expiresAt: Date } | null> {
  const rows = await prisma.$queryRaw<Array<{ user_id: number; code_verifier_enc: string; expires_at: Date }>>`
    DELETE FROM outline_oauth_states WHERE id = ${id}
    RETURNING user_id, code_verifier_enc, expires_at`;
  const row = rows[0];
  return row ? { userId: row.user_id, verifierEnc: row.code_verifier_enc, expiresAt: row.expires_at } : null;
}

outlineRouter.get("/oauth/callback", outlineCallbackRateLimiter.middleware, async (req, res) => {
  res.set({
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex",
    "Referrer-Policy": "no-referrer",
  });
  // This is a top-level browser navigation: with no APP_URL there is nowhere to send the
  // user back to, and a JSON error page would be meaningless, so answer a plain 404.
  if (env.APP_URL === null) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }
  const fail = (reason: CallbackReason) => settingsRedirect(res, { outline: "error", reason });

  const parsed = callbackQuerySchema.safeParse(req.query);
  if (!parsed.success) return fail("state");
  const { code, state, error } = parsed.data;

  // Cancelled on the consent screen: Outline sends `error=access_denied` WITHOUT a
  // state (F1). Store nothing; if a state did come, still drop it.
  if (error !== undefined) {
    if (state) await consumeState(state).catch(() => null);
    if (error === "access_denied") return settingsRedirect(res, { outline: "cancelled" });
    return fail("exchange");
  }
  if (!state || !code) return fail("state");

  const taken = await consumeState(state);
  if (!taken || taken.expiresAt.getTime() <= Date.now()) return fail("state");

  const user = await prisma.user.findUnique({
    where: { id: taken.userId },
    select: { id: true, email: true, active: true },
  });
  if (!user?.active) return fail("state");

  const config = await loadOutlineOAuthConfig();
  if (!config) return fail("not_configured");

  let pair;
  try {
    pair = await exchangeAuthorizationCode(config, code, open(taken.verifierEnc));
  } catch (err) {
    if (err instanceof OutlineGrantError) return fail("exchange");
    // Outline refused Solvro's client credentials: an admin problem, not the user's.
    if (err instanceof OutlineApiError && err.kind === "not_configured") return fail("not_configured");
    if (err instanceof OutlineApiError) return fail("unavailable");
    logger.warn({ userId: user.id }, "outline code exchange failed");
    return fail("unavailable");
  }

  // D2: the token must belong to the Outline user with THIS Solvro user's email.
  let outlineUser: { id: string; email: string } | null = null;
  try {
    const info = await rawOutlineCall(config.baseUrl, pair.accessToken, "auth.info");
    const u = (info.json?.data as { user?: { id?: unknown; email?: unknown } } | undefined)?.user;
    if (info.status === 200 && typeof u?.id === "string" && typeof u.email === "string") {
      outlineUser = { id: u.id, email: u.email };
    }
  } catch {
    outlineUser = null;
  }
  if (!outlineUser) {
    await revokeToken(config, pair.refreshToken);
    return fail("unavailable");
  }
  if (outlineUser.email.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
    await revokeToken(config, pair.refreshToken);
    return fail("identity_mismatch");
  }

  // Store under the user's lock, only while the address/client the token was issued for are
  // still the configured ones (an admin change in the meantime wiped everyone and must win).
  let replacedRefresh: string | null;
  try {
    replacedRefresh = await storeOutlineTokens(
      user.id,
      { baseUrl: config.baseUrl, clientId: config.clientId },
      pair,
      { outlineUserId: outlineUser.id, outlineEmail: outlineUser.email },
    );
  } catch (err) {
    if (err instanceof OutlineConfigChanged) {
      await revokeToken(config, pair.refreshToken);
      return fail("not_configured");
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Another Solvro account already holds this Outline identity.
      await revokeToken(config, pair.refreshToken);
      return fail("already_linked");
    }
    throw err;
  }
  // A reconnect replaces an earlier grant: drop the old pair at Outline too.
  if (replacedRefresh) await revokeToken(config, replacedRefresh);
  return settingsRedirect(res, { outline: "connected" });
});

// ---- Authenticated routes --------------------------------------------------

outlineRouter.use(requireAuth);

outlineRouter.get("/config", async (_req, res) => {
  const row = await prisma.outlineConfig.findUnique({
    where: { id: "default" },
    select: { baseUrl: true },
  });
  res.json({ baseUrl: row?.baseUrl ?? null });
});

// Starts a connection: the browser cannot send the Solvro bearer to the callback
// (F12), so this authenticated XHR parks a single-use state row (random id, sealed
// PKCE verifier, 10 min) and returns Outline's authorize URL for a top-level
// navigation.
outlineRouter.post("/oauth/start", async (req, res) => {
  requireAppUrl();
  const config = await requireOutlineOAuthConfig();
  const userId = req.user!.sub;

  await purgeExpiredOutlineStates();
  // Keep at most MAX_PENDING - 1 older attempts so the new one makes MAX_PENDING.
  const stale = await prisma.outlineOAuthState.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    skip: MAX_PENDING_STATES_PER_USER - 1,
    select: { id: true },
  });
  if (stale.length > 0) {
    await prisma.outlineOAuthState.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
  }

  const { verifier, challenge } = createPkcePair();
  const state = createStateId();
  await prisma.outlineOAuthState.create({
    data: {
      id: state,
      userId,
      codeVerifierEnc: seal(verifier),
      expiresAt: new Date(Date.now() + OUTLINE_OAUTH_STATE_TTL_MS),
    },
  });
  res.set("Cache-Control", "no-store");
  res.json({ authorizeUrl: buildAuthorizeUrl(config, state, challenge) });
});

outlineRouter.get("/me", async (req, res) => {
  const [config, user] = await Promise.all([
    loadOutlineOAuthConfig(),
    prisma.user.findUniqueOrThrow({
      where: { id: req.user!.sub },
      select: { outlineAccessTokenEnc: true, outlineEmail: true, outlineTokenExpiresAt: true },
    }),
  ]);
  const connected = user.outlineAccessTokenEnc !== null;
  res.set("Cache-Control", "no-store");
  res.json({
    configured: config !== null && env.APP_URL !== null,
    connected,
    outlineEmail: connected ? user.outlineEmail : null,
    expiresAt: connected ? user.outlineTokenExpiresAt : null,
  });
});

outlineRouter.delete("/me", async (req, res) => {
  const userId = req.user!.sub;
  // Clears every local field under the user's token lock (so a refresh in flight cannot
  // undo it) and hands back the refresh token that was stored, for the revoke below.
  const refreshToken = await disconnectOutlineUser(userId);
  // Best effort at Outline (kills the access/refresh pair). A client secret that can no
  // longer be decrypted just means there is nothing to revoke with - still a clean disconnect.
  if (refreshToken) {
    const config = await loadOutlineOAuthConfig();
    if (config) await revokeToken(config, refreshToken);
  }
  res.status(204).end();
});

// ---- Templates and search (read-only; the viewer's own token) ---------------

/** The configured Outline address (no trailing slash); 409 `outline_not_configured` when unset. */
async function configuredBaseUrl(): Promise<string> {
  const row = await prisma.outlineConfig.findUnique({ where: { id: "default" }, select: { baseUrl: true } });
  if (!row?.baseUrl) {
    throw new HttpError(409, "outline_not_configured", "An administrator must set the Outline address first.");
  }
  return row.baseUrl.replace(/\/+$/, "");
}

// Workspace templates, NOT filtered by collection (F8). Only id and title leave the server.
outlineRouter.get("/templates", async (req, res) => {
  const out = await outlineCall<{ data?: Array<{ id?: unknown; title?: unknown }> }>(req.user!.sub, "templates.list", {
    limit: 100,
  });
  const templates = (Array.isArray(out.data) ? out.data : [])
    .filter((t) => typeof t?.id === "string" && typeof t.title === "string")
    .map((t) => ({ id: t.id as string, title: t.title as string }));
  res.set("Cache-Control", "no-store");
  res.json(templates);
});

const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(200),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});

// Kept apart from routes/search.ts so Solvro's own results never wait on Outline
// (sub-200 ms rule). Outline applies the user's permissions (F7); the `context`
// highlight HTML is reduced to text segments (F9) and no page text is returned.
outlineRouter.get("/search", validate("query", searchQuerySchema), async (req, res) => {
  const { q, limit } = req.query as unknown as z.infer<typeof searchQuerySchema>;
  const out = await outlineCall<{
    data?: Array<{ context?: unknown; document?: { id?: unknown; title?: unknown; url?: unknown } }>;
  }>(req.user!.sub, "documents.search", { query: q, limit });
  const baseUrl = await configuredBaseUrl();
  const results = (Array.isArray(out.data) ? out.data : []).flatMap((r) => {
    const d = r.document;
    if (typeof d?.id !== "string" || typeof d.title !== "string") return [];
    return [
      {
        id: d.id,
        title: d.title,
        url: absoluteOutlineUrl(baseUrl, d.url) ?? baseUrl,
        snippet: parseSearchContext(r.context),
      },
    ];
  });
  res.set("Cache-Control", "no-store");
  res.json(results);
});
