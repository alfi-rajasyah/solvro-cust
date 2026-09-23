// Pure display helpers for the Utilization page (Task 3.3,
// docs/archive/plans/itop-integration.md — "Work Logs becomes Utilization"
// in docs/archive/plans/itop-integration-spec.md). Kept dependency-free (no
// React, no query hooks) so Utilization.tsx / UtilizationTiles.tsx /
// UtilizationTable.tsx and this module's own vitest unit test share one
// source of truth, matching the itop/ presentation modules' pattern
// (ticketPresentation.ts, dailyStripPresentation.ts).

const DAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * "2.5" for a positive value, one decimal place always shown (matches the
 * mockup: "2.5", "1.0", "13.0"). Exactly 0 renders as an en dash — an empty
 * cell, not a number, per the mockup's "–" placeholder for a day nobody
 * logged time on.
 */
export function formatHours(hours: number): string {
  if (hours === 0) return "–";
  return hours.toFixed(1);
}

/**
 * Utilisation percentage for the "Hours logged" tile's bar, capped to
 * [0, 100] so a TAM who logged more than their capacity still renders a
 * full (not overflowing) bar. A zero or negative capacity — no `ItopConfig`
 * value yet, or a scope with nobody assigned — reads as 0% rather than
 * dividing by zero.
 */
export function utilisationPct(loggedHours: number, capacityHours: number): number {
  if (capacityHours <= 0) return 0;
  const pct = (loggedHours / capacityHours) * 100;
  return Math.min(100, Math.max(0, pct));
}

/**
 * "Mon 7", "Tue 8", ... for the matrix table's day-column headers, from the
 * API's `week.days` (7 "yyyy-MM-dd" strings, Monday..Sunday). The day number
 * is read from the string directly (`slice`, not `Date` parsing) so it's
 * immune to host-timezone drift, same rationale as isoWeek.ts's own
 * UTC-only arithmetic.
 */
export function dayHeaders(days: string[]): string[] {
  return days.map((day, i) => `${DAY_ABBR[i] ?? ""} ${Number(day.slice(8, 10))}`);
}

/**
 * The backend's TimeSpent sync only pulls the last 8 weeks (Task 3.1,
 * docs/archive/plans/itop-integration.md) — a week whose Monday is older
 * than that has no snapshot data by construction, not merely "nobody logged
 * time". `isOutsideSyncWindow` lets the page tell those two empty states
 * apart.
 */
export const SYNC_WINDOW_WEEKS = 8;

/**
 * True when `weekStart` ("yyyy-MM-dd", the week's Monday) is older than
 * `now` minus the 8-week sync window — i.e. the backend never even
 * attempted to sync time entries for that week, so an empty matrix there
 * is expected, not a "no time logged" idle week. `now` is a parameter
 * (not `new Date()` internally) so the vitest unit test stays
 * deterministic, same rationale as this module's other pure helpers.
 */
export function isOutsideSyncWindow(weekStart: string, now: Date): boolean {
  const start = new Date(`${weekStart}T00:00:00.000Z`);
  const cutoff = new Date(now.getTime() - SYNC_WINDOW_WEEKS * 7 * 86_400_000);
  return start.getTime() < cutoff.getTime();
}
