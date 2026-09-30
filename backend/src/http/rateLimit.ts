import type { NextFunction, Request, Response } from "express";
import { HttpError } from "./errors.js";

// Minimal in-memory fixed-window rate limiter, keyed per client IP. In-process
// only: one backend instance, no shared store, no npm dependency. Used by the
// unauthenticated public share route (routes/publicShare.ts).
//
// Memory is hard-capped: at `maxKeys` distinct clients the expired entries are
// swept (at most once per window, so a flood of new keys cannot make every
// request O(n)), and if the table is still full the oldest key is evicted
// (Map iteration order is insertion order, so that is O(1)).

export interface RateLimiter {
  middleware: (req: Request, res: Response, next: NextFunction) => void;
  /** Forget every counter (tests). */
  reset: () => void;
  /** Number of tracked keys (tests). */
  size: () => number;
}

export const RATE_LIMIT_MAX_KEYS = 10_000;

/** Expands an IPv6 literal to its 8 hextet groups (already lower-cased, no zone). */
function expandIPv6(ip: string): string[] | null {
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  // A trailing dotted IPv4 counts as two hextets.
  const last = (halves.length === 2 ? tail : head).at(-1);
  if (last && last.includes(".")) {
    const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(last);
    if (!m) return null;
    const [a, b, c, d] = m.slice(1).map(Number);
    if ([a, b, c, d].some((n) => n > 255)) return null;
    const pair = [((a << 8) | b).toString(16), ((c << 8) | d).toString(16)];
    (halves.length === 2 ? tail : head).splice(-1, 1, ...pair);
  }
  const groups =
    halves.length === 2
      ? [...head, ...Array<string>(8 - head.length - tail.length).fill("0"), ...tail]
      : head;
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => g.replace(/^0+(?=.)/, ""));
}

/**
 * Bucket key for a client address: IPv4 as-is, IPv4-mapped IPv6 (`::ffff:a.b.c.d`
 * in either notation) collapsed to its IPv4, any other IPv6 reduced to its /56
 * prefix — a client can rotate through a whole /64 (and ISPs commonly delegate
 * a /56 to one customer), so per-address keys would be both bypassable and
 * unbounded.
 */
export function rateLimitKey(ip: string | undefined): string {
  if (!ip) return "unknown";
  const bare = ip.toLowerCase().split("%")[0];
  if (!bare.includes(":")) return bare;
  const groups = expandIPv6(bare);
  if (!groups) return bare;
  if (groups.slice(0, 5).every((g) => g === "0") && groups[5] === "ffff") {
    const hi = parseInt(groups[6], 16);
    const lo = parseInt(groups[7], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  // /56: the first three hextets plus the top byte of the fourth.
  const fourth = (parseInt(groups[3], 16) & 0xff00).toString(16);
  return `${groups.slice(0, 3).join(":")}:${fourth}::/56`;
}

export function createRateLimiter(opts: {
  limit: number;
  windowMs: number;
  maxKeys?: number;
}): RateLimiter {
  const maxKeys = opts.maxKeys ?? RATE_LIMIT_MAX_KEYS;
  const hits = new Map<string, { count: number; resetAt: number }>();
  let nextSweepAt = 0;

  function makeRoom(now: number) {
    if (hits.size < maxKeys) return;
    if (now >= nextSweepAt) {
      nextSweepAt = now + opts.windowMs;
      for (const [key, entry] of hits) {
        if (entry.resetAt <= now) hits.delete(key);
      }
    }
    if (hits.size >= maxKeys) {
      const oldest = hits.keys().next();
      if (!oldest.done) hits.delete(oldest.value);
    }
  }

  return {
    middleware(req, res, next) {
      const now = Date.now();
      // `req.ip` honours the app's `trust proxy` setting (src/app.ts), so behind
      // nginx it is the real client, not the proxy.
      const key = rateLimitKey(req.ip);
      let entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        // Delete first so a re-used key moves to the newest end of the Map.
        hits.delete(key);
        makeRoom(now);
        entry = { count: 0, resetAt: now + opts.windowMs };
        hits.set(key, entry);
      }
      entry.count += 1;
      if (entry.count > opts.limit) {
        res.setHeader("Retry-After", String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
        throw new HttpError(429, "rate_limited", "Too many requests");
      }
      next();
    },
    reset: () => {
      hits.clear();
      nextSweepAt = 0;
    },
    size: () => hits.size,
  };
}
