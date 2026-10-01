// Pure unit tests for backend/src/lib/itop/timezone.ts — no database, no
// fake iTop. See that module's top-of-file comment for the DST rule under
// test (earlier instant on a fall-back overlap, shift forward past a
// spring-forward gap).
import { describe, expect, it } from "vitest";
import { isValidTimeZone, utcToZonedWallTime, zonedWallTimeToUtc } from "../../src/lib/itop/timezone.js";

describe("isValidTimeZone", () => {
  it("accepts UTC and real IANA zone names", () => {
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Europe/Paris")).toBe(true);
    expect(isValidTimeZone("Asia/Jakarta")).toBe(true);
    expect(isValidTimeZone("America/New_York")).toBe(true);
  });

  it("rejects a made-up or malformed zone name without throwing", () => {
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone("   ")).toBe(false);
  });

  it("rejects non-string values without throwing", () => {
    expect(isValidTimeZone(undefined)).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
    expect(isValidTimeZone({})).toBe(false);
  });
});

describe("zonedWallTimeToUtc / utcToZonedWallTime — UTC identity", () => {
  it("UTC wall time is its own UTC instant", () => {
    const utc = zonedWallTimeToUtc(2026, 6, 15, 12, 30, 0, "UTC");
    expect(utc.toISOString()).toBe("2026-06-15T12:30:00.000Z");
    expect(utcToZonedWallTime(utc, "UTC")).toBe("2026-06-15 12:30:00");
  });
});

describe("Europe/Paris — summer (+2) and winter (+1)", () => {
  it("converts a summer wall time at +2", () => {
    const utc = zonedWallTimeToUtc(2026, 7, 1, 14, 0, 0, "Europe/Paris");
    expect(utc.toISOString()).toBe("2026-07-01T12:00:00.000Z");
    expect(utcToZonedWallTime(utc, "Europe/Paris")).toBe("2026-07-01 14:00:00");
  });

  it("converts a winter wall time at +1", () => {
    const utc = zonedWallTimeToUtc(2026, 1, 15, 14, 0, 0, "Europe/Paris");
    expect(utc.toISOString()).toBe("2026-01-15T13:00:00.000Z");
    expect(utcToZonedWallTime(utc, "Europe/Paris")).toBe("2026-01-15 14:00:00");
  });
});

describe("DST transitions", () => {
  it("spring-forward GAP: a non-existent wall time shifts forward past the gap", () => {
    // Europe/Paris, 2026-03-29: clocks jump from 02:00 CET straight to
    // 03:00 CEST at the instant 01:00 UTC — 02:00-03:00 local never happens.
    const utc = zonedWallTimeToUtc(2026, 3, 29, 2, 30, 0, "Europe/Paris");
    // Shifted forward by the gap's size (1h): 02:30 -> 03:30 CEST.
    expect(utcToZonedWallTime(utc, "Europe/Paris")).toBe("2026-03-29 03:30:00");
    expect(utc.toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });

  it("fall-back OVERLAP: an ambiguous wall time resolves to the EARLIER real instant", () => {
    // Europe/Paris, 2026-10-25: clocks fall back from 03:00 CEST to 02:00
    // CET at 01:00 UTC — 02:00-03:00 local happens twice (00:00-01:00 UTC
    // as CEST, then 01:00-02:00 UTC again as CET).
    const utc = zonedWallTimeToUtc(2026, 10, 25, 2, 30, 0, "Europe/Paris");
    // The earlier occurrence — still within CEST (+2) — not the later one.
    expect(utc.toISOString()).toBe("2026-10-25T00:30:00.000Z");
    // Reformatting reproduces the (ambiguous) wall-clock reading either way.
    expect(utcToZonedWallTime(utc, "Europe/Paris")).toBe("2026-10-25 02:30:00");
  });

  it("a plain wall time on a transition DATE but well outside the transition hour round-trips normally", () => {
    // Same transition day, but a time of day nowhere near the 02:00-03:00
    // transition window — must not be treated as ambiguous.
    const utc = zonedWallTimeToUtc(2026, 10, 25, 12, 0, 0, "Europe/Paris");
    expect(utcToZonedWallTime(utc, "Europe/Paris")).toBe("2026-10-25 12:00:00");
    // CET (+1) is already in effect by noon.
    expect(utc.toISOString()).toBe("2026-10-25T11:00:00.000Z");
  });
});

describe("Asia/Jakarta — fixed +7, no DST", () => {
  it("converts consistently across the calendar year", () => {
    const summer = zonedWallTimeToUtc(2026, 7, 1, 14, 0, 0, "Asia/Jakarta");
    const winter = zonedWallTimeToUtc(2026, 1, 15, 14, 0, 0, "Asia/Jakarta");
    expect(summer.toISOString()).toBe("2026-07-01T07:00:00.000Z");
    expect(winter.toISOString()).toBe("2026-01-15T07:00:00.000Z");
  });
});

describe("America/New_York", () => {
  it("converts an EDT (-4) summer wall time", () => {
    const utc = zonedWallTimeToUtc(2026, 7, 1, 14, 0, 0, "America/New_York");
    expect(utc.toISOString()).toBe("2026-07-01T18:00:00.000Z");
  });

  it("converts an EST (-5) winter wall time", () => {
    const utc = zonedWallTimeToUtc(2026, 1, 15, 14, 0, 0, "America/New_York");
    expect(utc.toISOString()).toBe("2026-01-15T19:00:00.000Z");
  });
});
