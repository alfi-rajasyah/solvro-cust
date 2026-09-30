import { Router, type ErrorRequestHandler } from "express";
import { HttpError } from "../http/errors.js";
import { createRateLimiter } from "../http/rateLimit.js";
import {
  SHARE_TOKEN_FORMAT,
  buildPublicSharePayload,
  findActiveShareLink,
  touchShareLink,
} from "../lib/shareLinks.js";

// Public guest view of a project timeline (docs/archive/plans/collaboration-and-sharing.md,
// L4). UNAUTHENTICATED by design: never add requireAuth here, and mount it
// outside every authed router (app.ts mounts it at /public/share). The payload
// is an allow-list — see lib/shareLinks.ts for the privacy invariant.

export const PUBLIC_SHARE_RATE_LIMIT = 60;
export const PUBLIC_SHARE_RATE_WINDOW_MS = 60_000;

export const publicShareRateLimiter = createRateLimiter({
  limit: PUBLIC_SHARE_RATE_LIMIT,
  windowMs: PUBLIC_SHARE_RATE_WINDOW_MS,
});

const notAvailable = () =>
  new HttpError(404, "not_found", "This link has expired or is no longer available");

export const publicShareRouter = Router();

// Every response from this router — payload, 404, 429 — is uncacheable and
// unindexable.
publicShareRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  next();
});
publicShareRouter.use(publicShareRateLimiter.middleware);

publicShareRouter.get("/:token", async (req, res) => {
  const token = String(req.params.token ?? "");
  const now = new Date();
  // Unknown, expired, revoked and malformed tokens are indistinguishable. A
  // token that cannot be one of ours never reaches the database.
  const link = SHARE_TOKEN_FORMAT.test(token) ? await findActiveShareLink(token, now) : null;
  if (!link) throw notAvailable();

  const payload = await buildPublicSharePayload(link.projectId, now);
  if (!payload) throw notAvailable();
  await touchShareLink(link.id, now);
  res.json(payload);
});

// A malformed percent-escape in the path (`/public/share/%E0%A4%A`) makes
// Express raise a 400 URIError while decoding the param. To a guest that is
// just another bad link: same uniform 404, headers above already set. Anything
// else falls through to the global error handler.
const publicShareErrors: ErrorRequestHandler = (err, _req, res, next) => {
  const status = (err as { status?: number; statusCode?: number })?.status;
  if (status === 400) {
    const e = notAvailable();
    res.status(e.status).json({ error: e.message, code: e.code, details: undefined });
    return;
  }
  next(err);
};
publicShareRouter.use(publicShareErrors);
