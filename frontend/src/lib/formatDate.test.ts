import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatWeekRange, parseWeekKey } from "./isoWeek";
import { dueDateLabel } from "./dailyReviewStats";
import {
  MONTH_ABBR,
  MONTH_NAMES,
  fmtAgo,
  fmtDateTime,
  fmtDay,
  fmtDayFull,
  fmtDayLong,
  fmtDue,
  fmtRange,
  fmtTime,
  fmtWeek,
} from "./formatDate";

// "Now" for the whole suite: 29 Sep 2026, midday UTC.
const NOW = new Date("2026-09-29T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("month names", () => {
  it("shares one list; abbreviations are derived", () => {
    expect(MONTH_NAMES).toHaveLength(12);
    expect(MONTH_ABBR).toEqual([
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ]);
  });
});

describe("fmtDay", () => {
  it("drops the year in the current year", () => {
    expect(fmtDay("2026-08-21")).toBe("21 Aug");
    expect(fmtDay("2026-09-28T00:00:00.000Z")).toBe("28 Sep");
  });
  it("adds the year when not the current year", () => {
    expect(fmtDay("2025-08-21")).toBe("21 Aug 2025");
    expect(fmtDay("2027-01-04T00:00:00.000Z")).toBe("4 Jan 2027");
  });
  it("returns empty for null, undefined, or junk", () => {
    expect(fmtDay(null)).toBe("");
    expect(fmtDay(undefined)).toBe("");
    expect(fmtDay("")).toBe("");
    expect(fmtDay("not-a-date")).toBe("");
    expect(fmtDay("2026-02-30")).toBe("");
  });
});

describe("fmtDayFull", () => {
  it("always shows the year", () => {
    expect(fmtDayFull("2026-08-21")).toBe("21 Aug 2026");
    expect(fmtDayFull("2025-12-29T00:00:00.000Z")).toBe("29 Dec 2025");
    expect(fmtDayFull(null)).toBe("");
  });
});

describe("fmtDayLong", () => {
  it("spells weekday and month out", () => {
    expect(fmtDayLong("2026-09-28")).toBe("Monday 28 September 2026");
    expect(fmtDayLong("2026-01-04T00:00:00.000Z")).toBe("Sunday 4 January 2026");
    expect(fmtDayLong(undefined)).toBe("");
  });
});

describe("fmtRange", () => {
  it("same month", () => {
    expect(fmtRange("2026-08-22", "2026-08-28")).toBe("22 – 28 Aug");
  });
  it("cross month", () => {
    expect(fmtRange("2026-09-28", "2026-10-04")).toBe("28 Sep – 4 Oct");
  });
  it("cross year", () => {
    expect(fmtRange("2025-12-29", "2026-01-04")).toBe("29 Dec 2025 – 4 Jan 2026");
  });
  it("same day", () => {
    expect(fmtRange("2026-08-21", "2026-08-21")).toBe("21 Aug");
    expect(fmtRange("2026-08-21T00:00:00.000Z", "2026-08-21")).toBe("21 Aug");
    expect(fmtRange("2025-08-21", "2025-08-21")).toBe("21 Aug 2025");
  });
  it("one-sided and empty", () => {
    expect(fmtRange("2026-08-21", null)).toBe("From 21 Aug");
    expect(fmtRange(null, "2026-08-28")).toBe("Until 28 Aug");
    expect(fmtRange(null, null)).toBe("No dates");
    expect(fmtRange(undefined, undefined)).toBe("No dates");
  });
  it("adds the year to the end of a same-year range outside the current year", () => {
    expect(fmtRange("2027-03-03", "2027-04-20")).toBe("3 Mar – 20 Apr 2027");
    expect(fmtRange("2027-03-03", "2027-03-20")).toBe("3 – 20 Mar 2027");
    expect(fmtRange("2025-08-22", "2025-08-28")).toBe("22 – 28 Aug 2025");
  });
  it("keeps the current-year and cross-year forms unchanged", () => {
    expect(fmtRange("2026-03-03", "2026-04-20")).toBe("3 Mar – 20 Apr");
    expect(fmtRange("2026-12-29", "2027-01-04")).toBe("29 Dec 2026 – 4 Jan 2027");
  });
  it("accepts ISO instants", () => {
    expect(fmtRange("2026-08-22T00:00:00.000Z", "2026-08-28T00:00:00.000Z")).toBe("22 – 28 Aug");
  });
});

describe("fmtDue", () => {
  const today = "2026-09-29";
  it("Today / Tomorrow", () => {
    expect(fmtDue("2026-09-29", today)).toBe("Today");
    expect(fmtDue("2026-09-30", today)).toBe("Tomorrow");
  });
  it("overdue", () => {
    expect(fmtDue("2026-09-28", today)).toBe("1d late");
    expect(fmtDue("2026-09-23", today)).toBe("6d late");
  });
  it("later dates fall back to fmtDay", () => {
    expect(fmtDue("2026-10-05", today)).toBe("5 Oct");
    expect(fmtDue("2027-01-05", today)).toBe("5 Jan 2027");
  });
  it("matches dueDateLabel for plain future dates", () => {
    for (const iso of ["2026-10-05T00:00:00.000Z", "2026-12-24T00:00:00.000Z"]) {
      expect(fmtDue(iso, today)).toBe(dueDateLabel(iso));
    }
  });
  it("accepts a Date or ISO for today, defaults to now", () => {
    expect(fmtDue("2026-09-29", new Date(2026, 8, 29, 10, 0))).toBe("Today");
    expect(fmtDue("2026-09-29", "2026-09-29T00:00:00.000Z")).toBe("Today");
    expect(fmtDue("2026-09-30")).toBe("Tomorrow");
  });
  it("returns empty for null", () => {
    expect(fmtDue(null, today)).toBe("");
    expect(fmtDue(undefined, today)).toBe("");
  });
});

describe("fmtWeek", () => {
  it("same month, cross month, cross year", () => {
    expect(fmtWeek("2026-08-24")).toBe("24 – 30 Aug");
    expect(fmtWeek("2026-09-28")).toBe("28 Sep – 4 Oct");
    expect(fmtWeek("2025-12-29")).toBe("29 Dec 2025 – 4 Jan 2026");
  });
  it("keeps formatWeekRange output outside the current year (no trailing year)", () => {
    expect(fmtWeek("2027-03-01")).toBe("1 – 7 Mar");
    expect(fmtWeek("2025-08-25")).toBe("25 – 31 Aug");
  });
  it("matches formatWeekRange for every week of 2025-2027", () => {
    for (const year of [2025, 2026, 2027]) {
      for (let w = 1; w <= 53; w++) {
        const key = `${year}-W${String(w).padStart(2, "0")}`;
        const parsed = parseWeekKey(key);
        if (!parsed) continue;
        expect(fmtWeek(parsed.start)).toBe(formatWeekRange(key));
      }
    }
  });
  it("returns empty for null", () => {
    expect(fmtWeek(null)).toBe("");
  });
});

describe("fmtTime", () => {
  it("is 24-hour HH:mm with two-digit hours, in local time", () => {
    vi.stubEnv("TZ", "UTC");
    expect(fmtTime("2026-09-28T14:22:00.000Z")).toBe("14:22");
    expect(fmtTime("2026-09-28T02:05:00.000Z")).toBe("02:05");
    expect(fmtTime("2026-09-28T00:00:00.000Z")).toBe("00:00");
    vi.stubEnv("TZ", "Asia/Jakarta");
    expect(fmtTime("2026-09-28T14:22:00.000Z")).toBe("21:22");
  });
  it("returns empty for null or junk", () => {
    expect(fmtTime(null)).toBe("");
    expect(fmtTime(undefined)).toBe("");
    expect(fmtTime("nope")).toBe("");
  });
});

describe("fmtDateTime", () => {
  it("day first, 24-hour, local time", () => {
    vi.stubEnv("TZ", "UTC");
    expect(fmtDateTime("2026-09-28T14:22:00.000Z")).toBe("28 Sep, 14:22");
    expect(fmtDateTime("2026-09-28T02:05:00.000Z")).toBe("28 Sep, 02:05");
  });
  it("adds the year outside the current year", () => {
    vi.stubEnv("TZ", "UTC");
    expect(fmtDateTime("2025-12-31T23:59:00.000Z")).toBe("31 Dec 2025, 23:59");
  });
  it("returns empty for null or junk", () => {
    expect(fmtDateTime(null)).toBe("");
    expect(fmtDateTime(undefined)).toBe("");
    expect(fmtDateTime("nope")).toBe("");
  });
});

describe("fmtAgo", () => {
  const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
  it("just now", () => {
    expect(fmtAgo(ago(20_000), NOW)).toBe("just now");
    expect(fmtAgo(ago(-60_000), NOW)).toBe("just now");
  });
  it("minutes, hours, days", () => {
    expect(fmtAgo(ago(5 * 60_000), NOW)).toBe("5 min ago");
    expect(fmtAgo(ago(3 * 3_600_000), NOW)).toBe("3 h ago");
    expect(fmtAgo(ago(2 * 86_400_000), NOW)).toBe("2 d ago");
  });
  it("falls back to fmtDay from a week on", () => {
    vi.stubEnv("TZ", "UTC");
    expect(fmtAgo("2026-09-10T09:00:00.000Z", NOW)).toBe("10 Sep");
    expect(fmtAgo("2025-09-10T09:00:00.000Z", NOW)).toBe("10 Sep 2025");
  });
  it("defaults now to the current clock", () => {
    expect(fmtAgo(ago(5 * 60_000))).toBe("5 min ago");
  });
  it("returns empty for null", () => {
    expect(fmtAgo(null, NOW)).toBe("");
  });
});

describe.each(["UTC", "Asia/Jakarta", "America/Los_Angeles"])("TZ=%s", (tz) => {
  beforeEach(() => {
    vi.stubEnv("TZ", tz);
  });

  it("day values never shift a day", () => {
    const iso = "2026-09-28T00:00:00.000Z";
    expect(fmtDay(iso)).toBe("28 Sep");
    expect(fmtDay("2026-09-28")).toBe("28 Sep");
    expect(fmtDayFull(iso)).toBe("28 Sep 2026");
    expect(fmtDayLong(iso)).toBe("Monday 28 September 2026");
    expect(fmtRange(iso, "2026-10-04T00:00:00.000Z")).toBe("28 Sep – 4 Oct");
    expect(fmtRange("2025-12-29T00:00:00.000Z", "2026-01-04T00:00:00.000Z")).toBe(
      "29 Dec 2025 – 4 Jan 2026",
    );
    expect(fmtWeek("2026-09-28")).toBe("28 Sep – 4 Oct");
    expect(fmtDue("2026-09-29T00:00:00.000Z", "2026-09-29")).toBe("Today");
    expect(fmtDue("2026-09-30T00:00:00.000Z", "2026-09-29")).toBe("Tomorrow");
  });

  it("timestamps use the local wall clock", () => {
    const ts = "2026-09-28T14:22:00.000Z";
    const expected: Record<string, string> = {
      UTC: "28 Sep, 14:22",
      "Asia/Jakarta": "28 Sep, 21:22", // UTC+7
      "America/Los_Angeles": "28 Sep, 07:22", // UTC-7 (PDT)
    };
    expect(fmtDateTime(ts)).toBe(expected[tz]);
  });

  it("a timestamp near midnight lands on the local day", () => {
    const ts = "2026-09-28T20:00:00.000Z"; // Jakarta is already 29 Sep, LA still 28 Sep
    const expected: Record<string, string> = {
      UTC: "28 Sep, 20:00",
      "Asia/Jakarta": "29 Sep, 03:00",
      "America/Los_Angeles": "28 Sep, 13:00",
    };
    expect(fmtDateTime(ts)).toBe(expected[tz]);
  });
});
