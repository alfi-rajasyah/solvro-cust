// KPI bar above the board — PRD §2.3 point 5 ("exact metrics from Velora's
// kpi-bar.tsx, restyled as Executive-style stat tiles"). Tile visual
// language mirrors `Overview.tsx`'s local `Kpi` component (surface-container
// family + 1px outline-variant border, no shadow, Material Symbols icon,
// label-caps header, mono value) — that component isn't exported, so this is
// a parallel (not an import), same "copy, don't extract" precedent
// kanban-v2's own files document.
import { formatIDRCompact, STAGE_ALPHA, STAGE_LABELS, type PipelineStage } from "@/lib/pipelineFormat";
import type { Opportunity } from "@/lib/queries";
import { computePipelineKpis, type FunnelBucket } from "./kpi";

export interface PipelineKpiBarProps {
  deals: Opportunity[];
  /** Funnel segment click -> scroll the board to that stage's column (PRD
   * §2.3's mockup: "funnel strip: per-stage counts, clickable -> scrolls to
   * column"). Optional so this component still renders standalone. */
  onFunnelStageClick?: (stage: PipelineStage) => void;
}

export function PipelineKpiBar({ deals, onFunnelStageClick }: PipelineKpiBarProps) {
  const kpis = computePipelineKpis(deals);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiTile
          label="Total Pipeline"
          value={formatIDRCompact(kpis.totalPipelineValue)}
          hint={`${kpis.activeDealCount} active`}
          icon="payments"
          tone="primary"
        />
        <KpiTile
          label="Deadline ≤ 7d"
          value={String(kpis.deadlineSoonCount)}
          hint={
            kpis.deadlineCriticalCount > 0
              ? `${kpis.deadlineCriticalCount} critical (≤3d)`
              : "None critical"
          }
          icon="event_upcoming"
          tone={kpis.deadlineCriticalCount > 0 ? "rose" : "neutral"}
        />
        <KpiTile
          label="Won this month"
          value={formatIDRCompact(kpis.wonThisMonthValue)}
          hint={`${kpis.wonThisMonthCount} deal${kpis.wonThisMonthCount === 1 ? "" : "s"} closed`}
          icon="emoji_events"
          tone="emerald"
        />
        <KpiTile
          label="Active PICs"
          value={String(kpis.activePicCount)}
          hint="managing deals"
          icon="group"
          tone="neutral"
        />
      </div>

      <FunnelStrip funnel={kpis.funnel} onStageClick={onFunnelStageClick} />
    </div>
  );
}

interface KpiTileProps {
  label: string;
  value: string;
  hint: string;
  icon: string;
  tone: "primary" | "emerald" | "rose" | "neutral";
}

function KpiTile({ label, value, hint, icon, tone }: KpiTileProps) {
  const iconColor =
    tone === "primary"
      ? "text-primary"
      : tone === "emerald"
        ? "text-chip-emerald-text"
        : tone === "rose"
          ? "text-chip-rose-text"
          : "text-on-surface-variant";
  return (
    <div className="rounded-sm border border-outline-variant bg-surface-container p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-label-caps uppercase tracking-wider text-on-surface-variant">{label}</span>
        <span className={`material-symbols-outlined text-base ${iconColor}`}>{icon}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        {/* `font-mono`, not `text-data-mono` (finding N4, true Overview.tsx
            parity — its own `Kpi` component's value span uses `font-mono
            text-3xl ...` verbatim): `text-data-mono` carries its own fixed
            13px font-size token, which conflicted with `text-2xl` here —
            `font-mono` applies only the monospace font family, leaving
            `text-2xl` as the one size utility in play. */}
        <span className="truncate font-mono text-2xl font-bold tabular-nums text-on-surface">
          {value}
        </span>
      </div>
      <p
        className={`mt-1 text-[11px] ${tone === "rose" ? "font-semibold text-chip-rose-text" : "text-on-surface-variant"}`}
      >
        {hint}
      </p>
    </div>
  );
}

// Funnel segment fill per stage. A ramp on the single sanctioned accent
// token (`primary`, at increasing alpha) rather than a hand-picked hex per
// stage — the same "intensity ramp" pattern PRD §2.7 point 4 specs for the
// Executive workload heatmap (`bg-primary/10..40`), reused here so a stage
// reads as "further along the funnel" the same way across both surfaces.
// HOLD breaks the ramp deliberately: it's not a funnel position, it's an
// attention state, so it gets the same amber `StageChip`/DESIGN.md already
// use for HOLD everywhere else instead of implying progress. DROP is
// excluded from the funnel entirely (PRD §2.3) — its entry exists only so
// this Record is total over `PipelineStage`.
//
// The ramp NUMBERS come from `STAGE_ALPHA` (lib/pipelineFormat.ts, finding
// N2) — this table only translates them into the matching Tailwind class,
// kept as literal `bg-primary/NN` strings (not string-interpolated) so
// Tailwind's content scanner can still find each one as a literal
// substring in this file.
const ALPHA_TO_BG_PRIMARY_CLASS: Record<number, string> = {
  [STAGE_ALPHA.ASSESSMENT]: "bg-primary/20",
  [STAGE_ALPHA.RFP]: "bg-primary/35",
  [STAGE_ALPHA.POC]: "bg-primary/50",
  [STAGE_ALPHA.TECHNICAL_CLARIFICATION]: "bg-primary/65",
  [STAGE_ALPHA.DELIVER_PROPOSAL]: "bg-primary/80",
  [STAGE_ALPHA.WAITING_RESPONSE]: "bg-primary/90",
  [STAGE_ALPHA.WON]: "bg-primary",
};

const FUNNEL_FILL: Record<PipelineStage, string> = {
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

function FunnelStrip({
  funnel,
  onStageClick,
}: {
  funnel: FunnelBucket[];
  onStageClick?: (stage: PipelineStage) => void;
}) {
  const visible = funnel.filter((f) => f.count > 0);

  if (visible.length === 0) return null;

  return (
    <div className="flex items-center gap-3">
      <span className="shrink-0 text-label-caps uppercase tracking-wider text-on-surface-variant">
        Pipeline
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex h-2.5 gap-px overflow-hidden rounded-full">
          {visible.map((f) => (
            <button
              key={f.stage}
              type="button"
              onClick={() => onStageClick?.(f.stage)}
              title={`${STAGE_LABELS[f.stage]}: ${f.count}`}
              aria-label={`${STAGE_LABELS[f.stage]}: ${f.count}, scroll to column`}
              style={{ flexGrow: f.count }}
              className={`h-full ${FUNNEL_FILL[f.stage]} ${onStageClick ? "cursor-pointer" : "cursor-default"}`}
            />
          ))}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-3">
          {visible.map((f) => (
            <span key={f.stage} className="flex items-center gap-1 text-[11px] text-on-surface-variant">
              <span className={`h-2 w-2 rounded-full ${FUNNEL_FILL[f.stage]}`} />
              {STAGE_LABELS[f.stage]} {f.count}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
