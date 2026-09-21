import { useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState } from "@/components/EmptyState";
import { ProjectStatusChip } from "@/components/StatusChip";
import { dayFromIso, dayToDate } from "@/lib/dateField";
import { parseISODate } from "@/lib/gantt/geometry";
import type { PortfolioProjectRow } from "@/lib/queries";

// Sorts portfolio rows for timeline-style display: overdue projects first
// (worst first), then scheduled projects by end date, then unscheduled
// projects last, alphabetically. Mirrors the comparator previously inlined
// in Executive.tsx's PortfolioTimelinesSection.
export function sortPortfolioRows(
  rows: PortfolioProjectRow[],
): PortfolioProjectRow[] {
  return [...rows].sort((a, b) => {
    if (a.isOverdue && b.isOverdue) return b.daysOverdue - a.daysOverdue;
    if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
    if (a.end && b.end) return a.end.localeCompare(b.end);
    if (a.end) return -1;
    if (b.end) return 1;
    return a.name.localeCompare(b.name);
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Portfolio Timelines — Calendar view (horizontal year-roadmap)
// ─────────────────────────────────────────────────────────────────────────

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const MIN_BAR_WIDTH_PCT = 1;

// Width of the label column (project name · customer, status chip). Shared
// by the row label, the month-header spacer and the Today-line spacer so
// the three can never drift apart.
const LABEL_COL_CLASS = "w-64";

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

// Single color-by-state mapping, shared by bar fills and the legend swatches
// below so the two can never drift out of sync.
const CALENDAR_TONE = {
  overdue: "bg-error",
  active: "bg-primary",
  planning: "bg-chip-amber-bg",
  muted: "bg-on-surface-variant/40",
};

function barTone(p: PortfolioProjectRow): string {
  if (p.isOverdue) return CALENDAR_TONE.overdue;
  if (p.status === "ACTIVE") return CALENDAR_TONE.active;
  if (p.status === "COMPLETED") return CALENDAR_TONE.muted;
  if (p.status === "PLANNING" || p.status === "ON_HOLD") {
    return CALENDAR_TONE.planning;
  }
  return CALENDAR_TONE.muted; // CANCELLED
}

const CALENDAR_LEGEND = [
  { label: "Overdue", tone: CALENDAR_TONE.overdue },
  { label: "Active", tone: CALENDAR_TONE.active },
  { label: "Planning · On-hold", tone: CALENDAR_TONE.planning },
  { label: "Completed", tone: CALENDAR_TONE.muted },
];

const DEFAULT_UNSCHEDULED_NOTE = (n: number): string =>
  `${n} project${n === 1 ? "" : "s"} ha${n === 1 ? "s" : "ve"} no scheduled dates — see List view.`;

export function PortfolioCalendar({
  projects,
  unscheduledNote = DEFAULT_UNSCHEDULED_NOTE,
}: {
  projects: PortfolioProjectRow[];
  unscheduledNote?: (count: number) => string;
}) {
  const [year, setYear] = useState<number>(new Date().getFullYear());

  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year + 1, 0, 1);
  const yearSpanMs = yearEnd.getTime() - yearStart.getTime();

  const unscheduledCount = projects.filter(
    (p) => p.start === null || p.end === null,
  ).length;

  const inYear = projects
    .filter((p): p is PortfolioProjectRow & { start: string; end: string } =>
      p.start !== null && p.end !== null,
    )
    .map((p) => ({
      p,
      start: parseISODate(p.start),
      end: parseISODate(p.end),
    }))
    .filter(({ start, end }) => end >= yearStart && start < yearEnd);

  const today = new Date();
  const showTodayLine = year === today.getFullYear();
  const todayFrac = clamp01(
    (today.getTime() - yearStart.getTime()) / yearSpanMs,
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setYear((y) => y - 1)}
            aria-label="Previous year"
            className="flex h-6 w-6 items-center justify-center rounded-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
          >
            <span className="material-symbols-outlined text-[17px]">
              chevron_left
            </span>
          </button>
          <span className="min-w-[4ch] text-center font-mono text-[13px] font-semibold text-on-surface">
            {year}
          </span>
          <button
            type="button"
            onClick={() => setYear((y) => y + 1)}
            aria-label="Next year"
            className="flex h-6 w-6 items-center justify-center rounded-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
          >
            <span className="material-symbols-outlined text-[17px]">
              chevron_right
            </span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {CALENDAR_LEGEND.map((item) => (
            <span
              key={item.label}
              className="inline-flex items-center gap-1.5 text-[11px] text-on-surface-variant"
            >
              <span className={`h-2 w-2 rounded-full ${item.tone}`} />
              {item.label}
            </span>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-sm border border-outline-variant bg-surface-container-lowest">
        <div className="min-w-[784px]">
          <div className="flex items-center gap-3 border-b border-outline-variant bg-surface-container-low px-3">
            <div className={`${LABEL_COL_CLASS} shrink-0`} />
            <div className="grid flex-1 grid-cols-12">
              {MONTH_LABELS.map((label, i) => (
                <div
                  key={label}
                  className={`px-1.5 py-1.5 text-center font-display text-label-caps uppercase tracking-widest text-on-surface-variant ${
                    i > 0 ? "border-l border-outline-variant" : ""
                  }`}
                >
                  {label}
                </div>
              ))}
            </div>
          </div>

          {inYear.length === 0 ? (
            <div className="p-3">
              <EmptyState message={`No projects scheduled in ${year}.`} />
            </div>
          ) : (
            <div className="relative">
              {showTodayLine && (
                <div className="pointer-events-none absolute inset-0 z-10 flex gap-3 px-3">
                  <div className={`${LABEL_COL_CLASS} shrink-0`} />
                  <div className="relative flex-1">
                    <div
                      className="absolute top-0 h-full border-l border-dashed border-primary"
                      style={{ left: `${todayFrac * 100}%` }}
                    >
                      <span className="absolute -top-0.5 left-1 whitespace-nowrap rounded-sm bg-primary px-1 py-0.5 font-display text-[9px] font-bold uppercase leading-none text-on-primary">
                        Today
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {inYear.map(({ p, start, end }) => {
                const leftFrac = clamp01(
                  (start.getTime() - yearStart.getTime()) / yearSpanMs,
                );
                const rightFrac = clamp01(
                  (end.getTime() - yearStart.getTime()) / yearSpanMs,
                );
                const widthPct = Math.max(
                  (rightFrac - leftFrac) * 100,
                  MIN_BAR_WIDTH_PCT,
                );
                const clippedStart = start < yearStart;
                const clippedEnd = end >= yearEnd;
                // One condition drives both the tooltip and the rendered
                // link, so the title can never advertise a customer the
                // row doesn't show.
                const customer =
                  p.customerId !== null && p.customerName !== null
                    ? { id: p.customerId, name: p.customerName }
                    : null;

                return (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 border-t border-outline-variant px-3 py-2 first:border-t-0"
                  >
                    <div
                      className={`flex ${LABEL_COL_CLASS} shrink-0 flex-col items-start gap-0.5`}
                    >
                      {/* One truncating line: the project name, then the
                          customer. The customer is what gets cut on a long
                          pair, and `title` carries the full text. The
                          project name stays the only primary-coloured
                          element at rest — the customer link is muted and
                          takes the same hover treatment the Overview page
                          gives its customer links. */}
                      <div
                        className="w-full min-w-0 truncate"
                        title={
                          customer ? `${p.name} · ${customer.name}` : p.name
                        }
                      >
                        <Link
                          to={`/projects/${p.id}`}
                          className="font-semibold text-primary hover:underline"
                        >
                          {p.name}
                        </Link>
                        {customer && (
                          <span className="text-on-surface-variant">
                            {" · "}
                            <Link
                              to={`/customers/${customer.id}`}
                              className="hover:text-primary hover:underline"
                            >
                              {customer.name}
                            </Link>
                          </span>
                        )}
                      </div>
                      <ProjectStatusChip status={p.status} />
                    </div>
                    <div className="relative h-5 flex-1">
                      <div className="pointer-events-none absolute inset-0 grid grid-cols-12">
                        {MONTH_LABELS.map((label, i) => (
                          <div
                            key={label}
                            className={
                              i > 0 ? "border-l border-outline-variant/50" : ""
                            }
                          />
                        ))}
                      </div>
                      <div
                        title={`${fmtDate(p.start)} → ${fmtDate(p.end)} · ${p.progressPct}%`}
                        className={`absolute top-1/2 flex h-2.5 -translate-y-1/2 items-center rounded-full ${barTone(p)}`}
                        style={{
                          left: `${leftFrac * 100}%`,
                          width: `${widthPct}%`,
                        }}
                      >
                        {clippedStart && (
                          <span className="absolute -left-3 text-[10px] leading-none text-on-surface-variant">
                            ‹
                          </span>
                        )}
                        {clippedEnd && (
                          <span className="absolute -right-3 text-[10px] leading-none text-on-surface-variant">
                            ›
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {unscheduledCount > 0 && (
        <p className="text-[11px] text-on-surface-variant">
          {unscheduledNote(unscheduledCount)}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────────────

export function fmtDate(iso: string | null): string {
  // `iso` is a rollup instant
  // (`PortfolioProjectRow.start`/`.end`, min/max of `Task.startDate`/
  // `dueDate` — see backend/src/lib/portfolio.ts) and therefore day-semantic;
  // derive the day via the UTC date-part, not a local-time parse, so the
  // tooltip agrees with the bar (which already reads via `parseISODate`,
  // the same UTC-slice pattern).
  const d = dayToDate(dayFromIso(iso));
  if (!d) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
