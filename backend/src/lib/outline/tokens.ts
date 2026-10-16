// Per-user Outline token storage and refresh (docs/archive/plans/outline-integration.md,
// B3, F4). Access tokens last ~1 h and a refresh ROTATES both tokens: the old
// access token dies at once and replaying a rotated refresh token revokes the whole
// grant. Three layers keep that safe:
//  - in-process single flight: concurrent callers of one user share ONE refresh
//    (a Map of promises), so a burst never queues N transactions on the lock;
//  - a per-user transaction-scoped advisory lock serialises EVERY write of a user's
//    tokens across processes - refresh, the OAuth callback's store, disconnect,
//    compare-and-clear - and the tokens are re-read inside it;
//  - every write that follows a network call to Outline takes the outline_config row
//    FOR SHARE and checks the address/client it called is still the configured one.
//    The admin's change takes the row FOR UPDATE and wipes all tokens in the same
//    transaction, so a token can never be stored for (or sent to) a host it does not
//    belong to, and an admin wipe cannot be undone by an in-flight refresh/callback.
// Tokens exist only sealed (secretBox) in the DB. Decision (no re-check of the
// Outline email on refresh, rate budget): identity is verified when connecting; every
// (re)connect goes through the callback's `auth.info` email check.
import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { logger } from "../../logger.js";
import { open, seal } from "../secretBox.js";
import { notifyOutlineAuthChanged } from "./cacheHooks.js";
import { requireOutlineOAuthConfig, refreshTokenGrant, OutlineGrantError, type OutlineTokenPair } from "./oauth.js";
import { outlineNotConnected, outlineReconnectRequired, outlineUnavailable } from "./errors.js";

/** First key of the (int, int) advisory lock pair; the second is the user id. */
const ADVISORY_LOCK_NAMESPACE = 0x6f75; // "ou" - Outline tokens
/** Refresh when the access token has under this long left. */
export const REFRESH_SKEW_MS = 60_000;
/** How long a writer waits for another writer of the same user (or the admin's config change). */
export const LOCK_WAIT_MS = 15_000;
// The network call to Outline happens only AFTER the lock is held (<= 10 s), so the
// transaction must outlive lock wait + call + writes: it can never be rolled back by
// Prisma's timer after Outline already rotated the pair.
const TX_TIMEOUT_MS = LOCK_WAIT_MS + 30_000;

const CLEARED = {
  outlineAccessTokenEnc: null,
  outlineRefreshTokenEnc: null,
  outlineTokenExpiresAt: null,
  outlineUserId: null,
  outlineEmail: null,
} as const;

/** The Outline address and OAuth client a network call was made against. */
export interface OutlineConfigFingerprint {
  baseUrl: string;
  clientId: string;
}

/** The configured address/client changed between a network call and the token write. */
export class OutlineConfigChanged extends Error {
  constructor() {
    super("outline config changed");
    this.name = "OutlineConfigChanged";
  }
}

function isLockTimeout(err: unknown): boolean {
  return /lock timeout|55P03/i.test(err instanceof Error ? `${err.message} ${JSON.stringify((err as { meta?: unknown }).meta ?? "")}` : "");
}

/**
 * Runs `fn` in a transaction holding this user's token lock. With `expect`, the
 * outline_config row is read FOR SHARE first and must still match it, else
 * `OutlineConfigChanged` (nothing is written). A lock wait over LOCK_WAIT_MS is a
 * typed `outline_unavailable`.
 */
async function withUserLock<T>(
  userId: number,
  expect: OutlineConfigFingerprint | null,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('lock_timeout', ${`${LOCK_WAIT_MS}ms`}, true)`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_NAMESPACE}::int, ${userId}::int)`;
        if (expect) {
          const rows = await tx.$queryRaw<Array<{ base_url: string | null; oauth_client_id: string | null }>>`
            SELECT base_url, oauth_client_id FROM outline_config WHERE id = 'default' FOR SHARE`;
          if (rows[0]?.base_url !== expect.baseUrl || rows[0]?.oauth_client_id !== expect.clientId) {
            throw new OutlineConfigChanged();
          }
        }
        return fn(tx);
      },
      { timeout: TX_TIMEOUT_MS, maxWait: LOCK_WAIT_MS },
    );
  } catch (err) {
    if (isLockTimeout(err)) throw outlineUnavailable();
    throw err;
  }
}

interface StoredTokens {
  accessEnc: string | null;
  refreshEnc: string | null;
  expiresAt: Date | null;
}

const tokenSelect = {
  outlineAccessTokenEnc: true,
  outlineRefreshTokenEnc: true,
  outlineTokenExpiresAt: true,
} satisfies Prisma.UserSelect;

function toStored(u: {
  outlineAccessTokenEnc: string | null;
  outlineRefreshTokenEnc: string | null;
  outlineTokenExpiresAt: Date | null;
}): StoredTokens {
  return { accessEnc: u.outlineAccessTokenEnc, refreshEnc: u.outlineRefreshTokenEnc, expiresAt: u.outlineTokenExpiresAt };
}

function stillFresh(t: StoredTokens, now: number): boolean {
  return t.expiresAt !== null && t.expiresAt.getTime() - now > REFRESH_SKEW_MS;
}

/** Opens a sealed token; an unreadable one (rotated SECRETS_KEY) counts as "reconnect". */
function openOrNull(sealed: string): string | null {
  try {
    return open(sealed);
  } catch {
    return null;
  }
}

/**
 * Forgets `userId`'s connection locally (no call to Outline) under their token lock,
 * and returns the refresh token that was stored (plaintext, or null when absent or
 * unreadable) so the caller can revoke it at Outline.
 */
export async function disconnectOutlineUser(userId: number): Promise<string | null> {
  const refreshEnc = await withUserLock(userId, null, async (tx) => {
    const row = await tx.user.findUnique({ where: { id: userId }, select: { outlineRefreshTokenEnc: true } });
    await tx.user.update({ where: { id: userId }, data: CLEARED });
    return row?.outlineRefreshTokenEnc ?? null;
  });
  notifyOutlineAuthChanged(userId);
  return refreshEnc ? openOrNull(refreshEnc) : null;
}

/**
 * Clears the connection ONLY if the stored access token is still `accessToken` -
 * i.e. nothing newer (a fresh OAuth callback, another refresh) replaced the pair
 * that just failed. Used after a repeated 401.
 */
export async function clearOutlineTokensIfAccessIs(userId: number, accessToken: string): Promise<boolean> {
  const cleared = await withUserLock(userId, null, async (tx) => {
    const row = await tx.user.findUnique({ where: { id: userId }, select: { outlineAccessTokenEnc: true } });
    if (!row?.outlineAccessTokenEnc || openOrNull(row.outlineAccessTokenEnc) !== accessToken) return false;
    await tx.user.update({ where: { id: userId }, data: CLEARED });
    return true;
  });
  if (cleared) notifyOutlineAuthChanged(userId);
  return cleared;
}

/**
 * Stores a freshly authorised pair (the OAuth callback), under the user's lock and only
 * while the address/client it was issued for are still configured (`OutlineConfigChanged`
 * otherwise - the caller revokes the new token). Returns the previous refresh token
 * (plaintext) so the caller can revoke the replaced grant.
 */
export async function storeOutlineTokens(
  userId: number,
  expect: OutlineConfigFingerprint,
  pair: OutlineTokenPair,
  identity: { outlineUserId: string; outlineEmail: string },
): Promise<string | null> {
  const previousEnc = await withUserLock(userId, expect, async (tx) => {
    const row = await tx.user.findUnique({ where: { id: userId }, select: { outlineRefreshTokenEnc: true } });
    await tx.user.update({
      where: { id: userId },
      data: {
        outlineAccessTokenEnc: seal(pair.accessToken),
        outlineRefreshTokenEnc: seal(pair.refreshToken),
        outlineTokenExpiresAt: pair.expiresAt,
        outlineUserId: identity.outlineUserId,
        outlineEmail: identity.outlineEmail,
      },
    });
    return row?.outlineRefreshTokenEnc ?? null;
  });
  notifyOutlineAuthChanged(userId);
  return previousEnc ? openOrNull(previousEnc) : null;
}

/**
 * The user's usable access token, refreshing first when it is within 60 s of expiry.
 * With `rejectedAccessToken` (Outline answered 401 to it) a refresh is forced unless
 * another request already replaced that token. Throws 409 `outline_not_connected` /
 * `outline_reconnect_required`.
 */
export async function getOutlineAccessToken(
  userId: number,
  opts: { rejectedAccessToken?: string } = {},
): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: tokenSelect });
  if (!user?.outlineAccessTokenEnc || !user.outlineRefreshTokenEnc) throw outlineNotConnected();

  const stored = toStored(user);
  if (opts.rejectedAccessToken === undefined && stillFresh(stored, Date.now())) {
    const token = openOrNull(stored.accessEnc!);
    if (token) return token;
  }
  return refreshSingleFlight(userId, opts.rejectedAccessToken);
}

// In-process single flight: one refresh per (user, rejected token) at a time. Callers
// that arrive while it runs await the same promise instead of queueing a transaction
// each on the advisory lock (which would hold a pooled DB connection apiece).
const inflight = new Map<string, Promise<string>>();

function refreshSingleFlight(userId: number, rejected: string | undefined): Promise<string> {
  const key = `${userId}|${rejected ?? ""}`;
  const running = inflight.get(key);
  if (running) return running;
  const promise = doRefresh(userId, rejected).finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

type RefreshOutcome = { token: string; changed: boolean } | { reconnect: true };

async function doRefresh(userId: number, rejected: string | undefined): Promise<string> {
  const config = await requireOutlineOAuthConfig();
  const fingerprint: OutlineConfigFingerprint = { baseUrl: config.baseUrl, clientId: config.clientId };
  let outcome: RefreshOutcome;
  try {
    outcome = await withUserLock(userId, fingerprint, async (tx): Promise<RefreshOutcome> => {
      // Re-read inside the lock: a concurrent request may have refreshed (or reconnected,
      // or disconnected) while we waited.
      const row = await tx.user.findUnique({ where: { id: userId }, select: tokenSelect });
      if (!row?.outlineAccessTokenEnc || !row.outlineRefreshTokenEnc) throw outlineNotConnected();
      const current = toStored(row);
      const currentAccess = openOrNull(current.accessEnc!);
      const currentRefresh = openOrNull(current.refreshEnc!);

      if (currentAccess !== null) {
        const replaced = rejected !== undefined && currentAccess !== rejected;
        const fresh = rejected === undefined && stillFresh(current, Date.now());
        if (replaced || fresh) return { token: currentAccess, changed: false };
      }
      if (currentRefresh === null) {
        await tx.user.update({ where: { id: userId }, data: CLEARED });
        return { reconnect: true };
      }

      try {
        // The lock is held and the config re-checked: only now is Outline called.
        const pair = await refreshTokenGrant(config, currentRefresh);
        await tx.user.update({
          where: { id: userId },
          data: {
            outlineAccessTokenEnc: seal(pair.accessToken),
            outlineRefreshTokenEnc: seal(pair.refreshToken),
            outlineTokenExpiresAt: pair.expiresAt,
          },
        });
        return { token: pair.accessToken, changed: true };
      } catch (err) {
        if (err instanceof OutlineGrantError) {
          // Revoked grant, suspended Outline user, or a replayed refresh token (F4). Safe to
          // clear: inside the lock, the pair we just read is the one Outline refused.
          await tx.user.update({ where: { id: userId }, data: CLEARED });
          return { reconnect: true };
        }
        throw err; // 429 / unreachable / client refused: keep the tokens, surface the typed error
      }
    });
  } catch (err) {
    // The admin re-pointed Outline since we loaded the config: the tokens are gone (the
    // admin's change wiped them) and must never be sent to the new address.
    if (err instanceof OutlineConfigChanged) throw outlineNotConnected();
    throw err;
  }
  if ("reconnect" in outcome) {
    notifyOutlineAuthChanged(userId);
    logger.info({ userId }, "outline connection dropped: refresh refused");
    throw outlineReconnectRequired();
  }
  return outcome.token;
}
