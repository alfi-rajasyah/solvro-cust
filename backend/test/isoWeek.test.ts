// Pure-helper suite — no DB. See backend/src/lib/isoWeek.ts for the
// round-trip validation approach (why 2025-W53 is rejected but 2026-W53
// isn't: 2026 is a 53-week ISO year, 2025 is not).
import { describe, expect, it } from "vitest";
import { isMonday, parseWeekKey, weekKeyOf } from "../src/lib/isoWeek.js";

describe("parseWeekKey", () => {
  it("2026-W01 starts 2025-12-29", () => {
    const parsed = parseWeekKey("2026-W01");
    expect(parsed?.start).toBe("2025-12-29");
  });

  it("2026-W53 starts 2026-12-28 (2026 is a 53-week ISO year) and crosses into 2027", () => {
    const parsed = parseWeekKey("2026-W53");
    expect(parsed?.start).toBe("2026-12-28");
    expect(parsed?.days[6]).toBe("2027-01-03");
  });

  it("2027-W01 starts 2027-01-04", () => {
    const parsed = parseWeekKey("2027-W01");
    expect(parsed?.start).toBe("2027-01-04");
  });

  it("2026-W35 has the expected key, start, and 7 days Mon..Sun", () => {
    const parsed = parseWeekKey("2026-W35");
    expect(parsed).not.toBeNull();
    expect(parsed?.key).toBe("2026-W35");
    expect(parsed?.days[0]).toBe("2026-08-24");
    expect(parsed?.days[6]).toBe("2026-08-30");
    expect(parsed?.days).toHaveLength(7);
    expect(parsed?.days).toEqual([
      "2026-08-24",
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
      "2026-08-28",
      "2026-08-29",
      "2026-08-30",
    ]);
  });

  it("returns null for a week that does not exist in a 52-week ISO year (2025-W53)", () => {
    expect(parseWeekKey("2025-W53")).toBeNull();
  });

  it("returns null for week 00", () => {
    expect(parseWeekKey("2026-W00")).toBeNull();
  });

  it("returns null for week 54", () => {
    expect(parseWeekKey("2026-W54")).toBeNull();
  });

  it("returns null for a malformed key", () => {
    expect(parseWeekKey("2026-35")).toBeNull();
    expect(parseWeekKey("not-a-week")).toBeNull();
    expect(parseWeekKey("")).toBeNull();
  });
});

describe("weekKeyOf", () => {
  it("2026-01-01 is in week 2026-W01", () => {
    expect(weekKeyOf("2026-01-01")).toBe("2026-W01");
  });

  it("2027-01-01 is in week 2026-W53 (the year-boundary week)", () => {
    expect(weekKeyOf("2027-01-01")).toBe("2026-W53");
  });

  it("2026-08-28 is in week 2026-W35", () => {
    expect(weekKeyOf("2026-08-28")).toBe("2026-W35");
  });

  it("throws on an invalid day string", () => {
    expect(() => weekKeyOf("not-a-day")).toThrow();
    expect(() => weekKeyOf("2026-02-30")).toThrow();
  });
});

describe("isMonday", () => {
  it("true for a known Monday", () => {
    expect(isMonday("2026-08-24")).toBe(true);
  });

  it("false for a known non-Monday", () => {
    expect(isMonday("2026-08-25")).toBe(false);
    expect(isMonday("2026-08-30")).toBe(false);
  });

  it("throws on an invalid day string", () => {
    expect(() => isMonday("not-a-day")).toThrow();
  });
});
