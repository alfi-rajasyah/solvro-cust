// Pure IANA-timezone helpers for the iTop integration. No dependency beyond
// Node's built-in `Intl` — the real install's REST API returns/accepts
// datetimes as plain "YYYY-MM-DD HH:MM:SS" wall-clock strings in the
// SERVER'S configured timezone (confirmed: 'timezone' => 'Europe/Paris' on
// the reference install), never UTC and never with an offset suffix. This
// module converts between that wall-clock shape and real UTC instants;
// lib/itop/sync.ts's `parseItopDate`/`formatItopDate` are the only callers,
// which thread `ItopConfig.timezone` through from the database. See
// docs/archive/plans/itop-integration.md for the join-rule/testing context
// this integration otherwise follows.
//
// DST rule (documented once, here, since both directions rely on it):
// - `isValidTimeZone`: any string `Intl.DateTimeFormat` accepts as a
//   `timeZone` option is valid; anything else (typo, non-IANA name) is not.
// - `utcToZonedWallTime`: a real UTC instant has exactly one wall-clock
//   reading in any timezone — no ambiguity, straightforward formatting.
// - `zonedWallTimeToUtc`: a WALL-CLOCK reading can map to zero, one, or two
//   real UTC instants around a DST transition:
//   - Normal case (zero or one candidate instants agree): return it.
//   - Fall-back OVERLAP (clocks move back, e.g. 03:00 -> 02:00): the
//     requested wall-clock time occurred twice, once before the transition
//     (larger UTC offset) and once after (smaller UTC offset) — we pick the
//     EARLIER of the two real instants, i.e. the occurrence still in the
//     larger-offset (pre-transition) period.
//   - Spring-forward GAP (clocks jump ahead, e.g. 02:00 -> 03:00): the
//     requested wall-clock time never happened at all — we SHIFT FORWARD
//     past the gap, returning the later of the two candidate instants (the
//     one computed using the pre-transition, smaller offset), which is
//     equivalent to advancing the requested wall-clock time by the gap's
//     duration into the period that actually exists.
//   Both branches are detected the same way: reformat each of the two
//   candidate instants back into the timezone's own wall clock and check
//   whether it reproduces the original request — both matching means
//   overlap (ambiguous), neither matching means gap (non-existent).

/** `true` iff `tz` is a timezone name the JS runtime's ICU data recognizes as a valid `Intl.DateTimeFormat` `timeZone` option (e.g. `"Europe/Paris"`, `"UTC"`). Never throws. */
export function isValidTimeZone(tz: unknown): boolean {
  if (typeof tz !== "string" || tz.trim() === "") return false;
  try {
    // Constructing the formatter is enough — an unrecognized zone throws a
    // RangeError at construction time; we never need to format anything.
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface WallTimeParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
}

/** One `Intl.DateTimeFormat` per distinct timezone, reused across calls — constructing one is the relatively expensive part of this module and every call site in sync.ts asks for the same handful of zones repeatedly (once per row, potentially hundreds of rows per sync tick). */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(tz, formatter);
  }
  return formatter;
}

/** The wall-clock reading `date` (a real instant) shows in `tz`. */
function wallTimePartsAt(tz: string, date: Date): WallTimeParts {
  const parts = formatterFor(tz).formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/**
 * `tz`'s UTC offset, in minutes, AT the real instant `date` (positive east
 * of UTC, e.g. +120 for Europe/Paris in summer). Computed by formatting
 * `date` in `tz`, reinterpreting those wall-clock digits as if they were UTC,
 * and comparing to the real instant — the standard trick for reading a
 * timezone's offset out of `Intl` without a dedicated offset API.
 */
function offsetMinutesAt(tz: string, date: Date): number {
  const p = wallTimePartsAt(tz, date);
  const asIfUtcMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asIfUtcMs - date.getTime()) / 60_000;
}

/**
 * Formats a real UTC instant as the `"YYYY-MM-DD HH:MM:SS"` wall-clock
 * string iTop's REST API expects, in `tz`. One instant always has exactly
 * one wall-clock reading in a given zone — no DST ambiguity on this
 * direction.
 */
export function utcToZonedWallTime(date: Date, tz: string): string {
  const p = wallTimePartsAt(tz, date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/**
 * Converts a wall-clock date/time reading IN `tz` (as iTop's REST API sends
 * it — no offset, no zone name, just the six numbers) to the real UTC
 * instant it denotes. See this module's top-of-file comment for the DST
 * rule governing the gap/overlap cases. `month` is 1-12 (NOT the 0-based
 * `Date` convention) to match how callers read it off a regex match.
 */
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  tz: string,
): Date {
  // Reference point only — NOT necessarily a real instant. Used purely to
  // anchor the two offset samples below at the right calendar date.
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);

  // Sample the offset a full day before and a full day after the naive
  // point. A DST transition is a near-instantaneous event, never spanning a
  // full day, so ±24h reliably lands OUTSIDE the transition itself on both
  // sides — giving the two offsets that could plausibly apply to the
  // requested wall-clock moment (the one in effect the day before, and the
  // one in effect the day after) regardless of what local time of day the
  // transition happens to fall at. Sampling only near the naive instant
  // itself (a single converging guess) was tried and failed: when the
  // requested wall-clock time falls entirely AFTER the real transition
  // instant, both the initial guess and its one refinement can land on the
  // POST-transition side, silently missing the pre-transition candidate
  // that makes a fall-back time genuinely ambiguous.
  const offsetBefore = offsetMinutesAt(tz, new Date(naiveUtcMs - ONE_DAY_MS));
  const offsetAfter = offsetMinutesAt(tz, new Date(naiveUtcMs + ONE_DAY_MS));

  if (offsetBefore === offsetAfter) {
    // No transition anywhere near this date — a single unambiguous offset.
    return new Date(naiveUtcMs - offsetBefore * 60_000);
  }

  const candidateBeforeMs = naiveUtcMs - offsetBefore * 60_000;
  const candidateAfterMs = naiveUtcMs - offsetAfter * 60_000;

  const reproducesRequest = (ms: number): boolean => {
    const p = wallTimePartsAt(tz, new Date(ms));
    return (
      p.year === year &&
      p.month === month &&
      p.day === day &&
      p.hour === hour &&
      p.minute === minute &&
      p.second === second
    );
  };

  const beforeValid = reproducesRequest(candidateBeforeMs);
  const afterValid = reproducesRequest(candidateAfterMs);

  if (beforeValid && afterValid) {
    // Fall-back OVERLAP: the wall-clock time genuinely occurred twice —
    // pick the EARLIER real instant.
    return new Date(Math.min(candidateBeforeMs, candidateAfterMs));
  }
  if (beforeValid) return new Date(candidateBeforeMs);
  if (afterValid) return new Date(candidateAfterMs);

  // Spring-forward GAP: neither candidate reproduces the request — the
  // wall-clock time never existed. Shift forward past the gap by returning
  // the LATER of the two candidates.
  return new Date(Math.max(candidateBeforeMs, candidateAfterMs));
}
