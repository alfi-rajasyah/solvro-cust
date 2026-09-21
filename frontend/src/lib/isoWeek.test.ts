import { describe, expect, it } from "vitest";
import { formatWeekRange, isMonday, parseWeekKey, shiftWeek, weekKeyOf } from "./isoWeek";

/**
 * Timezone-independence note: this suite must stay green under `TZ=UTC`,
 * `TZ=Asia/Jakarta` (positive/east-of-UTC offset), AND
 * `TZ=America/Los_Angeles` (negative/west-of-UTC offset — the zone that
 * actually exercises the drift this module's top comment warns about: a
 * date-fns local-calendar-day ISO-week implementation can disagree with the
 * backend's pure-UTC one right at a week/year boundary in a negative-offset
 * zone). Every function here is pure UTC (`Date.UTC`/`getUTC*` only), so
 * none of the assertions below should move under any of the three.
 *
 * Fixtures mirror backend/test/isoWeek.test.ts exactly for the shared API
 * (parseWeekKey/weekKeyOf/isMonday) — output must be byte-identical to the
 * backend module for these cases.
 */
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

describe("shiftWeek", () => {
  it("shifts back a week across a year boundary: 2026-W01 -> 2025-W52", () => {
    expect(shiftWeek("2026-W01", -1)).toBe("2025-W52");
  });

  it("shifts forward a week across a year boundary: 2026-W53 -> 2027-W01", () => {
    expect(shiftWeek("2026-W53", 1)).toBe("2027-W01");
  });

  it("shifts forward within a year: 2026-W35 -> 2026-W36", () => {
    expect(shiftWeek("2026-W35", 1)).toBe("2026-W36");
  });

  it("shifts back within a year: 2026-W35 -> 2026-W34", () => {
    expect(shiftWeek("2026-W35", -1)).toBe("2026-W34");
  });

  it("a zero delta returns the same key", () => {
    expect(shiftWeek("2026-W35", 0)).toBe("2026-W35");
  });

  it("a multi-week delta composes the same as repeated single shifts", () => {
    expect(shiftWeek("2026-W35", 5)).toBe("2026-W40");
    expect(shiftWeek("2026-W40", -5)).toBe("2026-W35");
  });

  it("throws on an invalid week key", () => {
    expect(() => shiftWeek("2025-W53", 1)).toThrow();
    expect(() => shiftWeek("not-a-week", 1)).toThrow();
  });
});

describe("formatWeekRange", () => {
  it("same month, same year: 2026-W35 -> \"24 – 30 Aug\"", () => {
    expect(formatWeekRange("2026-W35")).toBe("24 – 30 Aug");
  });

  it("month-crossing, same year: 2026-W40 -> \"28 Sep – 4 Oct\"", () => {
    // 2026-W40's Monday is 2026-09-28 (5 weeks after W35's 2026-08-24);
    // its Sunday is 2026-10-04.
    const parsed = parseWeekKey("2026-W40");
    expect(parsed?.start).toBe("2026-09-28");
    expect(parsed?.days[6]).toBe("2026-10-04");
    expect(formatWeekRange("2026-W40")).toBe("28 Sep – 4 Oct");
  });

  it("year-crossing: 2026-W01 -> \"29 Dec 2025 – 4 Jan 2026\"", () => {
    expect(formatWeekRange("2026-W01")).toBe("29 Dec 2025 – 4 Jan 2026");
  });

  it("throws on an invalid week key", () => {
    expect(() => formatWeekRange("2025-W53")).toThrow();
    expect(() => formatWeekRange("not-a-week")).toThrow();
  });
});
