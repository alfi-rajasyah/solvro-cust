// Overview fold-in panel (PRD §2.7, "Overview gains one Pipeline panel").
// Mounted by Overview.tsx only after it has already confirmed
// `hasPermission(user, "pipeline:view")` — this component assumes that gate
// and unconditionally calls useOpportunities() on mount, so a user without
// Pipeline access never triggers the /api/opportunities request and never
// sees an empty shell (PRD §2.7: "their browser never calls [the pipeline
// API]" — the API here is Solvro's own native /api/opportunities route
// rather than a separate /pipeline-api, per the native-port pivot, but the
// same no-request-for-the-ungated principle applies).
//
// Content (M5.21 dispatch, verified against §2.7's "three stat tiles:
// Total / Active / On Hold" plus the M1-era review that confirmed the Hold
// stage/tile stays): Pipeline Value, Active Deals, Won This Month, and On
// Hold (amber accent once > 0) — plus a compact per-stage distribution bar
// and a "View pipeline" link to /pipeline.
//
// Visual language is copied from Overview.tsx's own local `Kpi` component
// and its "Projects needing attention" header-with-link section (both
// unexported) — NOT from PipelineKpiBar.tsx's Executive-style tiles
// (bg-surface-container, text-data-mono, text-2xl values), because this
// panel lives on the Overview page and must read as one of its native
// panels rather than an imported /pipeline widget. Same "copy, don't
// extract" precedent PipelineKpiBar.tsx's and kpi.ts's own header comments
// already document for this module.
import { Link } from "react-router-dom";
import { computePipelineKpis, type FunnelBucket } from "@/components/pipeline/kpi";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { formatIDRCompact, STAGE_ALPHA, STAGE_LABELS, type PipelineStage } from "@/lib/pipelineFormat";
import { useOpportunities, type Opportunity } from "@/lib/queries";

export function PipelineOverviewPanel() {
  const { data: deals, isLoading, isError, error } = useOpportunities();

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <h3 className="font-display text-sm font-bold text-on-surface">Pipeline</h3>
        <Link to="/pipeline" className="text-[11px] font-semibold text-primary hover:underline">
          View pipeline →
        </Link>
      </header>

      {isLoading && <PipelinePanelSkeleton />}

      {isError && (
        <Alert variant="destructive">
          <AlertDescription>Could not load pipeline data: {(error as Error).message}</AlertDescription>
        </Alert>
      )}

      {deals && <PipelinePanelBody deals={deals} />}
    </section>
  );
}

function PipelinePanelBody({ deals }: { deals: Opportunity[] }) {
  const kpis = computePipelineKpis(deals);
  const holdCount = deals.filter((d) => d.stage === "HOLD").length;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Pipeline Value"
          value={formatIDRCompact(kpis.totalPipelineValue)}
          hint={`${kpis.activeDealCount} active deal${kpis.activeDealCount === 1 ? "" : "s"}`}
          icon="payments"
          tone="primary"
        />
        <Kpi
          label="Active Deals"
          value={kpis.activeDealCount}
          hint={`${kpis.activePicCount} PIC${kpis.activePicCount === 1 ? "" : "s"} engaged`}
          icon="filter_alt"
          tone="primary"
        />
        <Kpi
          label="Won This Month"
          value={formatIDRCompact(kpis.wonThisMonthValue)}
          hint={`${kpis.wonThisMonthCount} deal${kpis.wonThisMonthCount === 1 ? "" : "s"} closed`}
          icon="emoji_events"
          tone="emerald"
        />
        <Kpi
          label="On Hold"
          value={holdCount}
          hint={holdCount > 0 ? "Needs attention" : "None parked"}
          icon="pause_circle"
          tone={holdCount > 0 ? "amber" : "neutral"}
        />
      </div>

      <StageDistribution funnel={kpis.funnel} />
    </>
  );
}

interface KpiProps {
  label: string;
  value: number | string;
  hint?: string;
  icon: string;
  tone: "primary" | "emerald" | "amber" | "neutral";
}

// Verbatim copy of Overview.tsx's own (unexported) `Kpi` component — same
// card chrome, icon-tone mapping, and value typography as the page's
// existing top-of-page KPI strip, so this fold-in reads as native to the
// page rather than a transplanted /pipeline widget. `value` is widened to
// `number | string` here since two of the four tiles render a formatted
// IDR string rather than a bare count.
function Kpi({ label, value, hint, icon, tone }: KpiProps) {
  const iconColor =
    tone === "primary"
      ? "text-primary"
      : tone === "emerald"
        ? "text-chip-emerald-text"
        : tone === "amber"
          ? "text-chip-amber-text"
          : "text-on-surface-variant";
  return (
    <div className="rounded-sm border border-outline-variant bg-surface-container-lowest p-4">
      <div className="flex items-center justify-between">
        <span className="text-label-caps uppercase tracking-wider text-on-surface-variant">{label}</span>
        <span className={`material-symbols-outlined text-base ${iconColor}`}>{icon}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-mono text-3xl font-bold tabular-nums text-on-surface">{value}</span>
        {hint && <span className="text-[11px] text-on-surface-variant">{hint}</span>}
      </div>
    </div>
  );
}

// Same alpha-ramp precedent PipelineKpiBar.tsx's `FUNNEL_FILL` (and PRD
// §2.7 point 4's Executive workload heatmap) use: `bg-primary` alpha steps
// read as "further along the funnel"; HOLD breaks the ramp as its own
// amber attention state instead of implying progress. DROP is excluded
// from `computePipelineKpis`'s funnel itself (PRD §2.3) — its entry here
// exists only so this Record stays total over `PipelineStage`, matching
// PipelineKpiBar.tsx's own documented reasoning verbatim.
//
// The ramp NUMBERS come from `STAGE_ALPHA` (lib/pipelineFormat.ts, finding
// N2) — this table only translates them into the matching Tailwind class,
// kept as literal `bg-primary/NN` strings (not string-interpolated) so
// Tailwind's content scanner can still find each one as a literal
// substring in this file. Same lookup shape as PipelineKpiBar.tsx's own
// `ALPHA_TO_BG_PRIMARY_CLASS` — a parallel copy, not an import, per this
// module's header comment ("copy, don't extract").
const ALPHA_TO_BG_PRIMARY_CLASS: Record<number, string> = {
  [STAGE_ALPHA.ASSESSMENT]: "bg-primary/20",
  [STAGE_ALPHA.RFP]: "bg-primary/35",
  [STAGE_ALPHA.POC]: "bg-primary/50",
  [STAGE_ALPHA.TECHNICAL_CLARIFICATION]: "bg-primary/65",
  [STAGE_ALPHA.DELIVER_PROPOSAL]: "bg-primary/80",
  [STAGE_ALPHA.WAITING_RESPONSE]: "bg-primary/90",
  [STAGE_ALPHA.WON]: "bg-primary",
};

const STAGE_FILL: Record<PipelineStage, string> = {
  ASSESSMENT: ALPHA_TO_BG_PRIMARY_CLASS[STAGE_ALPHA.ASSESSMENT],
  RFP: ALPHA_TO_BG_PRIMARY_CLASS[STAGE_ALPHA.RFP],
  POC: ALPHA_TO_BG_PRIMARY_CLASS[STAGE_ALPHA.POC],
  TECHNICAL_CLARIFICATION: ALPHA_TO_BG_PRIMARY_CLASS[STAGE_ALPHA.TECHNICAL_CLARIFICATION],
  DELIVER_PROPOSAL: ALPHA_TO_BG_PRIMARY_CLASS[STAGE_ALPHA.DELIVER_PROPOSAL],
  WAITING_RESPONSE: ALPHA_TO_BG_PRIMARY_CLASS[STAGE_ALPHA.WAITING_RESPONSE],
  WON: ALPHA_TO_BG_PRIMARY_CLASS[STAGE_ALPHA.WON],
  DROP: "bg-chip-rose-text",
  HOLD: "bg-chip-amber-text",
};

// Compact per-stage distribution — a smaller, non-interactive sibling of
// PipelineKpiBar.tsx's `FunnelStrip` (no click-to-scroll affordance here,
// since Overview has no board to scroll). Segmented bar + count legend,
// stages with zero deals omitted (same convention `FunnelStrip` uses).
function StageDistribution({ funnel }: { funnel: FunnelBucket[] }) {
  const visible = funnel.filter((f) => f.count > 0);
  if (visible.length === 0) return null;

  return (
    <div className="rounded-sm border border-outline-variant bg-surface-container-lowest p-4">
      <div className="flex h-2 gap-px overflow-hidden rounded-full">
        {visible.map((f) => (
          <div
            key={f.stage}
            style={{ flexGrow: f.count }}
            className={`h-full ${STAGE_FILL[f.stage]}`}
            title={`${STAGE_LABELS[f.stage]}: ${f.count}`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {visible.map((f) => (
          <span key={f.stage} className="flex items-center gap-1.5 text-[11px] text-on-surface-variant">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STAGE_FILL[f.stage]}`} />
            {STAGE_LABELS[f.stage]} <span className="font-mono text-on-surface">{f.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function PipelinePanelSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-sm bg-surface-container-low" />
      ))}
    </div>
  );
}
