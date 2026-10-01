import { describe, expect, it } from "vitest";
import { fmtDateRangeDDMM } from "@/lib/gantt/geometry";
import { isTaskOverdue } from "./TreeCells";

/**
 * Gantt visual refresh, T2 — the Gantt tree's Dates column goes
 * `text-error` only when a task is both open (`status !== "DONE"`) and past
 * due, compared as CALENDAR DAYS (never an ISO-instant compare — frontend/
 * CLAUDE.md's date contract). `isTaskOverdue` is the pure predicate backing
 * that cell (TreeCells.tsx's `TaskDatesCell`), split out so it's testable
 * without rendering — same convention as `lib/gantt/palette.test.ts` and
 * `kanban-v2/adapter.test.ts` (pure-function tests over pure JSX-adjacent
 * logic).
 *
 * `todayDay` is passed in as a plain "yyyy-MM-dd" string rather than derived
 * from `new Date()` inside the test — the same shape the call site
 * (`dateToDay(new Date())`) produces, and what keeps these cases
 * deterministic regardless of the machine's wall-clock date.
 */
describe("isTaskOverdue", () => {
  const TODAY = "2026-08-03";

  it("is overdue: open task, due date before today", () => {
    expect(isTaskOverdue("TODO", "2026-08-02T00:00:00.000Z", TODAY)).toBe(true);
    expect(isTaskOverdue("IN_PROGRESS", "2026-01-01T00:00:00.000Z", TODAY)).toBe(true);
  });

  it("is NOT overdue: due date is today (strictly before, not on-or-before)", () => {
    expect(isTaskOverdue("TODO", "2026-08-03T00:00:00.000Z", TODAY)).toBe(false);
  });

  it("is NOT overdue: due date is in the future", () => {
    expect(isTaskOverdue("TODO", "2026-08-04T00:00:00.000Z", TODAY)).toBe(false);
  });

  it("is NEVER overdue once DONE, regardless of how far in the past the due date is", () => {
    expect(isTaskOverdue("DONE", "2020-01-01T00:00:00.000Z", TODAY)).toBe(false);
  });

  it("is not overdue with no due date", () => {
    expect(isTaskOverdue("TODO", null, TODAY)).toBe(false);
    expect(isTaskOverdue("IN_PROGRESS", null, TODAY)).toBe(false);
  });

  it("is not overdue when today's day string is unavailable (defensive null guard)", () => {
    expect(isTaskOverdue("TODO", "2020-01-01T00:00:00.000Z", null)).toBe(false);
  });

  it("compares the UTC calendar-day part of the ISO instant, not the full timestamp", () => {
    // A due instant late in the UTC day before "today" is still simply
    // "yesterday" under the calendar-day contract — not "almost today".
    expect(isTaskOverdue("TODO", "2026-08-02T23:59:59.999Z", TODAY)).toBe(true);
    // Conversely, a due instant at the very start of "today" (UTC midnight)
    // reads as due TODAY, not overdue — same boundary case
    // `pages/views/ProjectTimeline.tsx`'s TaskTimelineItem and
    // `lib/export/projectExport.test.ts`'s overdue-boundary suite guard.
    expect(isTaskOverdue("TODO", "2026-08-03T00:00:00.000Z", TODAY)).toBe(false);
  });
});

/**
 * The Dates column text comes from `fmtDateRangeDDMM`, which delegates to the
 * shared `fmtDay` / `fmtRange` (day first, no zero padding, en-GB months). The
 * inputs are LOCAL-midnight Dates (what `dayToDate` hands back), and dates in
 * the current year carry no year suffix.
 */
describe("fmtDateRangeDDMM", () => {
  const Y = new Date().getFullYear();
  const at = (m: number, d: number) => new Date(Y, m, d);

  it("collapses a same-day range to a single day, unpadded", () => {
    expect(fmtDateRangeDDMM(at(7, 21), at(7, 21))).toBe("21 Aug");
    expect(fmtDateRangeDDMM(at(7, 5), at(7, 5))).toBe("5 Aug");
  });

  it("writes a same-month range with the month once", () => {
    expect(fmtDateRangeDDMM(at(7, 22), at(7, 28))).toBe("22 \u2013 28 Aug");
  });

  it("writes a cross-month range with both months", () => {
    expect(fmtDateRangeDDMM(at(8, 28), at(9, 4))).toBe("28 Sep \u2013 4 Oct");
  });

  it("labels a half-open range", () => {
    expect(fmtDateRangeDDMM(at(7, 21), null)).toBe("From 21 Aug");
    expect(fmtDateRangeDDMM(null, at(7, 28))).toBe("Until 28 Aug");
  });

  it("says so when neither date is set", () => {
    expect(fmtDateRangeDDMM(null, null)).toBe("No dates");
  });
});
