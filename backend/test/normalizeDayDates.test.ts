// Pure-helper suite — no DB. Importing normalize-day-dates.ts must not open
// a Prisma connection; see the isMainModule guard at the bottom of that file.
import { describe, expect, it } from "vitest";
import { roundToUtcMidnight } from "../scripts/normalize-day-dates.js";

describe("roundToUtcMidnight", () => {
  it("leaves an exact UTC midnight untouched", () => {
    const d = new Date("2026-07-05T00:00:00.000Z");
    expect(roundToUtcMidnight(d).getTime()).toBe(d.getTime());
  });

  it("rounds 17:00:00.000Z up to the next UTC midnight (east-of-UTC signature)", () => {
    const d = new Date("2026-07-04T17:00:00.000Z");
    expect(roundToUtcMidnight(d).toISOString()).toBe(
      "2026-07-05T00:00:00.000Z",
    );
  });

  it("rounds 23:59:59.999Z up to the next UTC midnight", () => {
    const d = new Date("2026-07-04T23:59:59.999Z");
    expect(roundToUtcMidnight(d).toISOString()).toBe(
      "2026-07-05T00:00:00.000Z",
    );
  });

  it("rounds the exact 12:00:00.000Z tie-break up to the next UTC midnight", () => {
    const d = new Date("2026-07-04T12:00:00.000Z");
    expect(roundToUtcMidnight(d).toISOString()).toBe(
      "2026-07-05T00:00:00.000Z",
    );
  });

  it("rounds 11:59:59.999Z down to the same-day UTC midnight", () => {
    const d = new Date("2026-07-04T11:59:59.999Z");
    expect(roundToUtcMidnight(d).toISOString()).toBe(
      "2026-07-04T00:00:00.000Z",
    );
  });

  it("rounds 00:00:00.001Z down to the same-day UTC midnight", () => {
    const d = new Date("2026-07-04T00:00:00.001Z");
    expect(roundToUtcMidnight(d).toISOString()).toBe(
      "2026-07-04T00:00:00.000Z",
    );
  });

  it("handles month/year rollover", () => {
    const d = new Date("2026-12-31T17:00:00.000Z");
    expect(roundToUtcMidnight(d).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });
});
