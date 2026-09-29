// ISO 8601 week helpers — pure UTC arithmetic, no dependency. Ported from
// `backend/src/lib/isoWeek.ts` (same API: `parseWeekKey`, `weekKeyOf`,
// `isMonday`), extended with the two frontend-only helpers the Daily Review
// page needs (`shiftWeek`, `formatWeekRange`). ISO weeks run Monday..Sunday
// and week 1 of an ISO year is the week containing that year's first
// Thursday (equivalently: the week containing 4 January). Some ISO years
// have 53 weeks (2026 is one) rather than 52 — validity of a given
// "<year>-W<week>" key is decided by round-tripping the computed Monday back
// through the same algorithm, rather than hard-coding the 52/53 rule.
//
// Deliberately NOT date-fns, unlike the rest of this app's date handling:
// date-fns' `startOfISOWeek`/`getISOWeek`/`getISOWeekYear` derive the ISO
// week from the Date's LOCAL calendar fields, which drifts a week at
// ISO-year/week boundaries in a negative-UTC-offset zone (e.g.
// America/Los_Angeles, where local midnight of a UTC day-string can still be
// the previous UTC day). Every function here uses `Date.UTC`/`getUTC*`
// exclusively instead, so results are identical in every host timezone and
// byte-identical to the backend module for the fixtures they share.
//
// Every "yyyy-MM-dd" day-string argument here is expected to be a valid
// calendar day; `weekKeyOf`/`isMonday`/`shiftWeek`/`formatWeekRange` throw on
// a malformed one rather than returning a sentinel (same split as the
// backend module: a malformed day is a caller bug, a malformed *week key* is
// often user-facing, hence `parseWeekKey` returning null instead).
//
// Contract: every day-string argument here MUST already be a bare
// "yyyy-MM-dd" string — never a raw API value. The Daily Review payload's
// `@db.Date` fields (`week.start`, `week.days[]`, `noteDate`, `weekStart`,
// ...) round-trip as ISO instants (`"2026-08-24T00:00:00.000Z"`) over the
// wire; a caller reading one of those into a day string first runs it
// through `dayFromIso` (dateField.ts) — this module never does that
// conversion itself, and passing a raw instant through unconverted will
// either throw (`weekKeyOf`/`isMonday`, whose day-regex rejects the extra
// characters) or, for `parseWeekKey`'s `key` argument, simply never match a
// valid week key shape.

import { fmtWeek } from "./formatDate";

const WEEK_KEY_RE = /^(\d{4})-W(\d{2})$/;
const DAY_STRING_RE = /^\d{4}-\d{2}-\d{2}$/;

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

/**
 * True for a syntactically- and calendrically-valid "yyyy-MM-dd" day
 * string — mirrors `backend/src/lib/dateBoundary.ts`'s `isValidDayString`.
 * Round-trips through `Date` rather than trusting a bare `Number.isNaN`
 * check: `new Date("2026-02-30T00:00:00.000Z")` silently rolls over to
 * March 2 instead of producing an Invalid Date (JS Date's day-of-month
 * leniency), so a day whose parsed instant doesn't slice back to the exact
 * input is rejected too.
 */
function isValidDayString(day: string): boolean {
  if (!DAY_STRING_RE.test(day)) return false;
  const d = fromDay(day);
  if (Number.isNaN(d.getTime())) return false;
  return toDay(d) === day;
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

/**
 * Shifts `key` by `delta` ISO weeks (negative moves back). Throws on an
 * invalid `key`. Used by the Daily Review page's Prev/Next week buttons.
 */
export function shiftWeek(key: string, delta: number): string {
  const parsed = parseWeekKey(key);
  if (!parsed) {
    throw new Error(`invalid week key: ${key}`);
  }
  const shifted = new Date(fromDay(parsed.start).getTime() + delta * 7 * 86_400_000);
  return weekKeyOf(toDay(shifted));
}

/**
 * Human-readable week range for the header/day-strip, e.g. `"24 – 30 Aug"`.
 * Crosses a month boundary → `"28 Sep – 4 Oct"`; crosses a year boundary →
 * `"29 Dec 2025 – 4 Jan 2026"`. Throws on an invalid `key`. Pure UTC — reads
 * `parseWeekKey`'s `start`/`days[6]` day strings, never a `new Date()` of
 * the caller's local clock.
 */
export function formatWeekRange(key: string): string {
  const parsed = parseWeekKey(key);
  if (!parsed) {
    throw new Error(`invalid week key: ${key}`);
  }
  return fmtWeek(parsed.start);
}
