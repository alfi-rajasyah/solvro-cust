// Drafts a customer's weekly-sync content from the week's daily notes
// (docs/archive/plans/weekly-sync-highlight-rows.md §4 "Draft helper" D9;
// docs/archive/plans/weekly-sync-achievement-rows.md §4 "Draft helper" D9). Pure
// functions — no React, no network — so the Daily Review modals' "Draft
// from Mon–Wed notes"/"Draft from this week" actions can call them directly
// and the Vitest suite below can exercise them in isolation.
// `draftWeeklyHighlights` is the Mid-week form's draft: one
// `WeeklyHighlightInput` row per note, `opts.throughDay` (the Mid-week
// modal passes `week.days[2]`) restricting it to Mon-Wed notes only — a
// plain string compare on "yyyy-MM-dd" that keeps the boundary day itself.
// `draftWeeklyAchievements` is the Reflection form's draft: this week's
// saved Mid-week highlights first (verbatim), then one
// `WeeklyAchievementInput` row per Thursday-Sunday note — or, when there
// are no saved highlights, per Monday-Sunday note instead — through the
// same per-note rule `draftWeeklyHighlights` uses.
import { dayFromIso } from "./dateField";
import type {
  DailyReviewCustomer,
  DailyReviewOpsNote,
  WeeklyAchievementInput,
  WeeklyHighlightInput,
} from "./queries";

const WEEKDAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Mon 24" — weekday abbreviation + day-of-month, derived in UTC from a "yyyy-MM-dd" day string. */
function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  return `${WEEKDAY_ABBR[d.getUTCDay()]} ${d.getUTCDate()}`;
}

/**
 * Groups `notes` by calendar day, each day's bucket sorted `(noteDate, id)`
 * ascending — the same tiebreak the backend's own `orderBy` uses
 * (`routes/dailyReview.ts`), so bucket order is deterministic regardless of
 * the order notes arrive in.
 *
 * `note.noteDate` is a `@db.Date` column and arrives over the wire as an
 * ISO instant (`"2026-08-24T00:00:00.000Z"`, see `backend/test/
 * projectReviews.test.ts`), NOT a bare "yyyy-MM-dd" day string — grouping on
 * the raw value would never match `week.days`' bare day strings in
 * `draftWeeklyHighlights`/`draftWeeklyAchievements` below. `dayFromIso`
 * extracts the calendar day for the map key (it also accepts an
 * already-bare day string unchanged, since it just reads the first 10
 * characters — so a caller passing either shape groups correctly); the
 * full instant string is still what's compared for ordering, since
 * same-format ISO instants sort identically to their date parts (all
 * `T00:00:00.000Z`-suffixed).
 */
function groupNotesByDay<T extends { id: number; noteDate: string }>(
  notes: T[],
): Map<string, T[]> {
  const sorted = [...notes].sort(
    (a, b) => a.noteDate.localeCompare(b.noteDate) || a.id - b.id,
  );
  const byDay = new Map<string, T[]>();
  for (const note of sorted) {
    const day = dayFromIso(note.noteDate) ?? note.noteDate;
    const bucket = byDay.get(day);
    if (bucket) bucket.push(note);
    else byDay.set(day, [note]);
  }
  return byDay;
}

/**
 * `[<title>]` — the title is required (1-120 chars, Decision 4), so this
 * always returns a non-empty bracket, unlike the earlier optional-service
 * version.
 */
function bracketFor(note: DailyReviewOpsNote): string {
  return `[${note.title}]`;
}

/** Cuts `s` to `max` code points (not UTF-16 code units), so a multi-byte
 * character straddling the boundary is dropped whole rather than split into
 * a lone surrogate — matching the migration's `LEFT(first_line, 200)`
 * (Postgres counts characters, not UTF-16 units, for `text`). */
function cut(s: string, max: number): string {
  const codePoints = [...s];
  return codePoints.length > max ? codePoints.slice(0, max).join("") : s;
}

/**
 * Splits a note body into a one-line title and an optional detail — the
 * same rule the `weekly_highlights` data-move migration applies to the old
 * `WeeklyUpdate.highlight` text (docs/archive/plans/weekly-sync-highlight-rows.md
 * §2). Line endings are normalised first (`\r\n` and a lone `\r` both become
 * `\n`, matching the migration's own normalisation), then each line is
 * trimmed of surrounding spaces. The title is the first non-empty line, cut
 * at 200 characters. Detail is everything after that line, trimmed, or
 * `null` when empty — UNLESS the first line itself was longer than 200
 * characters, in which case the title was cut short and detail becomes the
 * full trimmed body instead, so nothing is silently lost.
 */
export function splitTitle(text: string): { title: string; detail: string | null } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const trimmedLines = lines.map((l) => l.trim());
  const firstIndex = trimmedLines.findIndex((l) => l.length > 0);
  if (firstIndex === -1) return { title: "", detail: null };

  const firstLine = trimmedLines[firstIndex];
  if ([...firstLine].length > 200) {
    const full = text.trim();
    return { title: cut(firstLine, 200), detail: full.length > 0 ? full : null };
  }

  const rest = lines.slice(firstIndex + 1).join("\n").trim();
  return { title: firstLine, detail: rest.length > 0 ? rest : null };
}

/**
 * Shared building block behind `highlightFromNote`/`achievementFromNote`:
 * the `{ title, detail }` pair for `note`, titled `prefix` + its own split
 * title (D9). `prefix` never lands in `detail`: when the prefixed title has
 * to be cut at 200, detail falls back to the note's full trimmed body
 * instead of just the post-first-line remainder.
 */
function draftedTitleAndDetail(
  note: { body: string },
  prefix: string,
): { title: string; detail: string | null } {
  const split = splitTitle(note.body);
  const prefixedTitle = prefix + split.title;
  if ([...prefixedTitle].length > 200) {
    const full = note.body.trim();
    return { title: cut(prefixedTitle, 200), detail: full.length > 0 ? full : null };
  }
  return { title: prefixedTitle, detail: split.detail };
}

/** One `WeeklyHighlightInput` row for `note` — see `draftedTitleAndDetail`. */
function highlightFromNote(note: { body: string }, prefix: string): WeeklyHighlightInput {
  return draftedTitleAndDetail(note, prefix);
}

/** One `WeeklyAchievementInput` row for `note` — see `draftedTitleAndDetail`.
 * The four Reflection-only texts (outstanding issue, lesson learned, next
 * week focus, manager decision) are never set here. */
function achievementFromNote(note: { body: string }, prefix: string): WeeklyAchievementInput {
  return draftedTitleAndDetail(note, prefix);
}

/**
 * Drafts one Mid-week highlight per note in this week's project + operations
 * notes (D9): day order, and within a day the customer's own project order
 * first, then operations notes. A project note is titled
 * `"<day label> <project name>: <first line>"`; an operations note
 * `"<day label> [<note title>]: <first line>"` (`bracketFor`'s `[<title>]`
 * moved next to the day label rather than the note body, since the day
 * label + name/bracket together are now the WeeklyHighlight's `title`, not
 * a plain-text prefix inside one long paragraph). Same-day notes are never
 * joined with " / " — each note is its own row. A customer with no notes in
 * the drafted range drafts to `[]`.
 */
export function draftWeeklyHighlights(
  customer: DailyReviewCustomer,
  week: { days: string[] },
  opts?: { throughDay?: string },
): WeeklyHighlightInput[] {
  const throughDay = opts?.throughDay;
  const days = throughDay ? week.days.filter((d) => d <= throughDay) : week.days;

  const projectDays = customer.projects.map((project) => ({
    project,
    byDay: groupNotesByDay(project.notes),
  }));
  const opsByDay = groupNotesByDay(customer.operationsNotes);

  const highlights: WeeklyHighlightInput[] = [];
  for (const day of days) {
    const label = dayLabel(day);
    for (const { project, byDay } of projectDays) {
      for (const note of byDay.get(day) ?? []) {
        highlights.push(highlightFromNote(note, `${label} ${project.name}: `));
      }
    }
    for (const note of opsByDay.get(day) ?? []) {
      highlights.push(highlightFromNote(note, `${label} ${bracketFor(note)}: `));
    }
  }
  return highlights;
}

/**
 * Drafts a customer's Reflection achievement list for this week (D9 in
 * docs/archive/plans/weekly-sync-achievement-rows.md): this week's saved Mid-week
 * highlights first, in order, verbatim (title + detail copied, the four
 * Reflection-only texts left unset), then one achievement per Thursday-
 * Sunday note — day order, and within a day the customer's own project
 * order first, then operations notes, through the same per-note rule
 * `draftWeeklyHighlights` uses. A week with no saved highlights drafts from
 * the WHOLE week (Monday-Sunday) instead, so a customer that skipped the
 * Mid-week form still gets a full draft. A customer with neither highlights
 * nor notes in the drafted range drafts to `[]`.
 */
export function draftWeeklyAchievements(
  customer: DailyReviewCustomer,
  week: { days: string[] },
): WeeklyAchievementInput[] {
  const highlights = customer.weeklyUpdate?.highlights ?? [];
  const fromHighlights: WeeklyAchievementInput[] = highlights.map((h) => ({
    title: h.title,
    detail: h.detail,
  }));

  // week.days[0..2] is Mon-Wed (the Mid-week form's own drafting range) —
  // when there are highlights, only Thu-Sun (index 3 onward) is new
  // material; with none, draft the whole week instead.
  const days = highlights.length > 0 ? week.days.slice(3) : week.days;

  const projectDays = customer.projects.map((project) => ({
    project,
    byDay: groupNotesByDay(project.notes),
  }));
  const opsByDay = groupNotesByDay(customer.operationsNotes);

  const fromNotes: WeeklyAchievementInput[] = [];
  for (const day of days) {
    const label = dayLabel(day);
    for (const { project, byDay } of projectDays) {
      for (const note of byDay.get(day) ?? []) {
        fromNotes.push(achievementFromNote(note, `${label} ${project.name}: `));
      }
    }
    for (const note of opsByDay.get(day) ?? []) {
      fromNotes.push(achievementFromNote(note, `${label} ${bracketFor(note)}: `));
    }
  }

  return [...fromHighlights, ...fromNotes];
}
