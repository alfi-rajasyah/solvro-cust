// Pure grouping/aggregation logic for the Pipeline "Swimlane" view (PRD
// §2.4, M3.13) — no React, no API calls. Same "pure logic + colocated
// vitest suite" split as boardLogic.ts/kpi.ts/adapter.ts/quarterLogic.ts in
// this directory (quarterLogic.ts, M3.14, is the closest sibling: read
// alongside this file for the shared "pure grouping module for a
// PipelineSwimlane/PipelineQuarter view" precedent).
//
// Grouping mirrors Velora's swimlane-view.tsx (../VeloraApp
// components/kanban/swimlane-view.tsx, read-only reference per CLAUDE.md):
// one lane per distinct PIC plus an "Unassigned" lane for a null `picId`,
// sorted by display name ascending (`picRows` in the reference).
//
// Column set — the M3.13 dispatch brief's flagged "known quirk": the
// reference computes `SWIMLANE_STAGES = STAGES.filter(s => s.id !==
// "drop")`, but its own render (grid headers, PIC-row cells, totals row)
// hardcodes `grid-cols-[160px_repeat(5,1fr)]` — a 6-track template (1 PIC +
// 5 stages) left over from when `STAGES` had 6 non-drop entries. `STAGES`
// has since grown `poc`, `technical_clarification`, and `hold` (confirmed
// directly against ../VeloraApp/lib/utils.ts), so
// `STAGES.filter(s => s.id !== "drop")` actually yields 8 entries today —
// the reference's own in-file comment ("Swimlane hanya menampilkan 5
// stage") is stale, and its hardcoded 5-column template silently overflows
// into unstyled implicit grid tracks for the 3 stages it no longer
// accounts for (assessment/rfp/poc/technical_clarification/
// deliver_proposal/waiting_response/won/hold = 8, not the 5 the comment and
// template assume). PRD §2.4 independently settles the *intended* semantic
// with no "5" qualifier: "columns = stages minus drop" — this module
// mirrors that stated rule (and the reference's actual filter predicate),
// not the reference's stale hardcoded template. See PipelineSwimlane.tsx /
// this task's report for the concrete 8-column set this produces today.
import type { PipelineStage } from "@/lib/pipelineFormat";
import { PIPELINE_STAGES } from "./adapter";
import { isActiveDeal } from "./kpi";

/** Columns rendered by the swimlane — every `PIPELINE_STAGES` entry except
 * DROP (PRD §2.4's "columns = stages minus drop"). Today: ASSESSMENT, RFP,
 * POC, TECHNICAL_CLARIFICATION, DELIVER_PROPOSAL, WAITING_RESPONSE, WON,
 * HOLD (8) — see this file's header comment for how that count was
 * verified against the reference. */
export const SWIMLANE_STAGES: readonly PipelineStage[] = PIPELINE_STAGES.filter(
  (stage) => stage !== "DROP",
);

/**
 * Structural subset of `Opportunity` this module (and PipelineSwimlane.tsx)
 * needs — same "declare only the fields actually touched" convention as
 * adapter.ts's `PipelineBoardDeal`. `pic` carries `id` (not just a display
 * name) so the view can hand it straight to `AssigneeAvatar` without a
 * second lookup.
 */
export interface SwimlaneDeal {
  id: string;
  title: string;
  dealValue: number;
  stage: PipelineStage;
  picId: number | null;
  pic: { id: number; username: string } | null;
  deadline: string | null;
}

export interface SwimlaneLane {
  picId: number | null;
  picName: string;
  pic: { id: number; username: string } | null;
  deals: SwimlaneDeal[];
}

const UNASSIGNED_LABEL = "Unassigned";

/**
 * Groups deals into one lane per distinct `picId`, plus a single
 * "Unassigned" lane for `picId === null`, sorted by display name ascending
 * (`localeCompare`) — mirrors the reference's `picRows` (a `Map` keyed by
 * `pic_id || "__unassigned__"`, built in input order then
 * `.sort((a, b) => a.picName.localeCompare(b.picName))`). Deals within a
 * lane keep their input order (no re-sort), matching the reference's
 * `map.get(key)!.opps.push(opp)`. Does not mutate `deals`.
 */
export function groupIntoLanes(deals: readonly SwimlaneDeal[]): SwimlaneLane[] {
  const byPic = new Map<string, SwimlaneLane>();

  for (const deal of deals) {
    const key = deal.picId === null ? "__unassigned__" : String(deal.picId);
    let lane = byPic.get(key);
    if (!lane) {
      lane = {
        picId: deal.picId,
        picName: deal.pic?.username ?? UNASSIGNED_LABEL,
        pic: deal.pic,
        deals: [],
      };
      byPic.set(key, lane);
    }
    lane.deals.push(deal);
  }

  return Array.from(byPic.values()).sort((a, b) => a.picName.localeCompare(b.picName));
}

/** Deals in `lane` sitting in `stage` — the cell content source for the grid. */
export function dealsInCell(lane: SwimlaneLane, stage: PipelineStage): SwimlaneDeal[] {
  return lane.deals.filter((deal) => deal.stage === stage);
}

export interface LaneSummary {
  count: number;
  total: number;
}

/**
 * A lane's row-header summary (count + value sum) excludes WON deals —
 * mirrors the reference's `activeOpps` (`row.opps.filter(o => o.stage !==
 * "won")`, used for both the PIC row's "N deals" count and its value sum).
 * Reuses this codebase's own `isActiveDeal` (kpi.ts) rather than
 * re-deriving a second "what counts as active" predicate. Its DROP
 * exclusion is NOT a no-op here: `groupIntoLanes` buckets by `picId` alone
 * and does not filter by stage, so a DROP deal would still land in its
 * lane's `deals` array (it just never renders, since DROP isn't one of
 * `SWIMLANE_STAGES` and so is never matched by `dealsInCell`). It's the
 * caller (PipelineSwimlane.tsx filtering DROP out of `allDeals` before
 * calling `groupIntoLanes`) that actually keeps DROP out of every lane
 * today — `isActiveDeal`'s DROP exclusion here is a second, independent
 * safety net for this summary specifically, not a redundant check.
 */
export function laneSummary(lane: SwimlaneLane): LaneSummary {
  const active = lane.deals.filter(isActiveDeal);
  return { count: active.length, total: active.reduce((sum, deal) => sum + deal.dealValue, 0) };
}

export interface StageSummary {
  stage: PipelineStage;
  count: number;
  total: number;
}

/**
 * Per-column count + value sum across every deal in `lanes` sitting in that
 * stage (WON included — unlike `laneSummary`, this is each column's own
 * total, not an "active pipeline" figure) — mirrors the reference's
 * `stageTotals`, computed from the currently-visible lane set.
 */
export function stageSummaries(lanes: readonly SwimlaneLane[]): StageSummary[] {
  return SWIMLANE_STAGES.map((stage) => {
    const deals = lanes.flatMap((lane) => dealsInCell(lane, stage));
    return {
      stage,
      count: deals.length,
      total: deals.reduce((sum, deal) => sum + deal.dealValue, 0),
    };
  });
}
