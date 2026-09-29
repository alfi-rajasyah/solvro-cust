import { dayFromIso } from "@/lib/dateField";
import type { TaskStatus } from "@/lib/queries";

/**
 * The single date formatter for display text. Day first, `en-GB` style, 24-hour
 * time. Hand-formatted from numeric parts (no `Intl` / `toLocaleDateString`) so
 * the output is identical in every host locale and ICU build.
 *
 * Two kinds of input, two time-zone rules:
 * - DAY values (`"yyyy-MM-dd"`, or an ISO instant stored as UTC midnight) name
 *   a calendar day, so they are read in UTC via `dayFromIso` (the UTC date
 *   part) and never shift a day west or east of Greenwich.
 * - TIMESTAMPS (`fmtDateTime`, `fmtAgo`) are real instants and are shown in the
 *   viewer's local time.
 *
 * Null / undefined / unparsable input returns `""` (`fmtRange` returns
 * `"No dates"` when both ends are missing).
 */

/** Long month names, Jan..Dec — the one shared month list. */
export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** Three-letter month abbreviations derived from `MONTH_NAMES` ("Sep", not "Sept"). */
export const MONTH_ABBR: readonly string[] = MONTH_NAMES.map((m) => m.slice(0, 3));

const WEEKDAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const;

const DAY_MS = 86_400_000;

type DayValue = string | null | undefined;

interface Ymd {
  y: number;
  /** 0-based month. */
  m: number;
  d: number;
}

/** Parses a day string or ISO instant into UTC calendar parts, or null. */
function parseDay(v: DayValue): Ymd | null {
  const day = dayFromIso(v ?? null);
  if (!day) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]) - 1;
  const d = Number(match[3]);
  // Reject rolled-over days (e.g. 2026-02-30).
  const probe = new Date(Date.UTC(y, m, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m || probe.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d };
}

/** Local-time calendar parts of an instant (for timestamps). */
function localYmd(date: Date): Ymd {
  return { y: date.getFullYear(), m: date.getMonth(), d: date.getDate() };
}

function currentYear(now?: Date): number {
  return (now ?? new Date()).getFullYear();
}

function dayNumber(p: Ymd): number {
  return Math.round(Date.UTC(p.y, p.m, p.d) / DAY_MS);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** "21 Aug", or "21 Aug 2025" when the year differs from `year`. */
function shortDay(p: Ymd, year: number): string {
  const base = `${p.d} ${MONTH_ABBR[p.m]}`;
  return p.y === year ? base : `${base} ${p.y}`;
}

function parseTimestamp(ts: string | null | undefined): Date | null {
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `21 Aug`; `21 Aug 2025` when the day is not in the current year. */
export function fmtDay(v: DayValue, now?: Date): string {
  const p = parseDay(v);
  return p ? shortDay(p, currentYear(now)) : "";
}

/** `21 Aug 2026` — always with the year. */
export function fmtDayFull(v: DayValue): string {
  const p = parseDay(v);
  return p ? `${p.d} ${MONTH_ABBR[p.m]} ${p.y}` : "";
}

/** `Monday 28 September 2026` (Daily Review header). */
export function fmtDayLong(v: DayValue): string {
  const p = parseDay(v);
  if (!p) return "";
  const weekday = WEEKDAY_NAMES[new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay()];
  return `${weekday} ${p.d} ${MONTH_NAMES[p.m]} ${p.y}`;
}

/**
 * Range text between two resolved days: same month, cross month, cross year.
 * `endYear` appends the shared year to a same-year range (never to a
 * cross-year one, which already shows both years).
 */
function rangeText(a: Ymd, b: Ymd, endYear = false): string {
  if (a.y !== b.y) {
    return `${a.d} ${MONTH_ABBR[a.m]} ${a.y} – ${b.d} ${MONTH_ABBR[b.m]} ${b.y}`;
  }
  const suffix = endYear ? ` ${b.y}` : "";
  if (a.m !== b.m) {
    return `${a.d} ${MONTH_ABBR[a.m]} – ${b.d} ${MONTH_ABBR[b.m]}${suffix}`;
  }
  return `${a.d} – ${b.d} ${MONTH_ABBR[b.m]}${suffix}`;
}

/**
 * Date range: `22 – 28 Aug` (same month), `28 Sep – 4 Oct` (cross month),
 * `29 Dec 2025 – 4 Jan 2026` (cross year), `21 Aug` (same day), `From 21 Aug`,
 * `Until 28 Aug`, `No dates`. A same-year range outside the current year adds
 * the year to the end (`3 Mar – 20 Apr 2027`, `3 – 20 Mar 2027`).
 */
export function fmtRange(a: DayValue, b: DayValue, now?: Date): string {
  const start = parseDay(a);
  const end = parseDay(b);
  const year = currentYear(now);
  if (start && end) {
    if (start.y === end.y && start.m === end.m && start.d === end.d) {
      return shortDay(start, year);
    }
    // A same-year range outside the current year carries its year on the end.
    return rangeText(start, end, start.y === end.y && end.y !== year);
  }
  if (start) return `From ${shortDay(start, year)}`;
  if (end) return `Until ${shortDay(end, year)}`;
  return "No dates";
}

/**
 * Due-date label relative to `today` (a day string, an ISO instant, or a Date
 * read in local time; defaults to now): `Today`, `Tomorrow`, `6d late`, else
 * `fmtDay`.
 */
export function fmtDue(v: DayValue, today?: string | Date | null): string {
  const due = parseDay(v);
  if (!due) return "";
  const ref =
    today instanceof Date ? localYmd(today) : today ? parseDay(today) : localYmd(new Date());
  if (!ref) return shortDay(due, currentYear());
  const diff = dayNumber(due) - dayNumber(ref);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff < 0) return `${-diff}d late`;
  return shortDay(due, ref.y);
}

/**
 * Week range for a Monday day string, e.g. `28 Sep – 4 Oct` — same output as
 * `formatWeekRange` in `isoWeek.ts` (start + 6 days, year shown on a
 * cross-year week only).
 */
export function fmtWeek(weekStart: DayValue): string {
  const start = parseDay(weekStart);
  if (!start) return "";
  const endDate = new Date(Date.UTC(start.y, start.m, start.d + 6));
  const end: Ymd = {
    y: endDate.getUTCFullYear(),
    m: endDate.getUTCMonth(),
    d: endDate.getUTCDate(),
  };
  return rangeText(start, end);
}

/** `14:22` — 24-hour `HH:mm` in local time, no date. */
export function fmtTime(ts: string | null | undefined): string {
  const date = parseTimestamp(ts);
  return date ? `${pad2(date.getHours())}:${pad2(date.getMinutes())}` : "";
}

/** `28 Sep, 14:22` in local time (with the year when not the current year). */
export function fmtDateTime(ts: string | null | undefined, now?: Date): string {
  const date = parseTimestamp(ts);
  if (!date) return "";
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  return `${shortDay(localYmd(date), currentYear(now))}, ${time}`;
}

/**
 * Relative time: `just now`, `5 min ago`, `3 h ago`, `2 d ago`, else
 * `fmtDay` (of the local day) from a week on. A timestamp in the future
 * (clock skew) reads `just now`.
 */
export function fmtAgo(ts: string | null | undefined, now: Date = new Date()): string {
  const date = parseTimestamp(ts);
  if (!date) return "";
  const diffMin = Math.round((now.getTime() - date.getTime()) / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay} d ago`;
  return shortDay(localYmd(date), currentYear(now));
}

/**
 * Pure predicate backing the Dates column's `text-error` treatment —
 * exported so it's independently unit-testable (this repo's frontend test
 * convention is pure-function `.test.ts` files over pure logic, not
 * component-render tests — see `lib/gantt/palette.test.ts`,
 * `kanban-v2/adapter.test.ts` — so the predicate is split out from the JSX
 * cell below rather than tested through rendering).
 *
 * `status !== "DONE"` (open task) AND `dueDay` is strictly before
 * `todayDay`, compared as calendar days (never an ISO-instant compare —
 * frontend/CLAUDE.md's date contract) via `dayFromIso` — same pattern as
 * the established precedent in `pages/views/ProjectTimeline.tsx`'s
 * `TaskTimelineItem` (`task.status !== "DONE" && dayFromIso(task.dueDate)! <
 * todayDay!`). Plain string comparison is correct for `"yyyy-MM-dd"` —
 * lexicographic order matches calendar order (same rule `lib/dateField.ts`'s
 * `normalizePair` relies on).
 */
export function isTaskOverdue(
  status: TaskStatus,
  dueDateIso: string | null,
  todayDay: string | null,
): boolean {
  const dueDay = dayFromIso(dueDateIso);
  return status !== "DONE" && dueDay !== null && todayDay !== null && dueDay < todayDay;
}
