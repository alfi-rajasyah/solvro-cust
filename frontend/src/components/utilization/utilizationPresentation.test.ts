import { describe, expect, it } from "vitest";
import { dayHeaders, formatHours, isOutsideSyncWindow, utilisationPct } from "./utilizationPresentation";

describe("formatHours", () => {
  it("formats a positive value to one decimal", () => {
    expect(formatHours(2.5)).toBe("2.5");
    expect(formatHours(13)).toBe("13.0");
    expect(formatHours(0.25)).toBe("0.3");
  });

  it("renders zero as an en dash", () => {
    expect(formatHours(0)).toBe("–");
  });
});

describe("utilisationPct", () => {
  it("computes a plain percentage under capacity", () => {
    expect(utilisationPct(20, 40)).toBe(50);
  });

  it("caps at 100 when logged exceeds capacity", () => {
    expect(utilisationPct(50, 40)).toBe(100);
  });

  it("returns 0 when capacity is zero or negative", () => {
    expect(utilisationPct(10, 0)).toBe(0);
    expect(utilisationPct(10, -5)).toBe(0);
  });

  it("returns 0 for zero logged hours", () => {
    expect(utilisationPct(0, 40)).toBe(0);
  });
});

describe("dayHeaders", () => {
  it("labels each of the 7 days with its weekday abbreviation and day number", () => {
    const days = ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"];
    expect(dayHeaders(days)).toEqual(["Mon 7", "Tue 8", "Wed 9", "Thu 10", "Fri 11", "Sat 12", "Sun 13"]);
  });

  it("pads nothing — single and double digit days both render bare", () => {
    expect(dayHeaders(["2026-09-01"])).toEqual(["Mon 1"]);
    expect(dayHeaders(["2026-09-30"])[0]).toBe("Mon 30");
  });
});

describe("isOutsideSyncWindow", () => {
  const now = new Date("2026-09-22T00:00:00.000Z");

  it("is false for the current week", () => {
    expect(isOutsideSyncWindow("2026-09-21", now)).toBe(false);
  });

  it("is false exactly at the 8-week boundary", () => {
    // 8 weeks = 56 days before `now`, so this is the cutoff itself — not
    // strictly older than the window yet.
    expect(isOutsideSyncWindow("2026-07-28", now)).toBe(false);
  });

  it("is true one day past the 8-week boundary", () => {
    expect(isOutsideSyncWindow("2026-07-27", now)).toBe(true);
  });

  it("is true for a week older than the 8-week sync window", () => {
    expect(isOutsideSyncWindow("2026-07-20", now)).toBe(true);
  });

  it("is true for a week far in the past", () => {
    expect(isOutsideSyncWindow("2025-01-06", now)).toBe(true);
  });
});
