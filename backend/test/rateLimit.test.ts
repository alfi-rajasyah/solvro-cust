// In-memory per-IP limiter used by the public share route (http/rateLimit.ts).
import "./env.js";
import { describe, expect, it } from "vitest";
import type { Request, Response } from "express";
import { RATE_LIMIT_MAX_KEYS, createRateLimiter, rateLimitKey } from "../src/http/rateLimit.js";

function hit(limiter: ReturnType<typeof createRateLimiter>, ip: string): number {
  let status = 200;
  const res = { setHeader: () => undefined } as unknown as Response;
  try {
    limiter.middleware({ ip } as Request, res, () => undefined);
  } catch (err) {
    status = (err as { status: number }).status;
  }
  return status;
}

describe("rateLimitKey", () => {
  it("leaves IPv4 alone and collapses IPv4-mapped IPv6 to it", () => {
    expect(rateLimitKey("203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitKey("::FFFF:cb00:7107")).toBe("203.0.113.7");
    expect(rateLimitKey("0:0:0:0:0:ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  it("groups IPv6 addresses by their /56 prefix", () => {
    const a = rateLimitKey("2001:db8:1:200::1");
    expect(a).toBe("2001:db8:1:200::/56");
    // Same /56 (fourth hextet 02xx): different /64s and hosts.
    expect(rateLimitKey("2001:db8:1:2ff:1::9")).toBe(a);
    expect(rateLimitKey("2001:db8:1:2a0::1")).toBe(a);
    // Another /56 (fourth hextet 03xx or 01xx) and another /48 are separate clients.
    expect(rateLimitKey("2001:db8:1:300::1")).not.toBe(a);
    expect(rateLimitKey("2001:db8:1:1ff::1")).not.toBe(a);
    expect(rateLimitKey("2001:db8:2:200::1")).not.toBe(a);
    expect(rateLimitKey("2001:db8:1:2bb:aaaa:bbbb:cccc:dddd")).toBe(a);
    expect(rateLimitKey("2001:0DB8:0001:0200:0000:0000:0000:0001")).toBe(a);
    expect(rateLimitKey("2001:db8:1:200::1%eth0")).toBe(a);
    expect(rateLimitKey("::1")).toBe(rateLimitKey("0:0:0:0:1:2:3:4"));
  });

  it("falls back to a stable key for a missing address", () => {
    expect(rateLimitKey(undefined)).toBe("unknown");
  });
});

describe("createRateLimiter", () => {
  it("counts a whole IPv6 /56 as one client", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000 });
    expect(hit(limiter, "2001:db8::1")).toBe(200);
    expect(hit(limiter, "2001:db8::2")).toBe(200);
    expect(hit(limiter, "2001:db8::ffff:1")).toBe(200);
    expect(hit(limiter, "2001:db8::abcd")).toBe(429);
    expect(hit(limiter, "2001:db8:0:ff::1")).toBe(429); // another /64, same /56
    expect(hit(limiter, "2001:db8:0:100::1")).toBe(200); // next /56
    expect(limiter.size()).toBe(2);
  });

  it("never grows past the key cap within one window, and stays fast", () => {
    const limiter = createRateLimiter({ limit: 60, windowMs: 60_000 });
    const total = RATE_LIMIT_MAX_KEYS * 3;
    const started = performance.now();
    for (let i = 0; i < total; i++) {
      hit(limiter, `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`);
      expect(limiter.size()).toBeLessThanOrEqual(RATE_LIMIT_MAX_KEYS);
    }
    const elapsed = performance.now() - started;
    expect(limiter.size()).toBe(RATE_LIMIT_MAX_KEYS);
    // 30k inserts, each O(1) once full; an O(n) sweep per insert would take seconds.
    expect(elapsed).toBeLessThan(1000);
  });

  it("evicts the oldest key first and keeps a live client's counter", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 3 });
    hit(limiter, "1.1.1.1");
    hit(limiter, "2.2.2.2");
    hit(limiter, "3.3.3.3");
    hit(limiter, "4.4.4.4"); // evicts 1.1.1.1
    expect(limiter.size()).toBe(3);
    expect(hit(limiter, "2.2.2.2")).toBe(429); // still tracked
    expect(hit(limiter, "1.1.1.1")).toBe(200); // forgotten: counted afresh
  });

  it("sweeps expired entries at most once per window", () => {
    const limiter = createRateLimiter({ limit: 5, windowMs: 1, maxKeys: 4 });
    for (const ip of ["1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4"]) hit(limiter, ip);
    const wait = Date.now() + 5;
    while (Date.now() < wait); // let every window expire
    hit(limiter, "5.5.5.5"); // full -> sweep drops the expired four
    expect(limiter.size()).toBe(1);
  });
});
