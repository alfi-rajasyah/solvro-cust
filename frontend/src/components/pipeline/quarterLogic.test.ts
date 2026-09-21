import { describe, expect, it } from "vitest";
import { getQuarterId, groupByQuarter, QUARTER_ORDER } from "./quarterLogic";

const YEAR = 2026;

describe("getQuarterId", () => {
  it("buckets a null request date into OTHER", () => {
    expect(getQuarterId(null, YEAR)).toBe("OTHER");
  });

  it("buckets every month of the current year into its quarter (month→quarter map)", () => {
    const expected: Record<number, string> = {
      1: "Q1",
      2: "Q1",
      3: "Q1",
      4: "Q2",
      5: "Q2",
      6: "Q2",
      7: "Q3",
      8: "Q3",
      9: "Q3",
      10: "Q4",
      11: "Q4",
      12: "Q4",
    };
    for (const [month, quarter] of Object.entries(expected)) {
      const mm = month.padStart(2, "0");
      expect(getQuarterId(`${YEAR}-${mm}-15`, YEAR)).toBe(quarter);
    }
  });

  it("buckets a date from a PAST year into OTHER (year boundary)", () => {
    expect(getQuarterId(`${YEAR - 1}-06-15`, YEAR)).toBe("OTHER");
  });

  it("buckets a date from a FUTURE year into OTHER (year boundary)", () => {
    expect(getQuarterId(`${YEAR + 1}-01-01`, YEAR)).toBe("OTHER");
  });

  it("buckets the last day of the current year into Q4", () => {
    expect(getQuarterId(`${YEAR}-12-31`, YEAR)).toBe("Q4");
  });

  it("buckets the first day of the current year into Q1", () => {
    expect(getQuarterId(`${YEAR}-01-01`, YEAR)).toBe("Q1");
  });

  it("is not fooled by a UTC-shift-prone date (never parses via `new Date(string)`)", () => {
    // A naive `new Date("2026-01-01")` is UTC midnight, which east-of-UTC
    // hosts read back as Dec 31 local — if this function ever regressed to
    // that, the boundary tests above would still pass (Dec 31 is still
    // Q4/current-year-ish) but this explicit case pins day-31 specifically.
    expect(getQuarterId(`${YEAR}-01-31`, YEAR)).toBe("Q1");
    expect(getQuarterId(`${YEAR}-04-30`, YEAR)).toBe("Q2");
  });

  it("buckets an unparsable string into OTHER defensively", () => {
    expect(getQuarterId("not-a-date", YEAR)).toBe("OTHER");
    expect(getQuarterId("", YEAR)).toBe("OTHER");
  });
});

describe("groupByQuarter", () => {
  function deal(id: string, requestDate: string | null) {
    return { id, requestDate };
  }

  it("always returns all 5 buckets, in QUARTER_ORDER, even when empty", () => {
    const grouped = groupByQuarter([], YEAR);
    expect(Object.keys(grouped)).toEqual(QUARTER_ORDER);
    for (const id of QUARTER_ORDER) {
      expect(grouped[id]).toEqual([]);
    }
  });

  it("groups a mixed list of deals: quarters, null dates, and other years", () => {
    const deals = [
      deal("q1-deal", `${YEAR}-02-10`),
      deal("q4-deal", `${YEAR}-11-05`),
      deal("no-date-deal", null),
      deal("past-year-deal", `${YEAR - 1}-06-01`),
      deal("future-year-deal", `${YEAR + 1}-03-01`),
    ];

    const grouped = groupByQuarter(deals, YEAR);

    expect(grouped.Q1.map((d) => d.id)).toEqual(["q1-deal"]);
    expect(grouped.Q2).toEqual([]);
    expect(grouped.Q3).toEqual([]);
    expect(grouped.Q4.map((d) => d.id)).toEqual(["q4-deal"]);
    // Null-date and other-year deals share the SAME OTHER bucket, input order preserved.
    expect(grouped.OTHER.map((d) => d.id)).toEqual([
      "no-date-deal",
      "past-year-deal",
      "future-year-deal",
    ]);
  });

  it("preserves input order within a bucket and does not mutate the input array", () => {
    const deals = [deal("b", `${YEAR}-05-01`), deal("a", `${YEAR}-04-01`)];
    const snapshot = [...deals];

    const grouped = groupByQuarter(deals, YEAR);

    expect(grouped.Q2.map((d) => d.id)).toEqual(["b", "a"]);
    expect(deals).toEqual(snapshot);
  });
});
