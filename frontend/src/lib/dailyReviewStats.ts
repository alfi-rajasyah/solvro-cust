// Pure derivations for the Daily Review v2 page (daily-review-v2-spec.md
// §6.3): the 5-tile stats bar, the customer-group auto-collapse rule, the
// "scroll to the first card" target, and a couple of small date-label
// formatters shared by the page's components. No React here — see the
// Vitest suite in `dailyReviewStats.test.ts`.
import { dayFromIso } from "./dateField";
import { fmtDay } from "./formatDate";
import type { DailyReviewCustomer, DailyReviewProject, DailyReviewResponse } from "./queries";

export interface DailyReviewStats {
  reviewedToday: { count: number; total: number };
  notesThisWeek: { project: number; operations: number; total: number };
  weeklyUpdatesDone: { count: number; total: number };
  overdueTasks: number;
  openRisks: number;
}

/** Every in-scope project, customer's own + unassigned — a project lives in exactly one bucket. */
function allProjects(data: DailyReviewResponse): DailyReviewProject[] {
  return [...data.customers.flatMap((c) => c.projects), ...data.unassignedProjects];
}

/**
 * Derives the stats bar's 5 tiles from the page payload — client-side per
 * spec §6.3 (no separate endpoint). "Weekly updates done" counts against
 * `data.customers` only (the unassigned group has no weekly-update concept,
 * Decision 3).
 *
 * "Reviewed today" is per customer (Decision 20, superseding the earlier
 * per-project tile): a customer counts once it has >=1 project AND every
 * one of those projects has a review (by the current user) for
 * `data.today`; the denominator is customers with >=1 project.
 * `unassignedProjects` have no customer to roll up into, so they're
 * excluded from both the count and the total.
 */
export function computeDailyReviewStats(data: DailyReviewResponse): DailyReviewStats {
  const projects = allProjects(data);
  // `reviewDate` arrives as an ISO instant, `data.today` as a bare day
  // string — compare via `dayFromIso`, never `===` directly.
  const isReviewedToday = (p: DailyReviewProject) =>
    p.reviews.some((r) => dayFromIso(r.reviewDate) === data.today);
  const customersWithProjects = data.customers.filter((c) => c.projects.length > 0);
  const customersReviewedToday = customersWithProjects.filter((c) =>
    c.projects.every(isReviewedToday),
  ).length;
  const projectNotes = projects.reduce((sum, p) => sum + p.notes.length, 0);
  const operationsNotes = data.customers.reduce((sum, c) => sum + c.operationsNotes.length, 0);
  const overdueTasks = projects.reduce((sum, p) => sum + p.overdueTasks.length, 0);
  const openRisks = projects.reduce((sum, p) => sum + p.openRisks.length, 0);
  const weeklyDone = data.customers.filter((c) => c.weeklyUpdate?.status === "DONE").length;

  return {
    reviewedToday: { count: customersReviewedToday, total: customersWithProjects.length },
    notesThisWeek: {
      project: projectNotes,
      operations: operationsNotes,
      total: projectNotes + operationsNotes,
    },
    weeklyUpdatesDone: { count: weeklyDone, total: data.customers.length },
    overdueTasks,
    openRisks,
  };
}

/**
 * A customer group is eligible to render as the collapsed single-row
 * summary (spec §6.3 pin 3) when it has at least one project, every one of
 * those projects has a review for `today`, AND the weekly update is DONE. A
 * customer with zero in-scope projects never collapses (nothing to
 * summarize as "reviewed").
 */
export function isGroupCollapsible(customer: DailyReviewCustomer, today: string): boolean {
  if (customer.projects.length === 0) return false;
  // Same ISO-instant-vs-day-string comparison rule as `computeDailyReviewStats` above.
  const allReviewed = customer.projects.every((p) =>
    p.reviews.some((r) => dayFromIso(r.reviewDate) === today),
  );
  return allReviewed && customer.weeklyUpdate?.status === "DONE";
}

/**
 * The id of the first project in the page's render order (customers, in
 * their already-sorted-by-name order, then unassigned projects) — the
 * day-strip's "scroll to the first card" target (spec §6.3 pin 1).
 */
export function firstProjectId(data: DailyReviewResponse): number | null {
  for (const customer of data.customers) {
    if (customer.projects.length > 0) return customer.projects[0].id;
  }
  if (data.unassignedProjects.length > 0) return data.unassignedProjects[0].id;
  return null;
}

const WEEKDAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * "Mon 24" — weekday abbreviation + day-of-month, derived in UTC from a
 * "yyyy-MM-dd" day string (same UTC-only rule as isoWeek.ts and
 * weeklyDraft.ts's private `dayLabel`, duplicated here rather than
 * importing weeklyDraft.ts's unexported helper — this module has its own
 * Vitest coverage).
 */
export function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  return `${WEEKDAY_ABBR[d.getUTCDay()]} ${d.getUTCDate()}`;
}

/**
 * "24 Aug" — a task's due date in the project card's attention row (already
 * under an "Overdue" heading, so no relative `Nd late` wording). `iso` is a
 * `T00:00:00.000Z` day instant (dateBoundary.ts convention); the shared
 * formatter reads its UTC date part, so the day never drifts by timezone.
 * Shows the year only when the day is not in the current year.
 */
export function dueDateLabel(iso: string): string {
  return fmtDay(iso);
}

/** "35" from "2026-W35" — the caps "Week NN" label's number. Falls back to the raw key if malformed. */
export function weekNumberLabel(weekKey: string): string {
  const match = /^\d{4}-W(\d{2})$/.exec(weekKey);
  return match ? String(Number(match[1])) : weekKey;
}
