// Pure Pipeline KPI-bar math — no React, no API calls. Mirrors VeloraApp's
// kpi-bar.tsx (../VeloraApp/components/kanban/kpi-bar.tsx, read-only
// behavior reference per CLAUDE.md) metric-for-metric, with one deliberate
// deviation the PRD calls for: "Won this month" reads the real `wonAt`
// column (PRD §4.2's schema delta, settled 2026-08-14) instead of Velora's
// `updated_at` proxy — `wonAt` is set/cleared only on an actual WON
// transition (backend/src/routes/opportunities.ts's POST /:id/move), so it
// can't drift the way an edited-after-won deal would under `updated_at`.
//
// Takes `PipelineBoardDeal` (adapter.ts) rather than the full `Opportunity`
// DTO — every field these functions touch (dealValue/stage/picId/deadline/
// wonAt) is already on that structural type, and `Opportunity` satisfies it
// structurally (adapter.ts's own doc comment), so the board container can
// pass its query data straight through with no cast.
import type { Tone } from "@/components/StatusChip";
import { dateToDay, dayToDate } from "@/lib/dateField";
import { TERMINAL_STAGES, type PipelineStage } from "@/lib/pipelineFormat";
import { PIPELINE_STAGES, type PipelineBoardDeal } from "./adapter";

/**
 * Win-probability tone bands — mirrors Velora's `getProbabilityColor`
 * (../VeloraApp components/kanban/card.tsx: >=70 green, >=40 yellow, else
 * red) semantics, remapped onto the house chip tones instead of raw
 * Tailwind green-100/yellow-100/red-100. Single source of truth for every
 * Pipeline surface that renders a win% chip (OpportunityCard.tsx,
 * PipelineList.tsx, OpportunityDetail.tsx) — those three previously each
 * declared an identical, unexported copy (finding S10).
 */
export function probabilityTone(p: number): Tone {
  if (p >= 70) return "emerald";
  if (p >= 40) return "amber";
  return "rose";
}

type Deal = Pick<PipelineBoardDeal, "dealValue" | "stage" | "picId" | "deadline" | "wonAt">;

/** A deal is "active" for KPI purposes when it's not resting in a terminal
 * stage — mirrors Velora's `activeOpps` filter (`stage !== "won" && stage
 * !== "drop"`). */
export function isActiveDeal(deal: Pick<Deal, "stage">): boolean {
  return !TERMINAL_STAGES.includes(deal.stage);
}

/**
 * Whole-day difference between a deal's `deadline` (a plain "yyyy-MM-dd"
 * calendar day — `Opportunity.deadline` is already this shape on the wire,
 * see `serializeOpportunity` in backend/src/routes/opportunities.ts) and
 * "today" (the host's LOCAL calendar day) — negative once the deadline has
 * passed. Mirrors Velora's hand-rolled `daysUntil` (kpi-bar.tsx), rebuilt on
 * this repo's own day-string helpers (`lib/dateField.ts`) instead of a
 * second substring parse, since both sides are already the same "day
 * string" representation `dateField.ts` traffics in.
 */
export function daysUntilDeadline(deadline: string, today: Date = new Date()): number {
  const target = dayToDate(deadline);
  const todayMidnight = dayToDate(dateToDay(today));
  if (!target || !todayMidnight) return NaN;
  return Math.round((target.getTime() - todayMidnight.getTime()) / 86_400_000);
}

/** True once a deal's deadline has passed (`daysUntilDeadline < 0`); `false`
 * for a null deadline — no deadline can't be "overdue". Shared by the KPI
 * bar's "Deadline ≤ 7 days" tile and `OpportunityCard`'s overdue treatment,
 * so both surfaces agree on what "overdue" means. */
export function isDealOverdue(deadline: string | null, today: Date = new Date()): boolean {
  if (!deadline) return false;
  return daysUntilDeadline(deadline, today) < 0;
}

// UTC calendar month, not local (finding N4): unifies "won this month" with
// `components/pipeline/analytics.ts`'s `computeMonthlyTrend` (Executive
// dashboard's "created vs. won" trend chart), which already buckets
// `wonAt`/`createdAt` by UTC month via a direct ISO-string slice. Before
// this fix, this KPI — surfaced on BOTH `PipelineKpiBar.tsx`'s board strip
// and `PipelineOverviewPanel.tsx`'s Overview fold-in, the third of the
// three surfaces that all render some flavor of "won this month" — read
// the HOST's local month instead, so a deal won in the last/first few
// hours of a calendar month could count toward "this month" on the KPI
// tiles but not on the Executive trend chart (or vice versa), depending on
// the viewer's timezone. All three surfaces now agree on the same UTC
// month boundary.
function isSameMonth(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
}

export interface FunnelBucket {
  stage: PipelineStage;
  count: number;
}

export interface PipelineKpis {
  totalPipelineValue: number;
  activeDealCount: number;
  deadlineSoonCount: number;
  deadlineCriticalCount: number;
  wonThisMonthValue: number;
  wonThisMonthCount: number;
  activePicCount: number;
  /** Per-stage counts excluding DROP (PRD §2.3 point 5), in `PIPELINE_STAGES`
   * order — that order already excludes nothing but DROP itself once
   * filtered, so no re-sorting is needed. */
  funnel: FunnelBucket[];
}

/**
 * Computes every KPI-bar metric (PRD §2.3 point 5) from an unfiltered deal
 * list in one pass-ish sweep. `now` is injectable (defaults to `new Date()`)
 * purely so tests don't depend on the wall clock.
 */
export function computePipelineKpis(deals: Deal[], now: Date = new Date()): PipelineKpis {
  const active = deals.filter(isActiveDeal);
  const totalPipelineValue = active.reduce((sum, d) => sum + d.dealValue, 0);

  const deadlineSoon = active.filter(
    (d) => d.deadline !== null && daysUntilDeadline(d.deadline, now) <= 7,
  );
  const deadlineCritical = deadlineSoon.filter((d) => daysUntilDeadline(d.deadline!, now) <= 3);

  const wonThisMonth = deals.filter(
    (d) => d.stage === "WON" && d.wonAt !== null && isSameMonth(new Date(d.wonAt), now),
  );

  const activePicCount = new Set(
    active.filter((d) => d.picId !== null).map((d) => d.picId),
  ).size;

  const funnel: FunnelBucket[] = PIPELINE_STAGES.filter((stage) => stage !== "DROP").map(
    (stage) => ({ stage, count: deals.filter((d) => d.stage === stage).length }),
  );

  return {
    totalPipelineValue,
    activeDealCount: active.length,
    deadlineSoonCount: deadlineSoon.length,
    deadlineCriticalCount: deadlineCritical.length,
    wonThisMonthValue: wonThisMonth.reduce((sum, d) => sum + d.dealValue, 0),
    wonThisMonthCount: wonThisMonth.length,
    activePicCount,
    funnel,
  };
}
