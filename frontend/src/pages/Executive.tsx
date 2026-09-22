import { useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState } from "@/components/EmptyState";
import {
  fmtDate,
  PortfolioCalendar,
  sortPortfolioRows,
} from "@/components/portfolio/PortfolioCalendar";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { ProjectStatusChip } from "@/components/StatusChip";
import { type PortfolioProjectRow, useExecutiveReport } from "@/lib/queries";

// Executive dashboard — org-wide portfolio roll-up. Two blocks: an
// "Overdue Projects" worklist (the thing an executive scans first) and a
// "Portfolio Timelines" progress-bar overview of every project. Both are
// derived client-side from the single GET /reports/executive payload — no
// extra fetches per project.
export function Executive() {
  const { data, isLoading, isError, error } = useExecutiveReport();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-on-surface">
          Executive
        </h1>
        <p className="text-sm text-on-surface-variant">
          Org-wide portfolio roll-up across every TAM's projects.
        </p>
      </div>

      {isLoading && (
        <div className="h-32 animate-pulse rounded-sm border border-outline-variant bg-surface-container-low" />
      )}

      {isError && (
        <Alert variant="destructive">
          <AlertDescription>Could not load executive report: {(error as Error).message}</AlertDescription>
        </Alert>
      )}

      {data && <ExecutiveBody data={data} />}
    </div>
  );
}

function ExecutiveBody({
  data,
}: {
  data: { projects: PortfolioProjectRow[]; generatedAt: string };
}) {
  const { projects, generatedAt } = data;
  const overdue = projects.filter((p) => p.isOverdue);

  if (projects.length === 0) {
    return (
      <div className="space-y-8">
        <EmptyState
          icon="query_stats"
          title="No projects yet"
          message="Once projects exist across the org, they'll show up here as a portfolio roll-up."
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <p className="rounded-sm border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface">
        {projects.length} project{projects.length === 1 ? "" : "s"} ·{" "}
        <span className={overdue.length > 0 ? "font-semibold text-error" : ""}>
          {overdue.length} overdue
        </span>{" "}
        · Updated {fmtDateTime(generatedAt)}
      </p>

      <OverdueProjectsSection projects={overdue} />
      <PortfolioTimelinesSection projects={projects} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Block A — Overdue Projects
// ─────────────────────────────────────────────────────────────────────────

function OverdueProjectsSection({
  projects,
}: {
  projects: PortfolioProjectRow[];
}) {
  const sorted = [...projects].sort((a, b) => b.daysOverdue - a.daysOverdue);

  return (
    <section className="space-y-3">
      <header className="flex items-center gap-2">
        <h2 className="font-display text-base font-bold text-on-surface">
          Overdue Projects
        </h2>
        <span className="inline-flex items-center rounded-full bg-error-container px-2 py-0.5 font-mono text-[11px] font-semibold text-on-error-container">
          {sorted.length}
        </span>
      </header>

      {sorted.length === 0 ? (
        <EmptyState
          icon="task_alt"
          message="No overdue projects — everything is on schedule."
        />
      ) : (
        <div className="overflow-x-auto rounded-sm border border-outline-variant bg-surface-container-lowest">
          {/* Desktop grid */}
          <div className="hidden grid-cols-[minmax(200px,1.6fr)_140px_160px_140px_120px] items-center border-b border-outline-variant bg-surface-container-low px-3 py-2 font-display text-label-caps uppercase tracking-widest text-on-surface-variant md:grid">
            <span>Project</span>
            <span>TAM</span>
            <span>Customer</span>
            <span>Committed end</span>
            <span className="text-right">Overdue by</span>
          </div>

          {sorted.map((p) => (
            <OverdueRow key={p.id} project={p} />
          ))}
        </div>
      )}
    </section>
  );
}

function OverdueRow({ project: p }: { project: PortfolioProjectRow }) {
  return (
    <>
      {/* Desktop row */}
      <div className="hidden grid-cols-[minmax(200px,1.6fr)_140px_160px_140px_120px] items-center border-t border-outline-variant px-3 py-1.5 text-[13px] hover:bg-surface-container-low md:grid">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            to={`/projects/${p.id}`}
            className="truncate font-semibold text-primary hover:underline"
          >
            {p.name}
          </Link>
          <ProjectStatusChip status={p.status} />
        </div>
        <span className="truncate text-on-surface-variant">{p.tamName}</span>
        <span className="truncate text-on-surface-variant">
          {p.customerName ?? "—"}
        </span>
        <span className="font-mono text-[12px] text-on-surface-variant">
          {fmtDate(p.end)}
        </span>
        <span className="text-right font-semibold text-error">
          {fmtOverdueBy(p.daysOverdue)}
        </span>
      </div>

      {/* Mobile card */}
      <div className="flex flex-col gap-1.5 border-t border-outline-variant px-3 py-2 md:hidden">
        <div className="flex items-center justify-between gap-2">
          <Link
            to={`/projects/${p.id}`}
            className="truncate font-semibold text-primary hover:underline"
          >
            {p.name}
          </Link>
          <ProjectStatusChip status={p.status} />
        </div>
        <div className="flex items-center justify-between gap-2 text-[12px] text-on-surface-variant">
          <span className="truncate">
            {p.tamName} · {p.customerName ?? "—"}
          </span>
          <span className="font-mono text-[12px]">{fmtDate(p.end)}</span>
        </div>
        <div className="text-right text-[13px] font-semibold text-error">
          {fmtOverdueBy(p.daysOverdue)} overdue
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Block B — Portfolio Timelines
// ─────────────────────────────────────────────────────────────────────────

type PortfolioView = "calendar" | "list";

const PORTFOLIO_VIEWS: { view: PortfolioView; label: string }[] = [
  { view: "calendar", label: "Calendar" },
  { view: "list", label: "List" },
];

function PortfolioTimelinesSection({
  projects,
}: {
  projects: PortfolioProjectRow[];
}) {
  const [view, setView] = useState<PortfolioView>("calendar");

  const sorted = sortPortfolioRows(projects);

  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-base font-bold text-on-surface">
            Portfolio Timelines
          </h2>
          <span className="text-[12px] text-on-surface-variant">
            {sorted.length} project{sorted.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="inline-flex overflow-hidden rounded-sm border border-outline-variant">
          {PORTFOLIO_VIEWS.map((v, i) => (
            <button
              key={v.view}
              type="button"
              onClick={() => setView(v.view)}
              className={[
                "px-2.5 py-1 font-display text-label-caps uppercase tracking-wider",
                i > 0 ? "border-l border-outline-variant" : "",
                v.view === view
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container-lowest text-on-surface-variant hover:text-primary",
              ].join(" ")}
            >
              {v.label}
            </button>
          ))}
        </div>
      </header>

      {view === "calendar" ? (
        <PortfolioCalendar projects={sorted} />
      ) : (
        <PortfolioList projects={sorted} />
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Portfolio Timelines — List view (existing row/progress-bar rendering)
// ─────────────────────────────────────────────────────────────────────────

function PortfolioList({ projects }: { projects: PortfolioProjectRow[] }) {
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-on-surface-variant">
        High-level progress overview — a first pass. Phase dots below are a
        legend, not date-positioned segments.
      </p>

      <div className="space-y-2">
        {projects.map((p) => (
          <TimelineRow key={p.id} project={p} />
        ))}
      </div>
    </div>
  );
}

function TimelineRow({ project: p }: { project: PortfolioProjectRow }) {
  const hasSchedule = p.start !== null && p.end !== null;
  const fillTone = p.isOverdue ? "bg-error" : "bg-primary";

  return (
    <div className="space-y-2 rounded-sm border border-outline-variant bg-surface-container-lowest px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            to={`/projects/${p.id}`}
            className="truncate font-semibold text-primary hover:underline"
          >
            {p.name}
          </Link>
          <ProjectStatusChip status={p.status} />
        </div>
        <span className="truncate text-[12px] text-on-surface-variant">
          {p.tamName}
          {p.customerName ? ` · ${p.customerName}` : ""}
        </span>
      </div>

      {hasSchedule ? (
        <>
          <div className="flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-container-high">
              <div
                className={`h-full rounded-full ${fillTone}`}
                style={{ width: `${Math.min(100, Math.max(0, p.progressPct))}%` }}
              />
            </div>
            <span className="w-10 shrink-0 text-right font-mono text-[12px] text-on-surface-variant">
              {p.progressPct}%
            </span>
          </div>
          <div className="font-mono text-[11px] text-on-surface-variant">
            {fmtDate(p.start)} → {fmtDate(p.end)}
          </div>
        </>
      ) : (
        <p className="text-[11px] italic text-on-surface-variant">
          No scheduled tasks
        </p>
      )}

      {p.sections.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
          {p.sections.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1 text-[11px] text-on-surface-variant"
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────────────

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtOverdueBy(days: number): string {
  return `${days} day${days === 1 ? "" : "s"}`;
}
