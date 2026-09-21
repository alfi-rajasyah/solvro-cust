import { Link } from "react-router-dom";
import { PipelineOverviewPanel } from "@/components/pipeline/PipelineOverviewPanel";
import {
  PortfolioCalendar,
  sortPortfolioRows,
} from "@/components/portfolio/PortfolioCalendar";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { ProjectStatusChip } from "@/components/StatusChip";
import { hasPermission, useAuth } from "@/lib/auth";
import { dayLabel } from "@/lib/dailyReviewStats";
import { dayFromIso } from "@/lib/dateField";
import {
  type OverviewResponse,
  type ProjectStatus,
  type RecentNote,
  useOverview,
  useRecentNotes,
} from "@/lib/queries";

export function Overview() {
  const { user } = useAuth();
  const { data, isLoading, isError, error } = useOverview();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-on-surface">
          Welcome back, {firstNameOf(user)}.
        </h1>
        <p className="text-sm text-on-surface-variant">
          A high-density snapshot of your active workload.
        </p>
      </div>

      {isLoading && <SkeletonGrid />}

      {isError && (
        <Alert variant="destructive">
          <AlertDescription>Could not load overview: {(error as Error).message}</AlertDescription>
        </Alert>
      )}

      {data && <OverviewBody data={data} />}

      {/* Pipeline fold-in (PRD §2.7) — gated on pipeline:view so a TAM
          without Pipeline access sees no panel at all, not an empty shell,
          and never triggers the underlying opportunities fetch. Renders
          independently of useOverview()'s own loading/error state, since
          it owns its own data (useOpportunities()). */}
      {hasPermission(user, "pipeline:view") && <PipelineOverviewPanel />}
    </div>
  );
}

function OverviewBody({ data }: { data: OverviewResponse }) {
  const activeProjects = data.projectStatusCounts.ACTIVE ?? 0;
  const totalTasks = data.taskCounts.TODO + data.taskCounts.IN_PROGRESS + data.taskCounts.DONE;
  const openTasks = data.taskCounts.TODO + data.taskCounts.IN_PROGRESS;
  const completionRate = totalTasks === 0 ? 0 : Math.round((data.taskCounts.DONE / totalTasks) * 100);

  return (
    <>
      {/* KPI strip */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Active Projects"
          value={activeProjects}
          hint={`${data.projectCount} total`}
          icon="folder_open"
          tone="primary"
        />
        <Kpi
          label="Open Tasks"
          value={openTasks}
          hint={`${data.taskCounts.IN_PROGRESS} in progress`}
          icon="task_alt"
          tone="primary"
        />
        <Kpi
          label="Completed"
          value={data.taskCounts.DONE}
          hint={totalTasks > 0 ? `${completionRate}% of all tasks` : "—"}
          icon="trending_up"
          tone="emerald"
        />
        <Kpi
          label="Total tasks"
          value={totalTasks}
          hint={`${data.taskCounts.TODO} to do`}
          icon="checklist"
          tone="neutral"
        />
      </div>

      {/* Full-width portfolio timeline */}
      <section className="space-y-3">
        <header>
          <h3 className="font-display text-sm font-bold text-on-surface">Portfolio timeline</h3>
          <p className="text-[11px] text-on-surface-variant">
            Where each of your projects sits across the year
          </p>
        </header>
        {data.portfolio.length === 0 ? (
          <EmptyHint label="No projects yet." />
        ) : (
          <PortfolioCalendar
            projects={sortPortfolioRows(data.portfolio)}
            unscheduledNote={(n) =>
              `${n} project${n === 1 ? "" : "s"} ha${n === 1 ? "s" : "ve"} no scheduled dates.`
            }
          />
        )}
      </section>

      {/* Two-up: attention + recent notes */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* min-w-0 on both grid items: a grid item's automatic minimum is
            its min-content width, so a nowrap row inside either panel would
            otherwise size the single mobile column wider than the viewport
            and clip both panels. */}
        <div className="min-w-0 rounded-sm border border-outline-variant bg-surface-container-lowest p-5 lg:col-span-2">
          <header className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-sm font-bold text-on-surface">Projects needing attention</h3>
            <Link to="/projects" className="text-[11px] font-semibold text-primary hover:underline">
              View all →
            </Link>
          </header>
          {data.portfolio.length === 0 ? (
            <EmptyHint label="No projects yet." />
          ) : (
            <ul className="grid gap-2 md:grid-cols-2">
              {[...data.portfolio]
                .sort((a, b) => {
                  const ra = healthRank(a);
                  const rb = healthRank(b);
                  if (ra !== rb) return ra - rb;
                  if (ra === 0) return b.daysOverdue - a.daysOverdue;
                  return (
                    new Date(b.updatedAt).getTime() -
                    new Date(a.updatedAt).getTime()
                  );
                })
                .slice(0, 6)
                .map((p) => (
                  // min-w-0: same grid-item rule as the panels above — lets
                  // the row's `truncate` name actually shrink on a phone.
                  <li key={p.id} className="min-w-0">
                    <Link
                      to={`/projects/${p.id}`}
                      style={{
                        borderLeftWidth: 3,
                        borderLeftStyle: "solid",
                        borderLeftColor: healthColor(p),
                      }}
                      className="flex items-center gap-3 rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 transition-colors hover:border-primary"
                    >
                      <span className="font-mono text-[11px] text-on-surface-variant">P-{String(p.id).padStart(3, "0")}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-on-surface">{p.name}</span>
                      {p.isOverdue && (
                        <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold text-chip-amber-text">
                          {p.daysOverdue}d overdue
                        </span>
                      )}
                      <span className="text-[11px] text-on-surface-variant">{p.totalTasks} tasks</span>
                      <ProjectStatusChip status={p.status} />
                    </Link>
                  </li>
                ))}
            </ul>
          )}
        </div>

        <div className="min-w-0 rounded-sm border border-outline-variant bg-surface-container-lowest p-5">
          <header className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-sm font-bold text-on-surface">Recent notes</h3>
            <Link to="/daily-review" className="text-[11px] font-semibold text-primary hover:underline">
              Daily Review →
            </Link>
          </header>
          <RecentNotesFeed />
        </div>
      </div>
    </>
  );
}

interface KpiProps {
  label: string;
  value: number;
  hint?: string;
  icon: string;
  tone: "primary" | "emerald" | "amber" | "neutral";
}

function Kpi({ label, value, hint, icon, tone }: KpiProps) {
  const iconColor =
    tone === "primary"
      ? "text-primary"
      : tone === "emerald"
        ? "text-emerald-600"
        : tone === "amber"
          ? "text-amber-600"
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

// The newest daily notes — project notes and operations notes — across
// every customer the caller can see, last 7 days, newest first
// (GET /notes/recent, useRecentNotes). Read-only and in-app only; the
// panel header's Daily Review link is where notes are written. Owns its
// own query, so it loads independently of useOverview()'s skeleton.
function RecentNotesFeed() {
  const { data, isLoading, isError } = useRecentNotes();
  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-sm bg-surface-container-low" />
        ))}
      </div>
    );
  }
  // No data at all (the first load failed) vs. a failed background refetch
  // that still has the last good list — keep showing the list in that case.
  if (!data) {
    return <p className="text-xs text-error">Could not load recent notes.</p>;
  }
  return (
    <>
      {isError && <p className="mb-2 text-xs text-error">Could not refresh — showing the last loaded notes.</p>}
      {data.notes.length === 0 ? (
        <EmptyHint label={`No notes in the last ${windowDays(data.from, data.to)} days.`} />
      ) : (
        <ul className="max-h-96 divide-y divide-outline-variant overflow-y-auto text-xs">
          {data.notes.map((n) => (
            <RecentNoteRow key={`${n.kind}-${n.id}`} note={n} />
          ))}
        </ul>
      )}
    </>
  );
}

/** Inclusive day count of a "yyyy-MM-dd" window — the server owns the length. */
function windowDays(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`);
  return Math.round(ms / 86_400_000) + 1;
}

function RecentNoteRow({ note }: { note: RecentNote }) {
  const day = dayFromIso(note.noteDate);
  return (
    <li className="py-2 first:pt-0 last:pb-0">
      <div className="flex items-baseline gap-2 text-[11px] text-on-surface-variant">
        <span className="shrink-0 font-mono tabular-nums">{day ? dayLabel(day) : "—"}</span>
        <span className="min-w-0 truncate">
          {note.customer ? (
            <Link to={`/customers/${note.customer.id}`} className="hover:text-primary hover:underline">
              {note.customer.name}
            </Link>
          ) : (
            "No customer"
          )}
          {" › "}
          {note.project ? (
            <Link to={`/projects/${note.project.id}/overview`} className="hover:text-primary hover:underline">
              {note.project.name}
            </Link>
          ) : (
            "Operations"
          )}
        </span>
        <span className="ml-auto shrink-0">{note.author.username}</span>
      </div>
      {note.title && <div className="mt-0.5 truncate font-semibold text-on-surface">{note.title}</div>}
      <p className="mt-0.5 line-clamp-2 leading-snug text-on-surface">{note.body}</p>
    </li>
  );
}

function EmptyHint({ label }: { label: string }) {
  return (
    <p className="rounded-sm border border-dashed border-outline-variant px-4 py-6 text-center text-xs text-on-surface-variant">
      {label}
    </p>
  );
}

function SkeletonGrid() {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-sm bg-surface-container-low" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-sm bg-surface-container-low" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="h-64 animate-pulse rounded-sm bg-surface-container-low lg:col-span-2" />
        <div className="h-64 animate-pulse rounded-sm bg-surface-container-low" />
      </div>
    </>
  );
}

// First name for the welcome heading. AuthUser carries no name field, so
// derive it from the username (or email): take the segment before the
// first "." or "@" and capitalize it. "alfi.rajasyah" → "Alfi",
// "tam@elitery.com" → "Tam", "admin" → "Admin".
function firstNameOf(
  user: { username?: string; email?: string } | null | undefined,
): string {
  const source = user?.username || user?.email || "operator";
  const head = source.split(/[.@]/)[0] || "operator";
  return head.charAt(0).toUpperCase() + head.slice(1);
}

// Health signal comes from portfolio[].isOverdue (real schedule data):
// overdue (amber) → active on-track (green) → everything else (gray).
function healthRank(p: { status: ProjectStatus; isOverdue: boolean }): number {
  if (p.isOverdue) return 0;
  if (p.status === "ACTIVE") return 1;
  return 2;
}
function healthColor(p: { status: ProjectStatus; isOverdue: boolean }): string {
  if (p.isOverdue) return "#F59E0B";
  if (p.status === "ACTIVE") return "#8DC63F";
  return "#6B7280";
}
