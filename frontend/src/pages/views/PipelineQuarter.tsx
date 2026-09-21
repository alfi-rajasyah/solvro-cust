// Pipeline "Quarter" view (PRD §2.4, M3.14) — four fixed Q1–Q4 columns of
// the current year, grouped by `requestDate`, plus a catch-all bucket for
// deals with no request date or a request date outside the current year.
// Ported from Velora's `quarter-view.tsx` (../VeloraApp
// components/kanban/quarter-view.tsx, read-only reference) onto Technical
// Precision tokens; grouping itself lives in the pure, vitest-covered
// `components/pipeline/quarterLogic.ts` (colocated with this module's other
// pure Pipeline logic — boardLogic.ts/kpi.ts/adapter.ts — rather than under
// pages/views/, per that directory's established split).
//
// Self-contained like SolvroPipelineKanban.tsx: fetches its own data via
// useOpportunities() rather than taking deals as a prop, since the view
// switcher (Pipeline.tsx, wired in a later task) mounts each view
// independently. No KPI bar here — the reference's quarter-view.tsx has
// none either; PRD §2.4's "shared toolbar and KPI bar stay mounted" implies
// that bar is hoisted to the Pipeline.tsx switcher shell, not owned by each
// view body.
//
// Read-only: no drag (PRD §2.4 "No drag in this view"). Per-card onClick
// navigates to `/pipeline/:id` (OpportunityDetail, M3.16) — wired via
// `useNavigate` (M3 integration), same click-vs-drag guard as
// SolvroPipelineKanban.tsx's board usage since this view reuses the same
// `OpportunityCard` (whose root `onClick` already wraps in
// `stopPropagation`); no drag is active here regardless (`canDrag={false}`
// below), so there's nothing for a click to conflict with in the first
// place.
//
// Cell choice: reuses `OpportunityCard` as-is (`canDrag={false}` hides the
// drag handle) rather than a local mini-card. The reference's own
// `QuarterCard` and `card.tsx` (Kanban's card) share the same anatomy
// (title + win% top-right, customer, value, PIC + deadline, product), and
// `OpportunityCard` already implements that anatomy on tokens — a second,
// near-duplicate card component would drift from it with no upside. See
// this task's report.
import { useNavigate } from "react-router-dom";
import { OpportunityCard } from "@/components/pipeline/OpportunityCard";
import { QUARTER_ORDER, groupByQuarter, type QuarterId } from "@/components/pipeline/quarterLogic";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { formatIDRCompact } from "@/lib/pipelineFormat";
import { useOpportunities } from "@/lib/queries";

// Per-quarter accent = the four chip tones in order (PRD §2.4: "blue /
// emerald / amber / violet"), same tone→class pairs `StatusChip.tsx`'s
// `Chip` component uses. `Tone` (StatusChip.tsx) is exported today, but this
// table isn't keyed by `Tone` — it's keyed by `QuarterId` and pairs a
// header+label class per quarter, a different shape than Chip's
// `Record<Tone, string>` — so importing `Tone` wouldn't let this reuse
// Chip's table directly; it stays inlined locally, same "copy, don't
// extract" precedent PipelineKpiBar.tsx's `FUNNEL_FILL` documents.
const QUARTER_ACCENT: Record<QuarterId, { header: string; label: string }> = {
  Q1: { header: "bg-primary/10 dark:bg-primary/20", label: "text-primary" },
  Q2: { header: "bg-chip-emerald-bg", label: "text-chip-emerald-text" },
  Q3: { header: "bg-chip-amber-bg", label: "text-chip-amber-text" },
  Q4: { header: "bg-chip-violet-bg", label: "text-chip-violet-text" },
  OTHER: { header: "bg-surface-container-high", label: "text-on-surface-variant" },
};

export function PipelineQuarter() {
  const navigate = useNavigate();
  const { data: deals, isLoading, isError, error } = useOpportunities();

  // Computed per-render, not module scope — a year rollover while the tab
  // stays mounted picks up the new year immediately rather than needing a
  // full page reload to re-evaluate a load-time module constant.
  const currentYear = new Date().getFullYear();
  // "Other" holds both no-date deals AND deals whose request date falls
  // outside `currentYear` (getQuarterId/quarterLogic.ts) — "No date" alone
  // undersold the second case.
  const quarterLabels: Record<QuarterId, string> = {
    Q1: `Q1 · Jan–Mar ${currentYear}`,
    Q2: `Q2 · Apr–Jun ${currentYear}`,
    Q3: `Q3 · Jul–Sep ${currentYear}`,
    Q4: `Q4 · Oct–Dec ${currentYear}`,
    OTHER: "Other",
  };

  if (isLoading) {
    return (
      <div className="flex gap-4 overflow-x-auto pb-2">
        {QUARTER_ORDER.map((id) => (
          <div
            key={id}
            className="h-64 w-[85vw] shrink-0 animate-pulse rounded-xl bg-surface-container-low sm:w-72"
          />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Could not load the Pipeline board: {(error as Error).message}
        </AlertDescription>
      </Alert>
    );
  }

  const allDeals = deals ?? [];

  if (allDeals.length === 0) {
    return <EmptyQuarterState />;
  }

  const columns = groupByQuarter(allDeals, currentYear);

  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {QUARTER_ORDER.map((id) => {
        const columnDeals = columns[id];
        const columnValue = columnDeals.reduce((sum, d) => sum + d.dealValue, 0);
        const accent = QUARTER_ACCENT[id];

        return (
          <div key={id} className="flex w-[85vw] shrink-0 flex-col sm:w-72">
            <div className={`rounded-t-xl px-3 py-2 ${accent.header}`}>
              <div className={`text-label-caps ${accent.label}`}>{quarterLabels[id]}</div>
              <div className="mt-1 flex items-center gap-2 text-xs text-on-surface-variant">
                <span>
                  {columnDeals.length} {columnDeals.length === 1 ? "deal" : "deals"}
                </span>
                <span>·</span>
                <span className="text-data-mono">{formatIDRCompact(columnValue)}</span>
              </div>
            </div>

            <div className="max-h-[calc(100vh-280px)] flex-1 space-y-2 overflow-y-auto rounded-b-xl border border-t-0 border-outline-variant bg-surface-container-lowest p-2">
              {columnDeals.length === 0 ? (
                <EmptyQuarterColumn />
              ) : (
                columnDeals.map((deal) => (
                  <OpportunityCard
                    key={deal.id}
                    deal={deal}
                    canDrag={false}
                    onClick={() => navigate(`/pipeline/${deal.id}`)}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EmptyQuarterColumn() {
  return (
    <div className="flex h-16 items-center justify-center">
      <div className="h-5 w-5 rounded-full border-2 border-dashed border-outline-variant" />
    </div>
  );
}

function EmptyQuarterState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-outline-variant px-6 py-14 text-center">
      <span className="material-symbols-outlined text-3xl text-on-surface-variant">
        calendar_view_month
      </span>
      <p className="text-sm font-semibold text-on-surface">No opportunities yet</p>
      <p className="max-w-xs text-xs text-on-surface-variant">
        Opportunities you create will appear here, grouped by quarter.
      </p>
    </div>
  );
}
