// "Overdue" boundary shared by the /tasks?overdue=true route
// (routes/tasks.ts) and the portfolio roll-up's isOverdue/daysOverdue
// (lib/portfolio.ts, consumed by routes/overview.ts and routes/reports.ts's
// executive report).
//
// Contract: a task/project is overdue relative to the CALLER's local
// calendar day, not the server's. Every one of the three routes above
// accepts an optional `today` query param — a "yyyy-MM-dd" day string, the
// browser's local day per frontend/src/lib/dateField.ts's `dateToDay` — and
// the boundary is UTC midnight of THAT day (`utcMidnightOfDayString`).
// Absent `today` (a direct API caller that doesn't send it), the boundary
// falls back to UTC midnight of the server's own current day
// (`utcStartOfToday`) for backward compatibility. DONE tasks are always
// excluded from "overdue" regardless of which boundary is in play —
// routes/tasks.ts intersects rather than overwrites an explicit `?status`
// filter for this reason.

const DAY_STRING_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True for a syntactically- and calendrically-valid "yyyy-MM-dd" day
 * string. Round-trips through `Date` rather than trusting a bare
 * `Number.isNaN` check: `new Date("2026-02-30T00:00:00.000Z")` silently
 * rolls over to March 2 instead of producing an Invalid Date (JS Date's
 * day-of-month leniency), so a day whose parsed instant doesn't slice back
 * to the exact input is rejected too.
 */
export function isValidDayString(day: string): boolean {
  if (!DAY_STRING_RE.test(day)) return false;
  const d = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === day;
}

/**
 * UTC midnight of the calendar day named by an already-validated
 * "yyyy-MM-dd" day string (see `isValidDayString` — callers validate via
 * the route's own Zod schema before this runs).
 */
export function utcMidnightOfDayString(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** UTC midnight of the UTC calendar day containing `instant`. */
export function utcMidnightOf(instant: Date | number): Date {
  const d = new Date(instant);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** UTC midnight of the UTC calendar day containing the current instant. */
export function utcStartOfToday(): Date {
  return utcMidnightOf(Date.now());
}

/**
 * Resolves the "overdue" boundary for a request: UTC midnight of the
 * caller's `today` day string when supplied, else the UTC-day fallback.
 * The single choke point routes/tasks.ts and lib/portfolio.ts both call, so
 * "overdue" means the same thing everywhere it's computed.
 */
export function overdueBoundary(today?: string): Date {
  return today ? utcMidnightOfDayString(today) : utcStartOfToday();
}
