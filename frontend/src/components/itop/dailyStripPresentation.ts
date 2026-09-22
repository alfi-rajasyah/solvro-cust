// Pure display helpers for the Daily Review iTop strip (Task 2.2,
// docs/archive/plans/itop-integration.md — "Daily Review shows the
// operations picture" in docs/archive/plans/itop-integration-spec.md). Kept dependency-free
// (no React) so DailyItopStrip.tsx and this module's own vitest unit test
// share one source of truth, matching ticketPresentation.ts's pattern.
import type { TicketTone } from "./ticketPresentation";

export interface DailyStripChip {
  label: string;
  tone: TicketTone;
}

/** "N new" — informational. Violet, so it reads apart from the emerald "resolved" chip beside it. */
export function newTodayChip(count: number): DailyStripChip {
  return { label: `${count} new`, tone: "violet" };
}

/** "N resolved" — positive, always the same tone regardless of count. */
export function resolvedTodayChip(count: number): DailyStripChip {
  return { label: `${count} resolved`, tone: "emerald" };
}

/**
 * "N SLA breached" — the one chip whose tone depends on its count: danger
 * (`rose`) only when there's actually a breach to flag, muted (`gray`) at
 * zero so a clean day doesn't read as an alert.
 */
export function slaBreachedChip(count: number): DailyStripChip {
  return { label: `${count} SLA breached`, tone: count > 0 ? "rose" : "gray" };
}
