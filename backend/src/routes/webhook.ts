// The iTop webhook nudge: POST /webhook/itop, the first unauthenticated
// non-health route in this app (mounted at /webhook in src/app.ts, BEFORE
// the global express.json() parser — this route ignores the request body
// entirely, so a malformed body must never 400 before the secret check
// below runs). iTop's "on ticket update" trigger calls this with no
// meaningful payload; it exists only to nudge the scheduler into an
// immediate incremental pull instead of waiting for the next tick. Carries
// no trust in anything iTop sends beyond the shared secret header — see
// docs/archive/plans/itop-integration.md §2 deviation 6 and Task 4.1.
import express, { Router } from "express";
import crypto from "node:crypto";
import { logger } from "../logger.js";
import { HttpError } from "../http/errors.js";
import { createRateLimiter } from "../http/rateLimit.js";
import { getItopConfig } from "../lib/itop/config.js";
import { open, SecretBoxError } from "../lib/secretBox.js";
import { requestSync } from "../lib/itop/scheduler.js";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { env } from "../env.js";
import { verifyOutlineSignature } from "../lib/outline/webhookSignature.js";
import { clampTitle, deleteDocMentions, syncDocMentions, toRelativeDocPath } from "../lib/outline/mentions.js";

export const webhookRouter = Router();

const WEBHOOK_SECRET_HEADER = "X-Solvro-Webhook-Secret";
const RATE_LIMIT_MAX_ACCEPTED = 6;
const RATE_LIMIT_MAX_ALL_CALLS = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;
const REJECTION_WARN_INTERVAL_MS = 60_000;

// Module-level sliding window of *accepted* (secret-verified) call
// timestamps — a call rejected for a bad/missing secret never counts
// against this budget, only a call that would otherwise trigger a sync.
let acceptedAt: number[] = [];

// A second, much wider sliding window over EVERY call to this route
// (accepted or not) — checked first, before the config read and the AES
// decrypt below, so a flood of bad-secret calls can't spend a DB read + a
// decrypt on each one indefinitely. 10x the accepted budget: generous
// enough that a legitimate burst of correct calls never trips it (that's
// RATE_LIMIT_MAX_ACCEPTED's job), tight enough to cap the unauthenticated
// cost of a flood.
let allCallsAt: number[] = [];

// Rejected (bad/missing-secret) calls are warn-logged, but a flood must not
// flood the logs either — at most one warn line per REJECTION_WARN_INTERVAL_MS,
// folding in how many rejections it represents.
let lastRejectionWarnAt = 0;
let rejectionsSinceLastWarn = 0;

// Test-only: counts actual logger.warn calls made by warnRejectedSecret()
// below. Pino's level methods aren't reliably interceptable with
// vi.spyOn(logger, "warn") (they're resolved off the instance's prototype at
// call time, not a plain own-property function), so this is the "expose a
// counter" fallback the coalescing behavior is verified against instead.
let rejectionWarnCallsForTests = 0;

/** Test-only: clears every sliding window/counter between test cases sharing this module. */
export function resetItopWebhookRateLimitForTests(): void {
  acceptedAt = [];
  allCallsAt = [];
  lastRejectionWarnAt = 0;
  rejectionsSinceLastWarn = 0;
  rejectionWarnCallsForTests = 0;
}

/** Test-only: how many times warnRejectedSecret() actually called logger.warn() since the last reset. */
export function getItopWebhookRejectionWarnCallsForTests(): number {
  return rejectionWarnCallsForTests;
}

function warnRejectedSecret(): void {
  const now = Date.now();
  if (now - lastRejectionWarnAt >= REJECTION_WARN_INTERVAL_MS) {
    const total = rejectionsSinceLastWarn + 1;
    logger.warn(
      total > 1
        ? `iTop webhook: rejected ${total} calls with an invalid secret in the last ${REJECTION_WARN_INTERVAL_MS / 1000}s`
        : "iTop webhook: rejected a call with an invalid secret",
    );
    rejectionWarnCallsForTests += 1;
    lastRejectionWarnAt = now;
    rejectionsSinceLastWarn = 0;
  } else {
    rejectionsSinceLastWarn += 1;
  }
}

webhookRouter.post("/itop", async (req, res) => {
  // Cheapest check first, before any config read or decrypt: a flood (bad
  // secret or otherwise) is capped well ahead of the accepted-call budget.
  const now = Date.now();
  allCallsAt = allCallsAt.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (allCallsAt.length >= RATE_LIMIT_MAX_ALL_CALLS) {
    throw new HttpError(429, "rate_limited", "Too many webhook calls");
  }
  allCallsAt.push(now);

  const config = await getItopConfig();

  // No secret configured yet — 404, not 401: an unauthenticated scanner
  // must not be able to tell this route exists at all.
  if (!config.webhookSecretEnc) {
    throw new HttpError(404, "not_found", "Not found");
  }

  let expected: string;
  try {
    expected = open(config.webhookSecretEnc);
  } catch (err) {
    // A corrupted/undecryptable stored secret (e.g. SECRETS_KEY rotated) can
    // never be matched by any header value — fail the same way as "unset"
    // rather than surfacing a 500 or revealing why.
    if (err instanceof SecretBoxError) {
      logger.warn("iTop webhook: stored secret could not be decrypted (SECRETS_KEY rotated?)");
      throw new HttpError(404, "not_found", "Not found");
    }
    throw err;
  }

  // Never log the header value itself, matching or not.
  const provided = req.get(WEBHOOK_SECRET_HEADER) ?? "";
  const providedBuf = Buffer.from(provided, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");

  if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    warnRejectedSecret();
    throw new HttpError(401, "unauthorized", "Invalid webhook secret");
  }

  const acceptedNow = Date.now();
  acceptedAt = acceptedAt.filter((t) => acceptedNow - t < RATE_LIMIT_WINDOW_MS);
  if (acceptedAt.length >= RATE_LIMIT_MAX_ACCEPTED) {
    throw new HttpError(429, "rate_limited", "Too many webhook calls");
  }
  acceptedAt.push(acceptedNow);

  logger.info("iTop webhook: accepted call, requesting sync");
  // Debounced nudge, not an inline sync — see lib/itop/scheduler.ts#requestSync.
  // The request body is never parsed or trusted; a full pull still happens
  // on its own schedule / manual Refresh.
  requestSync({ full: false });
  res.status(202).json({ accepted: true });
});

// ---------------------------------------------------------------------------
// POST /webhook/outline - Outline's webhook (docs/archive/plans/outline-integration.md,
// D4 / F10 / B5). Same rules as the iTop nudge above (unauthenticated, mounted
// before express.json(), two sliding rate-limit windows, coalesced rejection
// warns), plus:
//  - the body is read RAW (express.raw) because the HMAC covers the exact bytes;
//  - it carries the full markdown of the page (`model.text`), so the body is never
//    logged and never stored: links are extracted in memory (D4);
//  - Outline gives a delivery 5 s and never retries, so the handler only verifies,
//    parses, extracts and writes - no Outline API call in the request path.
// ---------------------------------------------------------------------------

const OUTLINE_SIGNATURE_HEADER = "Outline-Signature";
// Far wider than the iTop nudge: Outline fires on every page edit (~4 s after
// typing, F10) and never retries, so a dropped delivery is a lost update. These
// only cap the cost of a flood.
const OUTLINE_MAX_ALL_CALLS = 300;
const OUTLINE_MAX_ACCEPTED = 120;

// Pre-auth window over EVERY call, keyed per client IP (rateLimitKey: IPv6 as /56)
// so one noisy or hostile client cannot spend the budget real Outline deliveries
// need. The accepted window below stays GLOBAL: only a holder of the webhook secret
// gets past the signature check, so it bounds the DB-write cost of genuine traffic
// no matter how many addresses it arrives from.
const outlineAllCallsLimiter = createRateLimiter({
  limit: OUTLINE_MAX_ALL_CALLS,
  windowMs: RATE_LIMIT_WINDOW_MS,
});
let outlineAcceptedAt: number[] = [];
let outlineLastWarnAt = 0;
let outlineWarnsSuppressed = 0;
let outlineWarnCallsForTests = 0;
let outlineAppUrlWarned = false;

/** Test-only: clears the Outline webhook's windows and warn coalescing. */
export function resetOutlineWebhookStateForTests(): void {
  outlineAllCallsLimiter.reset();
  outlineAcceptedAt = [];
  outlineLastWarnAt = 0;
  outlineWarnsSuppressed = 0;
  outlineWarnCallsForTests = 0;
  outlineAppUrlWarned = false;
}

/** Test-only: how many warn lines the Outline webhook actually emitted since the last reset. */
export function getOutlineWebhookWarnCallsForTests(): number {
  return outlineWarnCallsForTests;
}

// One warn line per interval for any rejection, folding in how many it covers.
// Never carries the body, the signature or the secret.
function warnOutlineRejected(reason: string): void {
  const now = Date.now();
  if (now - outlineLastWarnAt >= REJECTION_WARN_INTERVAL_MS) {
    const total = outlineWarnsSuppressed + 1;
    logger.warn(
      total > 1
        ? `Outline webhook: rejected ${total} calls in the last ${REJECTION_WARN_INTERVAL_MS / 1000}s (latest: ${reason})`
        : `Outline webhook: rejected a call (${reason})`,
    );
    outlineWarnCallsForTests += 1;
    outlineLastWarnAt = now;
    outlineWarnsSuppressed = 0;
  } else {
    outlineWarnsSuppressed += 1;
  }
}


// Events that put a page's mentions back in line with its current text, and
// those that remove them. Anything else is acknowledged and ignored.
const OUTLINE_SYNC_EVENTS = new Set([
  "documents.publish",
  "documents.update",
  "documents.title_change",
  "documents.create",
  "documents.unarchive",
]);
const OUTLINE_REMOVE_EVENTS = new Set(["documents.delete", "documents.archive", "documents.unpublish"]);

const outlineDeliverySchema = z.object({
  event: z.string().max(100),
  payload: z
    .object({
      id: z.string().max(200).optional(),
      model: z
        .object({
          id: z.string().max(200).optional(),
          urlId: z.string().max(200).nullish(),
          title: z.string().nullish(),
          text: z.string().nullish(),
          url: z.string().nullish(),
          publishedAt: z.string().nullish(),
          archivedAt: z.string().nullish(),
          deletedAt: z.string().nullish(),
        })
        .partial()
        .optional(),
    })
    .optional(),
});

webhookRouter.post(
  "/outline",
  outlineAllCallsLimiter.middleware,
  express.raw({ type: "*/*", limit: "2mb" }),
  async (req, res) => {
    // Outline sends no signature header at all when the subscription has no secret (F10).
    const signature = req.get(OUTLINE_SIGNATURE_HEADER);
    if (!signature) {
      warnOutlineRejected("no signature header");
      throw new HttpError(401, "unauthorized", "Invalid webhook signature");
    }

    const config = await prisma.outlineConfig.findUnique({
      where: { id: "default" },
      select: { webhookSecretEnc: true },
    });
    if (!config?.webhookSecretEnc) {
      warnOutlineRejected("no webhook secret configured");
      throw new HttpError(401, "unauthorized", "Invalid webhook signature");
    }
    let secret: string;
    try {
      secret = open(config.webhookSecretEnc);
    } catch (err) {
      if (err instanceof SecretBoxError) {
        warnOutlineRejected("stored secret could not be decrypted (SECRETS_KEY rotated?)");
        throw new HttpError(401, "unauthorized", "Invalid webhook signature");
      }
      throw err;
    }

    // express.raw leaves `{}` when no body was sent; that can never verify.
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const verdict = verifyOutlineSignature(signature, rawBody, secret);
    if (verdict !== "ok") {
      warnOutlineRejected(`signature ${verdict}`);
      throw new HttpError(401, "unauthorized", "Invalid webhook signature");
    }

    const acceptedNow = Date.now();
    outlineAcceptedAt = outlineAcceptedAt.filter((t) => acceptedNow - t < RATE_LIMIT_WINDOW_MS);
    if (outlineAcceptedAt.length >= OUTLINE_MAX_ACCEPTED) {
      warnOutlineRejected("accepted-call rate limit");
      throw new HttpError(429, "rate_limited", "Too many webhook calls");
    }
    outlineAcceptedAt.push(acceptedNow);

    // The delivery is authentic: record it for the Admin "last delivery" line.
    // Targeted update - must not move the admin audit stamp (updatedAt / updatedById).
    await prisma.outlineConfig.updateMany({
      where: { id: "default" },
      data: { lastWebhookAt: new Date() },
    });

    // Never echo or log the parse error: Node quotes a slice of the body in it.
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBody.toString("utf8"));
    } catch {
      throw new HttpError(400, "invalid_json", "Webhook body is not valid JSON");
    }
    const parsed = outlineDeliverySchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new HttpError(400, "invalid_payload", "Unexpected webhook payload");
    }
    const { event, payload } = parsed.data;
    const model = payload?.model;
    const docId = model?.id ?? payload?.id;

    if (!docId || (!OUTLINE_SYNC_EVENTS.has(event) && !OUTLINE_REMOVE_EVENTS.has(event))) {
      res.status(200).json({ accepted: true });
      return;
    }

    if (OUTLINE_REMOVE_EVENTS.has(event)) {
      await deleteDocMentions(docId);
    } else if (model?.deletedAt || model?.archivedAt || model?.publishedAt === null) {
      // Trashed, archived or (still / again) a draft: not a page anyone links to.
      await deleteDocMentions(docId);
    } else if (env.APP_URL === null) {
      // No Solvro origin to recognise links against: take the delivery, skip extraction.
      if (!outlineAppUrlWarned) {
        outlineAppUrlWarned = true;
        logger.warn("Outline webhook: APP_URL is not set, so Solvro links in Outline pages are not recorded");
      }
    } else {
      await syncDocMentions(
        {
          docId,
          title: clampTitle(model?.title),
          docPath: toRelativeDocPath(model?.url, model?.urlId ?? docId),
          text: model?.text ?? "",
        },
        env.APP_URL,
      );
    }

    // Event name and page id only - the body (full page text) and the signature stay out of the log.
    logger.debug({ event, docId }, "Outline webhook: delivery processed");
    res.status(200).json({ accepted: true });
  },
);
