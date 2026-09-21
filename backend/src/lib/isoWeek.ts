// ISO 8601 week helpers — pure UTC arithmetic, no dependency. Shared by the
// Daily Review route (GET /daily-review's `week` param) and the weekly
// update routes (`weekStart` must be a Monday). ISO weeks run Monday..Sunday
// and week 1 of an ISO year is the week containing that year's first
// Thursday (equivalently: the week containing 4 January). Some ISO years
// have 53 weeks (2026 is one) rather than 52 — validity of a given
// "<year>-W<week>" key is decided by round-tripping the computed Monday
// back through the same algorithm, rather than hard-coding the 52/53 rule.
//
// Every "yyyy-MM-dd" day-string argument here must already be
// `isValidDayString`-validated by the caller (routes validate via Zod
// before calling in); `weekKeyOf`/`isMonday` throw on an invalid one rather
// than returning a sentinel, since a malformed day is a caller bug, not
// user input to reject gracefully — `parseWeekKey` returns null instead,
// since a malformed *week key* often is user-facing (a URL query param).

import { isValidDayString } from "./dateBoundary.js";

const WEEK_KEY_RE = /^(\d{4})-W(\d{2})$/;

export interface ParsedWeek {
  key: string;
  /** ISO Monday of the week, as "yyyy-MM-dd". */
  start: string;
  /** The 7 day strings of the week, Monday..Sunday. */
  days: string[];
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** "yyyy-MM-dd" for a UTC-midnight Date. */
function toDay(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** UTC-midnight Date for an already-validated "yyyy-MM-dd" day string. */
function fromDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** ISO weekday of a UTC-midnight Date: Monday=1 .. Sunday=7. */
function isoWeekday(d: Date): number {
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  return dow === 0 ? 7 : dow;
}

/** Monday (UTC midnight) of the ISO week containing `d`. */
function isoWeekMonday(d: Date): Date {
  const monday = new Date(d.getTime());
  monday.setUTCDate(monday.getUTCDate() - (isoWeekday(d) - 1));
  return monday;
}

/** Monday (UTC midnight) of ISO week 1 of ISO year `year` (the week containing 4 January). */
function isoWeek1Monday(year: number): Date {
  return isoWeekMonday(new Date(Date.UTC(year, 0, 4)));
}

/**
 * ISO week key ("yyyy-Www") of a "yyyy-MM-dd" day string. Throws on a
 * malformed or calendrically-invalid day string.
 */
export function weekKeyOf(day: string): string {
  if (!isValidDayString(day)) {
    throw new Error(`invalid day string: ${day}`);
  }
  const monday = isoWeekMonday(fromDay(day));
  // The ISO year is the calendar year of the Thursday in this week.
  const thursday = new Date(monday.getTime());
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const isoYear = thursday.getUTCFullYear();
  const week1Monday = isoWeek1Monday(isoYear);
  const weekNum =
    Math.round((monday.getTime() - week1Monday.getTime()) / (7 * 86_400_000)) + 1;
  return `${isoYear}-W${pad2(weekNum)}`;
}

/**
 * Parses an ISO week key like "2026-W35" into its Monday `start` and the 7
 * day strings of the week. Returns null for a malformed key or a week
 * number that does not exist in that ISO year (most years have 52 ISO
 * weeks, some — like 2026 — have 53).
 */
export function parseWeekKey(key: string): ParsedWeek | null {
  const match = WEEK_KEY_RE.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (week < 1 || week > 53) return null;

  const start = new Date(isoWeek1Monday(year).getTime());
  start.setUTCDate(start.getUTCDate() + (week - 1) * 7);
  const startDay = toDay(start);

  // Round-trip: recomputing the week key from `start` must give back `key`.
  // This is what catches an out-of-range week (e.g. 2025-W53, since 2025
  // has only 52 ISO weeks) without hard-coding the 52/53-week rule.
  if (weekKeyOf(startDay) !== key) return null;

  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getTime());
    d.setUTCDate(d.getUTCDate() + i);
    days.push(toDay(d));
  }
  return { key, start: startDay, days };
}

/** True if `day` (a "yyyy-MM-dd" string) is an ISO Monday. Throws on an invalid day string. */
export function isMonday(day: string): boolean {
  if (!isValidDayString(day)) {
    throw new Error(`invalid day string: ${day}`);
  }
  return fromDay(day).getUTCDay() === 1;
}
