// The iTop webhook nudge: POST /webhook/itop, the first unauthenticated
// non-health route in this app (mounted at /webhook in src/app.ts, BEFORE
// the global express.json() parser — this route ignores the request body
// entirely, so a malformed body must never 400 before the secret check
// below runs). iTop's "on ticket update" trigger calls this with no
// meaningful payload; it exists only to nudge the scheduler into an
// immediate incremental pull instead of waiting for the next tick. Carries
// no trust in anything iTop sends beyond the shared secret header — see
// docs/archive/plans/itop-integration.md §2 deviation 6 and Task 4.1.
import { Router } from "express";
import crypto from "node:crypto";
import { logger } from "../logger.js";
import { HttpError } from "../http/errors.js";
import { getItopConfig } from "../lib/itop/config.js";
import { open, SecretBoxError } from "../lib/secretBox.js";
import { requestSync } from "../lib/itop/scheduler.js";

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
