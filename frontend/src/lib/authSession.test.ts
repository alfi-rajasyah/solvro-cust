import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { bootRetryDelayMs, shouldEndSession } from "./auth";

// The boot `/auth/me` check signs the user out ONLY on a 401: a backend restart
// (network error, 502/503) must keep the session and retry.
describe("shouldEndSession", () => {
  it("is true for 401 only", () => {
    expect(shouldEndSession(new ApiError(401, "unauthenticated", null))).toBe(true);
    for (const status of [400, 403, 404, 429, 500, 502, 503, 504]) {
      expect(shouldEndSession(new ApiError(status, "x", null)), String(status)).toBe(false);
    }
    expect(shouldEndSession(new TypeError("Failed to fetch"))).toBe(false);
    expect(shouldEndSession(new DOMException("timeout", "TimeoutError"))).toBe(false);
    expect(shouldEndSession(null)).toBe(false);
  });
});

describe("bootRetryDelayMs", () => {
  it("backs off 2 s, 4 s, 8 s … and caps at 30 s", () => {
    expect([0, 1, 2, 3].map(bootRetryDelayMs)).toEqual([2000, 4000, 8000, 16000]);
    expect(bootRetryDelayMs(4)).toBe(30000);
    expect(bootRetryDelayMs(20)).toBe(30000);
  });
});
