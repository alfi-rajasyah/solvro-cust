import { z } from "zod";
import { isValidDayString } from "./dateBoundary.js";

// Schemas for a date sent in a request body: task, epic and project-task
// dates and the baseline's as-of date (`dateInput`), and a task PATCH's
// `expected` values (`dateString`).
//
// `z.coerce.date()` alone takes anything `new Date()` takes: a boolean became
// 1970-01-01, a number became an epoch instant, a loose string like "12" or
// "10/23/2026" parsed in the server's time zone, "2026-02-30" rolled over to
// March 2, and a year Postgres' timestamp column cannot hold (e.g.
// "-271821-04-20T00:00:00.000Z") passed validation and then failed at the
// INSERT as a 500. These accept only a "yyyy-MM-dd" day or an ISO instant that
// starts with one, so a bad value is a 400 validation_error before anything is
// written. Every caller already sends that shape (frontend `isoFromDay`,
// `toISOString()`, the e2e fixtures).
//
// Chain `.nullable().optional()` at the call site as before; the parsed value
// is a `Date`, exactly what the routes received from `z.coerce.date()`.
export const MIN_DATE_YEAR = 1900;
export const MAX_DATE_YEAR = 2200;

const ISO_DAY_PREFIX = /^\d{4}-\d{2}-\d{2}(?:T|$)/;

/**
 * A "yyyy-MM-dd" day or an ISO instant starting with one, calendar-valid, with
 * no year window. Only for values that are compared and never written (a task
 * PATCH's `expected`): the client echoes back what is stored, and a row may
 * predate the window.
 *
 * No `.min(1)` and the refine re-checks its input: zod still runs a later
 * `.refine` on a value whose earlier check failed, so the refine must not
 * assume it got a valid Date. The format check comes before the pipe for the
 * same reason (a failed regex leaves the string dirty, and the date parser
 * then rejects anything it cannot read).
 */
export const dateString = z
  .string()
  .regex(ISO_DAY_PREFIX, { message: "must be a yyyy-MM-dd date or an ISO date-time" })
  .refine((s) => typeof s === "string" && isValidDayString(s.slice(0, 10)), {
    message: "must be a real calendar date",
  })
  .pipe(z.coerce.date());

/** `dateString` inside the 1900–2200 window — every date that gets written. */
export const dateInput = dateString.refine(
  (d) => {
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return false;
    const year = d.getUTCFullYear();
    return year >= MIN_DATE_YEAR && year <= MAX_DATE_YEAR;
  },
  { message: `must be a date between ${MIN_DATE_YEAR} and ${MAX_DATE_YEAR}` },
);
