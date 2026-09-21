// Pure quarter-grouping logic for the Pipeline "Quarter" view (PRD §2.4) —
// no React, no API calls, same "pure logic + colocated vitest suite" split
// as boardLogic.ts/kpi.ts/adapter.ts in this directory.
//
// Mirrors Velora's `getQuarterId` (../VeloraApp
// components/kanban/quarter-view.tsx, read-only reference) verbatim: a deal
// buckets into Q1–Q4 of the CURRENT year by the month component of its
// `request_date`. A deal with no request date, OR a request date outside
// the current year (past or future — the reference makes no distinction),
// falls into the same single catch-all bucket the reference calls
// "Lainnya" ("Other") — there is no separate "wrong year" bucket, both
// cases share the one bucket this module calls `OTHER`. PRD §2.4 shorthands
// this as "+ 'no date' bucket"; this module's dispatch brief asked to
// verify the other-year behavior against the reference directly, which is
// where the broader `OTHER` semantics (not just null dates) come from — see
// this task's report.
//
// Date handling: `requestDate` is a plain day string ("yyyy-MM-dd" — see
// frontend/CLAUDE.md's date contract / lib/dateField.ts). The year/month are
// read via string slicing, never `new Date(requestDate)`, which would
// UTC-shift the parsed local date by one day for hosts east of UTC.
//
// `currentYear` is a parameter everywhere here (never read from
// `Date.now()`/`new Date()` internally) purely so this stays pure and
// deterministically testable — callers (PipelineQuarter.tsx) pass
// `new Date().getFullYear()`.

export type QuarterId = "Q1" | "Q2" | "Q3" | "Q4" | "OTHER";

/** Column order, left to right — matches the reference's QUARTERS-then-Lainnya order. */
export const QUARTER_ORDER: readonly QuarterId[] = ["Q1", "Q2", "Q3", "Q4", "OTHER"];

const QUARTER_MONTHS: readonly { id: Exclude<QuarterId, "OTHER">; months: readonly number[] }[] = [
  { id: "Q1", months: [1, 2, 3] },
  { id: "Q2", months: [4, 5, 6] },
  { id: "Q3", months: [7, 8, 9] },
  { id: "Q4", months: [10, 11, 12] },
];

/**
 * Buckets a single `requestDate` day string into a quarter of `currentYear`,
 * or `OTHER` for a null date, an unparsable string, or any date outside
 * `currentYear`.
 */
export function getQuarterId(requestDate: string | null, currentYear: number): QuarterId {
  if (!requestDate) return "OTHER";

  const year = Number(requestDate.slice(0, 4));
  const month = Number(requestDate.slice(5, 7));
  if (!Number.isFinite(year) || !Number.isFinite(month)) return "OTHER";
  if (year !== currentYear) return "OTHER";

  const quarter = QUARTER_MONTHS.find((q) => q.months.includes(month));
  return quarter ? quarter.id : "OTHER";
}

/**
 * Pure projection: any deal list (structural — only `requestDate` matters
 * here) -> `Record<QuarterId, T[]>`, all 5 buckets always present (empty
 * arrays allowed), input order preserved within each bucket. Mirrors
 * adapter.ts's `projectToColumns` shape, scoped to quarter buckets instead
 * of `PipelineStage` columns.
 */
export function groupByQuarter<T extends { requestDate: string | null }>(
  deals: readonly T[],
  currentYear: number,
): Record<QuarterId, T[]> {
  const grouped = Object.fromEntries(QUARTER_ORDER.map((id) => [id, [] as T[]])) as Record<
    QuarterId,
    T[]
  >;

  for (const deal of deals) {
    grouped[getQuarterId(deal.requestDate, currentYear)].push(deal);
  }

  return grouped;
}
