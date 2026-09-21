// Pipeline "Swimlane" view (PRD §2.4, M3.13) — one row per PIC, one column
// per pipeline stage (minus DROP), read-only. Ported from Velora's
// `swimlane-view.tsx` (../VeloraApp components/kanban/swimlane-view.tsx,
// read-only reference) onto Technical Precision tokens; grouping/aggregation
// itself lives in the pure, vitest-covered `components/pipeline/
// swimlaneLogic.ts` (colocated with this module's other pure Pipeline
// logic — boardLogic.ts/kpi.ts/adapter.ts/quarterLogic.ts — rather than
// under pages/views/, same split quarterLogic.ts documents for M3.14).
//
// Self-contained like SolvroPipelineKanban.tsx/PipelineQuarter.tsx/
// PipelineList.tsx (the three sibling views this milestone already
// shipped): fetches its own data via useOpportunities() rather than taking
// deals as a prop, since the view switcher (Pipeline.tsx, wired in a later
// integration task) mounts each view independently. No KPI bar here, same
// call PipelineQuarter.tsx/PipelineList.tsx already made: PRD §2.4's
// "shared toolbar and KPI bar stay mounted" implies that bar is hoisted to
// the Pipeline.tsx switcher shell, not owned by each view body.
//
// Read-only: no drag — the reference's swimlane-view.tsx has no DnD
// wiring at all (plain onClick-to-edit cards, no drag library import),
// confirmed by inspection. Per-card click navigates to `/pipeline/:id`
// (OpportunityDetail, M3.16) — wired directly inside `SwimlaneCard` below
// via `useNavigate` (M3 integration); no drag means no click-vs-drag guard
// is needed here, unlike OpportunityCard.tsx's board usage.
//
// Column set: SWIMLANE_STAGES (swimlaneLogic.ts) — 8 stages, all of
// PIPELINE_STAGES minus DROP. This is a DEVIATION from the reference's
// literal render, not from its stated rule: the reference's own filter
// (`STAGES.filter(s => s.id !== "drop")`) computes 8 stages against its
// current `STAGES` array, but its grid template hardcodes
// `repeat(5, 1fr)` — a leftover from an earlier, smaller `STAGES` array
// (its in-file comment "5 stage" is stale, and poc/technical_clarification/
// hold silently overflow the template into unstyled implicit grid tracks
// today). PRD §2.4 independently states the intended rule with no "5"
// qualifier ("columns = stages minus drop"). This view mirrors the stated
// rule + the reference's actual filter predicate, renders all 8 columns
// with a correctly-sized template, and does NOT reproduce the reference's
// template/comment staleness. See swimlaneLogic.ts's header comment and
// this task's report for the full verification.
//
// Cell choice: a local `SwimlaneCard` (title + compact value), not
// `OpportunityCard`. The dispatch brief scoped cell density to "title +
// compact value, per the reference's density" — the reference's own
// `DealCard` here is already much lighter than `OpportunityCard` (no win%
// chip, no PIC row — redundant inside a per-PIC lane anyway — no product
// line), and a swimlane cell is far narrower (one of 8 grid columns) and
// height-capped (multiple cards can stack in one lane×stage intersection)
// than a Kanban/Quarter column (a single, full-height, ~288px-wide bucket)
// — the context PipelineQuarter.tsx's own header comment gives for why
// reusing OpportunityCard fit *there*. The same reasoning argues the other
// way here. One deliberate addition beyond the literal "title + value"
// spec: a left-border overdue accent (reusing `isDealOverdue`, the same
// helper OpportunityCard.tsx/PipelineList.tsx already use) — the
// reference's own DealCard leans heavily on a colored left-border +
// deadline badge for urgency, and a border accent preserves that signal at
// zero extra text/lines. See this task's report.
//
// Lane avatar: reuses `AssigneeAvatar` (not a bespoke per-PIC color-hash
// circle). PRD §2.4's prose floats "deterministic per-PIC color hash ...
// draw the colors from the four chip-tone text colors + primary +
// tertiary" as acceptable, but both sibling M3 views already shipped with
// `AssigneeAvatar` for PIC display (PipelineList.tsx's "PIC" column,
// PipelineQuarter.tsx via OpportunityCard) — introducing a second,
// parallel avatar treatment here would fragment that now-established
// pattern for one view with no functional upside. See this task's report.
//
// Scrolling: PRD §2.4 requires horizontal overflow to scroll inside the
// view (shared with List/Quarter's own "full-width view body" framing).
// This view also bounds vertical scroll to the same container
// (`max-h-[calc(100vh-280px)]`, the exact value PipelineQuarter.tsx uses)
// rather than letting the page scroll past it: CSS `position: sticky`
// only sticks within its nearest scrolling ancestor, and Shell.tsx's `
// <main>` (the actual page-level scroller) sits ABOVE this view in the
// DOM — a naive `overflow-x-auto`-only wrapper would silently make
// `sticky top-0`/`sticky left-0` inert (the browser overflow spec forces
// `overflow-y` to `auto` the moment `overflow-x` isn't `visible`, so the
// wrapper becomes its own zero-scroll scroll container and steals sticky's
// reference frame from `<main>`). Binding one container to both axes is
// the same fix the vendored `reui/data-grid`'s dedicated `ScrollArea`
// applies (see `data-grid-scroll-area.tsx` / `data-grid.tsx`'s
// `headerSticky: "sticky top-0 z-15 ..."` default) — the house precedent
// this task's dispatch brief asked to check for.
import { Link, useNavigate } from "react-router-dom";
import { AssigneeAvatar } from "@/components/AssigneeAvatar";
import { isDealOverdue } from "@/components/pipeline/kpi";
import {
  dealsInCell,
  groupIntoLanes,
  laneSummary,
  stageSummaries,
  SWIMLANE_STAGES,
  type SwimlaneDeal,
  type SwimlaneLane,
} from "@/components/pipeline/swimlaneLogic";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { StageChip } from "@/components/StageChip";
import { formatIDRCompact } from "@/lib/pipelineFormat";
import { useOpportunities } from "@/lib/queries";

// Explicit column-count coupling to SWIMLANE_STAGES: Tailwind's JIT scanner
// only picks up arbitrary-value classes that appear as static text in
// source, so a `grid-cols-[...]` string built from `SWIMLANE_STAGES.length`
// wouldn't reliably compile. The inline style below is the honest fix — it
// derives the track count from the same array the columns are rendered
// from, so the two can never drift out of sync the way the reference's
// hardcoded `repeat(5, 1fr)` did (see this file's header comment).
const LANE_COLUMN_WIDTH = "200px";
const STAGE_COLUMN_MIN_WIDTH = "170px";

export function PipelineSwimlane() {
  const { data: deals, isLoading, isError, error } = useOpportunities();

  if (isLoading) {
    return (
      <div className="max-h-[calc(100vh-280px)] space-y-2 overflow-auto">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-sm bg-surface-container-low" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Could not load the Pipeline swimlane: {(error as Error).message}
        </AlertDescription>
      </Alert>
    );
  }

  const allDeals = deals ?? [];

  if (allDeals.length === 0) {
    return <EmptySwimlaneState />;
  }

  // DROP deals never appear in a lane's stage cells (DROP isn't one of
  // SWIMLANE_STAGES), but groupIntoLanes itself doesn't filter by stage — a
  // DROP deal for a PIC would otherwise still land in that lane's
  // `deals` array and skew `laneSummary`'s active-deal count/total (see
  // swimlaneLogic.ts's `laneSummary` doc comment). Filtering here, before
  // grouping, is what actually keeps DROP out of every lane.
  const lanes = groupIntoLanes(allDeals.filter((d) => d.stage !== "DROP"));
  const columnTotals = stageSummaries(lanes);

  return (
    <div
      className="max-h-[calc(100vh-280px)] overflow-auto rounded-sm border border-outline-variant bg-surface-container-lowest"
      role="table"
      aria-label="Opportunities by PIC and stage"
    >
      <div
        className="grid"
        style={{
          gridTemplateColumns: `${LANE_COLUMN_WIDTH} repeat(${SWIMLANE_STAGES.length}, minmax(${STAGE_COLUMN_MIN_WIDTH}, 1fr))`,
        }}
      >
        {/* Header row — wrapped in `role="row"` (`display: contents` keeps
            its children direct grid participants, so CSS Grid auto-
            placement is unaffected) so the outer `role="table"` owns actual
            rows, per ARIA's table/row/cell nesting requirement — previously
            the corner cell and column headers landed straight under
            `role="table"` with no row grouping at all. */}
        <div role="row" className="contents">
          {/* Corner cell — sticky on both axes, sits above every other sticky cell. */}
          <div className="sticky left-0 top-0 z-20 border-b border-r border-outline-variant bg-surface-container" />

          {/* Column (stage) headers — sticky top only. */}
          {SWIMLANE_STAGES.map((stage) => {
            const summary = columnTotals.find((s) => s.stage === stage);
            const count = summary?.count ?? 0;
            const total = summary?.total ?? 0;
            return (
              <div
                key={stage}
                role="columnheader"
                className="sticky top-0 z-10 flex flex-col items-center gap-1 border-b border-outline-variant bg-surface-container px-2 py-2"
              >
                <StageChip stage={stage} />
                <div className="flex items-center gap-1.5 text-[11px] text-on-surface-variant">
                  <span>
                    {count} {count === 1 ? "deal" : "deals"}
                  </span>
                  <span>·</span>
                  {/* `font-mono`, not `text-data-mono` (same N4 finding
                      SwimlaneCard below already fixed): `text-data-mono`
                      carries its own fixed 13px font-size token, which
                      conflicts with this `text-[11px]` row. */}
                  <span className="font-mono">{formatIDRCompact(total)}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Lane (PIC) rows — each is its own `role="row"` wrapper (see the
            header row's comment above for why `display: contents` is what
            keeps this ARIA-only wrapper invisible to CSS Grid). */}
        {lanes.map((lane) => {
          const summary = laneSummary(lane);
          return (
            <LaneRow key={lane.picId ?? "unassigned"} lane={lane} summary={summary} />
          );
        })}
      </div>
    </div>
  );
}

function LaneRow({
  lane,
  summary,
}: {
  lane: SwimlaneLane;
  summary: { count: number; total: number };
}) {
  return (
    <div role="row" className="contents">
      {/* Lane header — sticky left only. */}
      <div
        role="rowheader"
        className="sticky left-0 z-[5] flex flex-col justify-center gap-1 border-b border-r border-outline-variant bg-surface-container px-3 py-2"
      >
        <div className="flex min-w-0 items-center gap-2">
          <AssigneeAvatar user={lane.pic} size="sm" />
          <span className="truncate text-sm font-semibold text-on-surface">{lane.picName}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-on-surface-variant">
          <span>
            {summary.count} active {summary.count === 1 ? "deal" : "deals"}
          </span>
          <span>·</span>
          {/* `font-mono`, not `text-data-mono` — same N4 finding as the
              column-header total above. */}
          <span className="font-mono">{formatIDRCompact(summary.total)}</span>
        </div>
      </div>

      {SWIMLANE_STAGES.map((stage) => {
        const cellDeals = dealsInCell(lane, stage);
        return (
          <div
            key={stage}
            role="cell"
            className="max-h-40 overflow-y-auto border-b border-r border-outline-variant p-1.5 last:border-r-0"
          >
            {/* Per-cell empties render nothing — same convention
                SolvroPipelineKanban.tsx documents for per-column empties
                (PRD §2.11): no placeholder card, no dashed drop hint. */}
            <div className="flex flex-col gap-1.5">
              {cellDeals.map((deal) => (
                <SwimlaneCard key={deal.id} deal={deal} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SwimlaneCard({ deal }: { deal: SwimlaneDeal }) {
  const navigate = useNavigate();
  const overdue = isDealOverdue(deal.deadline);

  return (
    <div
      onClick={() => navigate(`/pipeline/${deal.id}`)}
      className={[
        "cursor-pointer rounded-sm border bg-surface-container-lowest px-2 py-1.5 transition-colors hover:border-primary",
        overdue ? "border-l-2 border-l-chip-rose-text border-outline-variant" : "border-outline-variant",
      ].join(" ")}
    >
      {/* Title as a real `<Link>` — keyboard/screen-reader route to the
          detail page (a bare `onClick` div, above, isn't reachable via Tab).
          `stopPropagation` keeps the click from also bubbling to the card's
          own `onClick` and double-navigating; the card click stays the
          mouse affordance. Unobtrusive styling — same ink color as before,
          `hover:text-primary` only as an extra affordance the parent card's
          own `hover:border-primary` doesn't provide for keyboard focus. */}
      <Link
        to={`/pipeline/${deal.id}`}
        onClick={(e) => e.stopPropagation()}
        className="line-clamp-1 rounded-sm text-xs font-medium text-on-surface hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        {deal.title}
      </Link>
      {/* `font-mono`, not `text-data-mono` (same N4 finding OpportunityCard.tsx/
          SolvroPipelineKanban.tsx already fixed): `text-data-mono` carries its
          own fixed 13px font-size token, which conflicts with the explicit
          `text-[11px]` size here — `font-mono` applies only the monospace
          font family. */}
      <p className="font-mono text-[11px] text-primary">{formatIDRCompact(deal.dealValue)}</p>
    </div>
  );
}

function EmptySwimlaneState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-outline-variant px-6 py-14 text-center">
      <span className="material-symbols-outlined text-3xl text-on-surface-variant">view_agenda</span>
      <p className="text-sm font-semibold text-on-surface">No opportunities yet</p>
      <p className="max-w-xs text-xs text-on-surface-variant">
        Opportunities you create will appear here, grouped by PIC and stage.
      </p>
    </div>
  );
}
