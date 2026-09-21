// Executive "Pipeline analytics" fold-in (PRD §2.7 point 4). Mounted by
// Executive.tsx only after it has already confirmed
// `hasPermission(user, "pipeline:view")` (in addition to the page's own
// `report:executive` guard) — this component assumes that gate and
// unconditionally calls useOpportunities() on mount, so a user without
// Pipeline access never triggers the /api/opportunities request. Same
// "gate at the mount boundary" convention `PipelineOverviewPanel.tsx`
// documents for the Overview fold-in.
//
// Chart approach: this is Executive.tsx's first chart-library use.
// Recharts (`recharts@^2.13.0`) is already a Solvro frontend dependency —
// today exercised only by `pages/views/ProjectOverview.tsx`'s S-Curve chart
// — so no new dependency is added (CLAUDE.md hard guardrail). Colors are
// raw `rgb(var(--token) / alpha)` strings (ProjectOverview.tsx's own
// convention — recharts `fill`/`stroke` need real CSS color values, not
// Tailwind utility classes), reusing the exact alpha ramp
// PipelineKpiBar.tsx's `FUNNEL_FILL` and PipelineOverviewPanel.tsx's
// `STAGE_FILL` already use as Tailwind classes, so a stage reads the same
// "how far along the funnel" way on every Pipeline surface.
//
// The workload heatmap stays a plain HTML table (like VeloraApp's own
// `workload-heatmap.tsx` reference) rather than `reui/data-grid` — its
// column set is a numeric grid (PIC × 6 stages) that doesn't map onto
// data-grid's per-column-def architecture the way the PIC performance
// table's tabular fields do; PRD §2.7 point 2 only asks for data-grid on
// the PIC performance table specifically.
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { AssigneeAvatar } from "@/components/AssigneeAvatar";
import {
  computeMonthlyTrend,
  computePicLeaderboard,
  computeStageFunnel,
  computeWorkloadHeatmap,
  HEATMAP_STAGES,
  workloadStatusTone,
  type MonthlyTrendPoint,
  type PicLeaderboardRow,
  type StageFunnelBucket,
  type WorkloadHeatmapRow,
} from "@/components/pipeline/analytics";
import { PicDrillDownModal } from "@/components/pipeline/PicDrillDownModal";
import { EmptyState } from "@/components/EmptyState";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { DataGrid, DataGridContainer } from "@/components/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";
import { Chip } from "@/components/StatusChip";
import { formatIDRCompact, STAGE_ALPHA, STAGE_LABELS, type PipelineStage } from "@/lib/pipelineFormat";
import { useOpportunities, type Opportunity } from "@/lib/queries";

const PANEL_CLASS = "rounded-sm border border-outline-variant bg-surface-container-lowest p-4";
const PANEL_HEADING = "text-label-caps uppercase tracking-wider text-on-surface-variant";

export function PipelineAnalyticsSection() {
  const { data: deals, isLoading, isError, error } = useOpportunities();
  const [selectedPic, setSelectedPic] = useState<{ id: number; name: string } | null>(null);

  return (
    <section className="space-y-4">
      <header>
        <h2 className="font-display text-base font-bold text-on-surface">Pipeline analytics</h2>
        <p className="mt-0.5 text-xs text-on-surface-variant">
          Stage funnel, PIC performance, and workload across every opportunity in the Pipeline.
        </p>
      </header>

      {isLoading && (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-64 animate-pulse rounded-sm border border-outline-variant bg-surface-container-low" />
          ))}
        </div>
      )}

      {isError && (
        <Alert variant="destructive">
          <AlertDescription>Could not load Pipeline analytics: {(error as Error).message}</AlertDescription>
        </Alert>
      )}

      {deals && deals.length === 0 && (
        <EmptyState
          icon="monitoring"
          title="No Pipeline deals yet"
          message="Once opportunities exist in the Pipeline, analytics show up here."
        />
      )}

      {deals && deals.length > 0 && (
        <AnalyticsBody
          deals={deals}
          onSelectPic={(id, name) => setSelectedPic({ id, name })}
        />
      )}

      <PicDrillDownModal
        picId={selectedPic?.id ?? null}
        picName={selectedPic?.name ?? ""}
        deals={deals ?? EMPTY_DEALS}
        onClose={() => setSelectedPic(null)}
      />
    </section>
  );
}

const EMPTY_DEALS: Opportunity[] = [];

function AnalyticsBody({
  deals,
  onSelectPic,
}: {
  deals: Opportunity[];
  onSelectPic: (picId: number, picName: string) => void;
}) {
  const funnel = computeStageFunnel(deals);
  const leaderboard = computePicLeaderboard(deals);
  const trend = computeMonthlyTrend(deals);
  const heatmap = computeWorkloadHeatmap(deals);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <StageFunnelPanel funnel={funnel} />
        <LeaderboardPanel rows={leaderboard} onSelectPic={onSelectPic} />
      </div>
      <PicPerformancePanel rows={leaderboard} onSelectPic={onSelectPic} />
      <TrendPanel trend={trend} />
      <WorkloadHeatmapPanel rows={heatmap} onSelectPic={onSelectPic} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 1. Conversion funnel
// ─────────────────────────────────────────────────────────────────────────

// Raw CSS color strings (not Tailwind classes) for recharts `fill` — same
// alpha steps as PipelineKpiBar.tsx's `FUNNEL_FILL` / PipelineOverviewPanel
// .tsx's `STAGE_FILL`, now all three sourced from the single `STAGE_ALPHA`
// ramp (lib/pipelineFormat.ts, finding N2) instead of three independent
// hardcoded copies of the same seven numbers. Unlike those two Tailwind-
// class sites, these are plain runtime-interpolated CSS strings (not
// scanned/purged by Tailwind), so they can reference `STAGE_ALPHA` directly
// with no literal-class lookup indirection needed. DROP's/HOLD's entries
// exist only so the Record stays total over `PipelineStage` (the funnel
// itself excludes DROP) — same documented reasoning those two files
// already use.
const STAGE_FILL: Record<PipelineStage, string> = {
  ASSESSMENT: `rgb(var(--primary) / ${STAGE_ALPHA.ASSESSMENT})`,
  RFP: `rgb(var(--primary) / ${STAGE_ALPHA.RFP})`,
  POC: `rgb(var(--primary) / ${STAGE_ALPHA.POC})`,
  TECHNICAL_CLARIFICATION: `rgb(var(--primary) / ${STAGE_ALPHA.TECHNICAL_CLARIFICATION})`,
  DELIVER_PROPOSAL: `rgb(var(--primary) / ${STAGE_ALPHA.DELIVER_PROPOSAL})`,
  WAITING_RESPONSE: `rgb(var(--primary) / ${STAGE_ALPHA.WAITING_RESPONSE})`,
  WON: "rgb(var(--primary))",
  DROP: "rgb(var(--rose-text))",
  HOLD: "rgb(var(--amber-text))",
};

function StageFunnelPanel({ funnel }: { funnel: StageFunnelBucket[] }) {
  return (
    <section className={PANEL_CLASS}>
      <h3 className={`${PANEL_HEADING} mb-3`}>Conversion funnel</h3>
      <div className="h-72 w-full">
        <ResponsiveContainer>
          <BarChart data={funnel} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="rgb(var(--outline-variant))" strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              allowDecimals={false}
              tick={{ fontSize: 11, fill: "rgb(var(--on-surface-variant))" }}
              tickLine={false}
              axisLine={{ stroke: "rgb(var(--outline-variant))" }}
            />
            <YAxis
              dataKey="label"
              type="category"
              width={132}
              tick={{ fontSize: 11, fill: "rgb(var(--on-surface-variant))" }}
              tickLine={false}
              axisLine={{ stroke: "rgb(var(--outline-variant))" }}
            />
            <Tooltip
              contentStyle={{ borderRadius: 8, border: "1px solid rgb(var(--outline-variant))", fontSize: 12 }}
              labelStyle={{ fontSize: 11, color: "rgb(var(--on-surface-variant))" }}
              formatter={(value: number) => [value, "Deals"]}
            />
            <Bar dataKey="count" radius={[0, 4, 4, 0]}>
              {funnel.map((f) => (
                <Cell key={f.stage} fill={STAGE_FILL[f.stage]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {funnel
          .filter((f) => f.count > 0)
          .map((f) => (
            <div key={f.stage} className="rounded-sm border border-outline-variant px-2 py-1.5">
              <p className="truncate text-[11px] text-on-surface-variant">{f.label}</p>
              <p className="font-mono text-sm font-semibold text-on-surface">{f.count}</p>
              <p className="text-[10px] text-on-surface-variant">{formatIDRCompact(f.value)}</p>
            </div>
          ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 2. PIC leaderboard + performance table
// ─────────────────────────────────────────────────────────────────────────

function LeaderboardPanel({
  rows,
  onSelectPic,
}: {
  rows: PicLeaderboardRow[];
  onSelectPic: (picId: number, picName: string) => void;
}) {
  const top = rows.filter((r) => r.wonCount > 0).slice(0, 5);

  return (
    <section className={PANEL_CLASS}>
      <h3 className={`${PANEL_HEADING} mb-3`}>Top PIC by won value</h3>
      {top.length === 0 ? (
        <EmptyState icon="emoji_events" message="No won deals yet." />
      ) : (
        <ul className="space-y-2">
          {top.map((row, i) => (
            <li key={row.picId}>
              <button
                type="button"
                onClick={() => onSelectPic(row.picId, row.picName)}
                className="flex w-full items-center gap-3 rounded-sm border border-outline-variant px-3 py-2 text-left hover:border-primary hover:bg-surface-container"
              >
                <span className="w-5 shrink-0 text-center font-mono text-xs font-bold text-on-surface-variant">
                  #{i + 1}
                </span>
                <AssigneeAvatar user={{ id: row.picId, username: row.picName }} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-on-surface">{row.picName}</p>
                  <p className="text-[11px] text-on-surface-variant">
                    {row.wonCount} won · {row.activeCount} active
                  </p>
                </div>
                <span className="shrink-0 font-mono text-sm font-semibold text-primary">
                  {formatIDRCompact(row.wonValue)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PicPerformancePanel({
  rows,
  onSelectPic,
}: {
  rows: PicLeaderboardRow[];
  onSelectPic: (picId: number, picName: string) => void;
}) {
  // Default sort: wonValue descending (finding S3) — matches the
  // reference's own `ORDER BY won_value DESC`
  // (../VeloraApp/app/api/admin/analytics/pic-performance/route.ts) and
  // `computePicLeaderboard`'s own primary sort key (analytics.ts), so the
  // table's unsorted/default order already reads the same as its rows
  // arrive — clicking a header is a genuine re-sort, not the first one.
  const [sorting, setSorting] = useState<SortingState>([{ id: "wonValue", desc: true }]);

  const columns: ColumnDef<PicLeaderboardRow>[] = [
    {
      id: "pic",
      accessorKey: "picName",
      header: ({ column }) => <DataGridColumnHeader column={column} title="PIC" />,
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <AssigneeAvatar user={{ id: row.original.picId, username: row.original.picName }} size="xs" />
          <span className="truncate font-medium text-on-surface">{row.original.picName}</span>
        </div>
      ),
    },
    {
      id: "active",
      accessorKey: "activeCount",
      // Title comes from `meta.headerTitle` below (finding N3), not an
      // explicit `title` prop — "Active" alone undersold what the column
      // counts: `computePicLeaderboard`'s `activeCount` reuses `kpi.ts`'s
      // `isActiveDeal`, which counts HOLD as active too.
      header: ({ column }) => <DataGridColumnHeader column={column} />,
      cell: ({ row }) => <span className="tabular-nums">{row.original.activeCount}</span>,
      meta: {
        headerClassName: "text-right",
        cellClassName: "text-right",
        headerTitle: "Active (incl. On Hold)",
      },
    },
    {
      id: "activeValue",
      accessorKey: "activeValue",
      header: ({ column }) => <DataGridColumnHeader column={column} title="Active value" />,
      cell: ({ row }) => (
        <span className="font-mono tabular-nums">{formatIDRCompact(row.original.activeValue)}</span>
      ),
      meta: { headerClassName: "text-right", cellClassName: "text-right" },
    },
    {
      id: "won",
      accessorKey: "wonCount",
      header: ({ column }) => <DataGridColumnHeader column={column} title="Won" />,
      cell: ({ row }) => <span className="tabular-nums text-primary">{row.original.wonCount}</span>,
      meta: { headerClassName: "text-right", cellClassName: "text-right" },
    },
    {
      id: "wonValue",
      accessorKey: "wonValue",
      header: ({ column }) => <DataGridColumnHeader column={column} title="Won value" />,
      cell: ({ row }) => (
        <span className="font-mono tabular-nums text-primary">{formatIDRCompact(row.original.wonValue)}</span>
      ),
      meta: { headerClassName: "text-right", cellClassName: "text-right" },
    },
    {
      id: "winRate",
      accessorKey: "winRatePct",
      header: ({ column }) => <DataGridColumnHeader column={column} title="Win rate" />,
      cell: ({ row }) => <span className="tabular-nums">{row.original.winRatePct}%</span>,
      meta: { headerClassName: "text-right", cellClassName: "text-right" },
    },
  ];

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (row) => String(row.picId),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <section className={PANEL_CLASS}>
      <h3 className={`${PANEL_HEADING} mb-3`}>PIC performance</h3>
      {rows.length === 0 ? (
        <EmptyState icon="groups" message="No PIC assigned to any deal yet." />
      ) : (
        <DataGrid
          table={table}
          recordCount={rows.length}
          onRowClick={(row) => onSelectPic(row.picId, row.picName)}
          tableLayout={{ dense: true, rowBorder: true, headerBorder: true, headerBackground: false, width: "auto" }}
          tableClassNames={{ header: "bg-surface-container-low" }}
        >
          <DataGridContainer className="rounded-sm border border-outline-variant bg-surface-container-lowest">
            <DataGridScrollArea>
              <DataGridTable />
            </DataGridScrollArea>
          </DataGridContainer>
        </DataGrid>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Monthly trend
// ─────────────────────────────────────────────────────────────────────────

function TrendPanel({ trend }: { trend: MonthlyTrendPoint[] }) {
  return (
    <section className={PANEL_CLASS}>
      <h3 className={`${PANEL_HEADING} mb-3`}>Created vs. won (12 months)</h3>
      <div className="h-64 w-full">
        <ResponsiveContainer>
          <ComposedChart data={trend} margin={{ top: 4, right: 16, bottom: 0, left: -8 }}>
            <CartesianGrid stroke="rgb(var(--outline-variant))" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "rgb(var(--on-surface-variant))" }}
              tickLine={false}
              axisLine={{ stroke: "rgb(var(--outline-variant))" }}
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 11, fill: "rgb(var(--on-surface-variant))" }}
              tickLine={false}
              axisLine={{ stroke: "rgb(var(--outline-variant))" }}
            />
            <Tooltip
              contentStyle={{ borderRadius: 8, border: "1px solid rgb(var(--outline-variant))", fontSize: 12 }}
              labelStyle={{ fontSize: 11, color: "rgb(var(--on-surface-variant))" }}
            />
            <Bar dataKey="created" name="Created" fill="rgb(var(--on-surface-variant) / 0.35)" radius={[3, 3, 0, 0]} />
            <Line
              type="monotone"
              dataKey="won"
              name="Won"
              stroke="rgb(var(--primary))"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex gap-4 text-[11px] text-on-surface-variant">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "rgb(var(--on-surface-variant) / 0.35)" }} />
          Created
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-primary" />
          Won
        </span>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Workload heatmap
// ─────────────────────────────────────────────────────────────────────────

// Intensity ramp per PRD §2.7 point 4: `primary` alpha steps (bg-primary/
// 10..40), not Velora's green/yellow/red hexes — same "read as one system"
// call PipelineKpiBar.tsx's own funnel fill already documents.
function heatmapCellClass(count: number): string {
  if (count === 0) return "bg-surface-container-high text-on-surface-variant";
  if (count === 1) return "bg-primary/10 text-on-surface";
  if (count === 2) return "bg-primary/20 text-on-surface";
  if (count === 3) return "bg-primary/30 text-on-surface";
  return "bg-primary/40 text-on-surface";
}

const STATUS_LABEL: Record<WorkloadHeatmapRow["status"], string> = {
  overload: "Overload",
  underload: "Underload",
  normal: "Normal",
};

function WorkloadHeatmapPanel({
  rows,
  onSelectPic,
}: {
  rows: WorkloadHeatmapRow[];
  onSelectPic: (picId: number, picName: string) => void;
}) {
  return (
    <section className={PANEL_CLASS}>
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className={PANEL_HEADING}>Workload heatmap</h3>
        <p className="text-[11px] text-on-surface-variant">Active deals across the 6 in-motion stages</p>
      </header>

      {rows.length === 0 ? (
        <EmptyState icon="grid_view" message="No PIC assigned to any deal yet." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-outline-variant text-left">
                <th className="px-2 py-2 font-display text-label-caps uppercase tracking-wider text-on-surface-variant">
                  PIC
                </th>
                <th className="px-2 py-2 text-center font-display text-label-caps uppercase tracking-wider text-on-surface-variant">
                  Status
                </th>
                {HEATMAP_STAGES.map((stage) => (
                  <th
                    key={stage}
                    className="px-2 py-2 text-center font-display text-[10px] uppercase tracking-wider text-on-surface-variant"
                  >
                    {STAGE_LABELS[stage]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.picId} className="border-b border-outline-variant last:border-0 hover:bg-surface-container">
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={() => onSelectPic(row.picId, row.picName)}
                      className="flex items-center gap-2 text-left hover:text-primary"
                    >
                      <AssigneeAvatar user={{ id: row.picId, username: row.picName }} size="xs" />
                      <span className="truncate font-medium text-on-surface">{row.picName}</span>
                    </button>
                  </td>
                  <td className="px-2 py-2 text-center">
                    <Chip tone={workloadStatusTone(row.status)}>{STATUS_LABEL[row.status]}</Chip>
                  </td>
                  {row.byStage.map(({ stage, count }) => (
                    <td key={stage} className="px-2 py-2 text-center">
                      <span
                        className={`inline-flex h-7 w-7 items-center justify-center rounded-sm font-mono text-xs font-semibold ${heatmapCellClass(count)}`}
                      >
                        {count}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
