// Personal iTop token management — Phase 5 (write path), Task 5.1. Mounted
// at /itop/me in src/app.ts, `requireAuth` only (no admin gate: every user
// manages their own token). A pasted token is accepted only when it
// belongs, in iTop, to the SAME PERSON as the Solvro account saving it
// (matched by email) — user decision 2026-09-22 (docs/plans/itop-integration.md
// §1 decision 8, docs/plans/itop-integration-spec.md "What one action looks
// like" for the REST shapes this module builds on top of). Writes to iTop
// (routes/itop.ts's action/log routes) always decrypt and use THIS token for
// the acting user — never the application token (lib/itop/config.ts's
// getItopAppClient, read-only) and never another user's.
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { logger } from "../logger.js";
import { requireAuth } from "../http/auth.js";
import { HttpError } from "../http/errors.js";
import { validate } from "../http/validate.js";
import { open, seal, SecretBoxError } from "../lib/secretBox.js";
import { ItopError, type ItopGetResult } from "../lib/itop/client.js";
import { getItopConfig, isItopConfigured, makeItopClient } from "../lib/itop/config.js";
import { escapeOqlString, parseItopDate } from "../lib/itop/sync.js";
import {
  ITOP_PERSON_OUTPUT_FIELDS,
  ITOP_PERSONAL_TOKEN_OUTPUT_FIELDS,
  ITOP_USER_OUTPUT_FIELDS,
  type ItopPersonFields,
  type ItopPersonalTokenFields,
  type ItopUserFields,
} from "../lib/itop/types.js";

export const itopUserRouter = Router();

itopUserRouter.use(requireAuth);

const TRANSPORT_CODES = new Set<unknown>(["http", "timeout", "network", "parse"]);

/** Maps a Person-lookup failure to the HTTP shape `PUT /itop/me/token` promises: a rejected/invalid token is a 400 the user can act on, a transport failure is a 502. */
function mapTokenCheckError(err: unknown): never {
  if (err instanceof ItopError) {
    if (TRANSPORT_CODES.has(err.code)) {
      throw new HttpError(502, "itop_unreachable", err.message);
    }
    // Any other iTop application-level error (invalid login, wrong scope,
    // no rights on Person, ...) means this token can't be trusted as the
    // user's own — surfaced as "invalid" rather than distinguishing every
    // possible iTop error code.
    throw new HttpError(400, "itop_token_invalid", err.message);
  }
  throw err;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function buildTokenStatus(userId: number) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { itopTokenEnc: true, itopTokenPersonName: true, itopTokenCheckedAt: true, itopTokenExpiresAt: true },
  });
  const config = await getItopConfig();

  let set = Boolean(user.itopTokenEnc);
  let unreadable = false;
  if (user.itopTokenEnc) {
    try {
      open(user.itopTokenEnc);
    } catch (err) {
      if (!(err instanceof SecretBoxError)) throw err;
      // SECRETS_KEY rotated (or the ciphertext was otherwise tampered)
      // since this token was saved — it can never be decrypted again, so
      // report it as unset rather than a token the UI implies still works.
      set = false;
      unreadable = true;
    }
  }

  return {
    set,
    unreadable,
    personName: user.itopTokenPersonName,
    checkedAt: user.itopTokenCheckedAt,
    expiresAt: user.itopTokenExpiresAt,
    actionsEnabled: config.actionsEnabled,
    configured: isItopConfigured(config),
  };
}

// ---- PUT /token ---------------------------------------------------------

const putTokenSchema = z.object({ token: z.string().min(16) });

const PUT_TOKEN_RATE_LIMIT = 10;
const PUT_TOKEN_RATE_WINDOW_MS = 10 * 60_000;
/**
 * Module-level, per-process, per-user sliding window: each PUT makes
 * several live iTop requests (Person, list_operations, User, PersonalToken)
 * under a token supplied by the caller, so bounding how often a single user
 * can hammer this route also bounds how hard a bad/malicious paste can hit
 * the configured iTop instance. Resets on process restart — deliberately
 * simple, same spirit as this integration's other in-process rate limit
 * (routes/webhook.ts's `/webhook/itop`).
 */
const putTokenAttempts = new Map<number, number[]>();

function checkPutTokenRateLimit(userId: number): void {
  const now = Date.now();
  const recent = (putTokenAttempts.get(userId) ?? []).filter((t) => now - t < PUT_TOKEN_RATE_WINDOW_MS);
  if (recent.length >= PUT_TOKEN_RATE_LIMIT) {
    throw new HttpError(429, "rate_limited", "Too many personal token save attempts — wait a few minutes and try again.");
  }
  recent.push(now);
  putTokenAttempts.set(userId, recent);
}

itopUserRouter.put(
  "/token",
  validate("body", putTokenSchema),
  async (req, res) => {
    checkPutTokenRateLimit(req.user!.sub);

    const { token } = req.body as z.infer<typeof putTokenSchema>;
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.sub } });

    const config = await getItopConfig();
    if (!config.baseUrl) {
      throw new HttpError(
        409,
        "itop_not_configured",
        "iTop is not connected. An admin must set the iTop URL first.",
      );
    }

    const client = makeItopClient(config.baseUrl, token);
    const notYoursMessage = `This token does not belong to an iTop person with your email (${user.email}).`;

    let personResult: ItopGetResult<ItopPersonFields>;
    try {
      const oql = `SELECT Person WHERE email = '${escapeOqlString(user.email)}'`;
      personResult = await client.get<ItopPersonFields>("Person", oql, ITOP_PERSON_OUTPUT_FIELDS);
    } catch (err) {
      mapTokenCheckError(err);
    }

    if (personResult.objects.length !== 1) {
      throw new HttpError(400, "itop_token_not_yours", notYoursMessage);
    }
    const person = personResult.objects[0];
    const personId = person.key;
    const personName = person.fields.friendlyname;

    if (user.itopPersonId !== null && user.itopPersonId !== personId) {
      throw new HttpError(400, "itop_token_not_yours", notYoursMessage);
    }

    // Write-capability probe: iTop's list_operations reports every
    // operation the SERVER supports, not what THIS token's profile may
    // actually do — a missing verb here is informative only, never a
    // reason to reject the token (per Task 5.1: "if you cannot detect
    // rights, skip and say so"). A genuinely under-privileged token instead
    // fails loudly the first time an action route calls it.
    try {
      const ops = await client.listOperations();
      const verbs = new Set(ops.operations.map((o) => o.verb));
      if (!verbs.has("core/apply_stimulus") || !verbs.has("core/update")) {
        logger.debug(
          { email: user.email },
          "iTop list_operations did not report core/apply_stimulus/core/update for a saved personal token — cannot infer write rights from this call alone",
        );
      }
    } catch (err) {
      logger.debug({ err: errorMessage(err) }, "iTop list_operations probe failed while saving a personal token; skipping");
    }

    // Best-effort itopUserId + expiry — resolved with the user's OWN token,
    // never the application token. Neither failure rejects the token itself.
    let resolvedItopUserId: number | null = null;
    try {
      const userResult = await client.get<ItopUserFields>(
        "User",
        `SELECT User WHERE contactid = ${personId}`,
        ITOP_USER_OUTPUT_FIELDS,
      );
      if (userResult.objects[0]) resolvedItopUserId = userResult.objects[0].key;
    } catch (err) {
      logger.debug({ err: errorMessage(err) }, "iTop User lookup failed while saving a personal token; itopUserId left as-is");
    }

    // Ownership corroboration + best-effort expiry, from the SAME
    // PersonalToken query. Real iTop scopes a personal token's visibility
    // of this class to its OWN user (see the fake's matching rule in
    // test/itop/fakeItop.ts), so a token that resolved a Person by email
    // (which ignores which token asked) but ISN'T actually that person's
    // own token comes back with ZERO rows here — a signal
    // list_operations can't give us, since it reports every operation the
    // server supports regardless of profile. A class that isn't readable at
    // all (rights, missing extension, ...) is inconclusive, not disproof —
    // that's still accepted as before, with expiresAt left null.
    let expiresAt: Date | null = null;
    if (resolvedItopUserId !== null) {
      try {
        const tokenResult = await client.get<ItopPersonalTokenFields>(
          "PersonalToken",
          `SELECT PersonalToken WHERE user_id = ${resolvedItopUserId}`,
          ITOP_PERSONAL_TOKEN_OUTPUT_FIELDS,
        );
        if (tokenResult.objects.length === 0) {
          throw new HttpError(400, "itop_token_not_yours", notYoursMessage);
        }
        const raw = tokenResult.objects[0]?.fields.expiration_date;
        expiresAt = raw ? parseItopDate(raw) : null;
      } catch (err) {
        if (err instanceof HttpError) throw err;
        logger.debug(
          { err: errorMessage(err) },
          "iTop PersonalToken read failed while saving a personal token; accepting the token, expiresAt left null",
        );
      }
    }

    const data: Prisma.UserUpdateInput = {
      itopTokenEnc: seal(token),
      itopTokenPersonName: personName,
      itopTokenCheckedAt: new Date(),
      itopTokenExpiresAt: expiresAt,
    };
    if (user.itopPersonId === null) data.itopPersonId = personId;
    if (resolvedItopUserId !== null && user.itopUserId !== resolvedItopUserId) data.itopUserId = resolvedItopUserId;

    try {
      await prisma.user.update({ where: { id: user.id }, data });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new HttpError(
          409,
          "itop_person_already_linked",
          "This iTop person is already linked to another Solvro account.",
        );
      }
      throw err;
    }

    res.json(await buildTokenStatus(user.id));
  },
);

// ---- GET /token ---------------------------------------------------------

itopUserRouter.get("/token", async (req, res) => {
  res.json(await buildTokenStatus(req.user!.sub));
});

// ---- DELETE /token --------------------------------------------------------

itopUserRouter.delete("/token", async (req, res) => {
  await prisma.user.update({
    where: { id: req.user!.sub },
    data: {
      itopTokenEnc: null,
      itopTokenPersonName: null,
      itopTokenCheckedAt: null,
      itopTokenExpiresAt: null,
    },
  });
  res.status(204).end();
});
