// D5 (docs/archive/plans/outline-integration.md): a mentioning page's title is
// shown only to a viewer whose OWN Outline token can open it. This file asks
// Outline (`documents.info`, under the viewer's token) and caches the verdict.
//
// Visible only on a 200 whose document is neither trashed nor archived - a trashed
// doc still answers 200 with `deletedAt` set (F7); 403/404 = hidden. The cache is
// per user + doc for 5 minutes because Outline's rate limits are shared by every
// Solvro user through the backend's IP (F11). Only definite answers are cached:
// a 429/5xx never turns into a remembered "hidden".
import { onOutlineAuthChanged } from "./cacheHooks.js";
import { outlineCall } from "./client.js";
import { OutlineApiError } from "./errors.js";

export const VISIBILITY_TTL_MS = 5 * 60_000;
const CACHE_MAX_ENTRIES = 5000;

export type DocVisibility = "visible" | "hidden";
/** "reconnect": the viewer's token is gone/refused. "unknown": Outline could not answer right now. */
export type DocVisibilityResult = DocVisibility | "reconnect" | "unknown";

/** The slice of `documents.info` the check needs. */
export interface OutlineDocInfo {
  deletedAt: string | null;
  archivedAt: string | null;
}

/**
 * Asks Outline for one document under `userId`'s token. Throws OutlineApiError
 * (lib/outline/errors.ts): not_connected / reconnect_required, forbidden / not_found,
 * rate_limited, unavailable.
 */
export type OutlineDocInfoFetcher = (userId: number, docId: string) => Promise<OutlineDocInfo>;

// documents.info accepts the UUID the webhook stored (F6); the answer carries the
// page text, which is read for two timestamps only and dropped (D4).
const defaultFetcher: OutlineDocInfoFetcher = async (userId, docId) => {
  const res = await outlineCall<{ data?: { deletedAt?: string | null; archivedAt?: string | null } }>(
    userId,
    "documents.info",
    { id: docId },
  );
  return { deletedAt: res.data?.deletedAt ?? null, archivedAt: res.data?.archivedAt ?? null };
};

let fetcher: OutlineDocInfoFetcher = defaultFetcher;

/** Test seam: swap the Outline call for a fake (null restores the real client). */
export function setOutlineDocInfoFetcher(fn: OutlineDocInfoFetcher | null): void {
  fetcher = fn ?? defaultFetcher;
}

// Insertion-ordered Map as an LRU: a hit is re-inserted, the oldest key evicted.
const cache = new Map<string, { verdict: DocVisibility; expiresAt: number }>();

export function clearDocVisibilityCacheForTests(): void {
  cache.clear();
}

function cacheGet(key: string, now: number): DocVisibility | null {
  const hit = cache.get(key);
  if (!hit) return null;
  cache.delete(key);
  if (hit.expiresAt <= now) return null;
  cache.set(key, hit);
  return hit.verdict;
}

function cacheSet(key: string, verdict: DocVisibility, now: number): void {
  cache.delete(key);
  cache.set(key, { verdict, expiresAt: now + VISIBILITY_TTL_MS });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Drops every cached verdict of one user (their token changed or was removed). */
export function forgetUserDocVisibility(userId: number): void {
  const prefix = `${userId}:`;
  for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key);
}

// A token change (disconnect, new connection, admin wipe) drops the cached verdicts.
onOutlineAuthChanged((userId) => {
  if (userId === null) cache.clear();
  else forgetUserDocVisibility(userId);
});

export async function checkDocVisible(userId: number, docId: string): Promise<DocVisibilityResult> {
  const key = `${userId}:${docId}`;
  const now = Date.now();
  const cached = cacheGet(key, now);
  if (cached) return cached;

  try {
    const info = await fetcher(userId, docId);
    const verdict: DocVisibility = info.deletedAt === null && info.archivedAt === null ? "visible" : "hidden";
    cacheSet(key, verdict, now);
    return verdict;
  } catch (err) {
    if (err instanceof OutlineApiError) {
      if (err.kind === "forbidden" || err.kind === "not_found") {
        cacheSet(key, "hidden", now);
        return "hidden";
      }
      if (err.kind === "not_connected" || err.kind === "reconnect_required") return "reconnect";
      return "unknown"; // rate_limited, unavailable, rejected: fail closed, do not cache
    }
    throw err;
  }
}

/**
 * Checks many docs with a small concurrency cap. Stops early once the viewer's
 * connection turns out to be unusable.
 */
export async function checkDocsVisible(
  userId: number,
  docIds: string[],
  concurrency = 5,
): Promise<Map<string, DocVisibilityResult>> {
  const out = new Map<string, DocVisibilityResult>();
  let next = 0;
  let reconnect = false;
  async function worker(): Promise<void> {
    while (!reconnect) {
      const i = next++;
      if (i >= docIds.length) return;
      const verdict = await checkDocVisible(userId, docIds[i]);
      out.set(docIds[i], verdict);
      if (verdict === "reconnect") reconnect = true;
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, docIds.length) }, worker));
  return out;
}
