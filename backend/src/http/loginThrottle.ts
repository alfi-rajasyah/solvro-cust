// Failure-only throttle for the sign-in routes (routes/auth.ts). It counts
// REJECTED attempts per key — the lower-cased email, or the client address
// from rateLimitKey — in a fixed window, so someone who signs in often is
// never blocked, while online password guessing stops after `limit` failures.
// In-process and memory-bounded exactly like http/rateLimit.ts: at `maxKeys`
// the expired entries are swept (at most once per window) and, if still full,
// the oldest key is evicted.

export interface FailureThrottle {
  /** Seconds until `key` may try again, or 0 when it is not blocked. */
  blockedFor: (key: string, now?: number) => number;
  /** Counts one rejected attempt for `key`. */
  recordFailure: (key: string, now?: number) => void;
  /** Forgets `key` (a successful sign-in). */
  clear: (key: string) => void;
  /** Forget every counter (tests). */
  reset: () => void;
  /** Number of tracked keys (tests). */
  size: () => number;
}

export const FAILURE_THROTTLE_MAX_KEYS = 10_000;

export function createFailureThrottle(opts: {
  limit: number;
  windowMs: number;
  maxKeys?: number;
}): FailureThrottle {
  const maxKeys = opts.maxKeys ?? FAILURE_THROTTLE_MAX_KEYS;
  const failures = new Map<string, { count: number; resetAt: number }>();
  let nextSweepAt = 0;

  function makeRoom(now: number) {
    if (failures.size < maxKeys) return;
    if (now >= nextSweepAt) {
      nextSweepAt = now + opts.windowMs;
      for (const [key, entry] of failures) {
        if (entry.resetAt <= now) failures.delete(key);
      }
    }
    if (failures.size >= maxKeys) {
      const oldest = failures.keys().next();
      if (!oldest.done) failures.delete(oldest.value);
    }
  }

  return {
    blockedFor(key, now = Date.now()) {
      const entry = failures.get(key);
      if (!entry || entry.resetAt <= now || entry.count < opts.limit) return 0;
      return Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    },
    recordFailure(key, now = Date.now()) {
      let entry = failures.get(key);
      if (!entry || entry.resetAt <= now) {
        // Delete first so a re-used key moves to the newest end of the Map.
        failures.delete(key);
        makeRoom(now);
        entry = { count: 0, resetAt: now + opts.windowMs };
        failures.set(key, entry);
      }
      entry.count += 1;
    },
    clear(key) {
      failures.delete(key);
    },
    reset() {
      failures.clear();
      nextSweepAt = 0;
    },
    size: () => failures.size,
  };
}
