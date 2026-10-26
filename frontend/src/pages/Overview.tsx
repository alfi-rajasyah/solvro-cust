import { Link } from "react-router-dom";
import {
  PortfolioCalendar,
  sortPortfolioRows,
} from "@/components/portfolio/PortfolioCalendar";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { QueryErrorAlert } from "@/components/QueryErrorAlert";
import { ProjectStatusChip } from "@/components/StatusChip";
import { dateToDay, dayFromIso } from "@/lib/dateField";
import { hasPermission, useAuth } from "@/lib/auth";
import { fmtDay, fmtDayLong } from "@/lib/formatDate";
import {
  type OverviewResponse,
  type ProjectHealth,
  type ProjectStatus,
  type RecentNote,
  useOverview,
  useProjects,
  useRecentNotes,
} from "@/lib/queries";

export function Overview() {
  // GET /overview, /overview/badges and /projects need project:read. A user
  // without it (a PENDING account waiting for a role) gets a plain notice
  // instead of three 403s and a sign-out-looking error.
  const { user } = useAuth();
  if (!hasPermission(user, "project:read")) {
    return (
      <div className="space-y-6">
        <h1 className="font-display text-2xl font-bold text-on-surface">Overview</h1>
        <Alert>
          <AlertDescription>
            Your account has no role yet. An administrator must assign one before projects,
            customers and tasks are visible.
          </AlertDescription>
        </Alert>
      </div>
    );
  }
  return <OverviewLoaded />;
}

function OverviewLoaded() {
  const { data, isLoading, isError, error, refetch } = useOverview();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="font-display text-2xl font-bold text-on-surface">Overview</h1>
        <p className="text-sm text-on-surface-variant">{fmtDayLong(dateToDay(new Date()))}</p>
      </div>

      {isLoading && <SkeletonGrid />}

      {isError && (
        <QueryErrorAlert title="Could not load overview" error={error} onRetry={refetch} />
      )}

      {data && <OverviewBody data={data} />}
    </div>
  );
}

function OverviewBody({ data }: { data: OverviewResponse }) {
  const { overdue, dueThisWeek, openRisks } = data.workCounts;
  // GET /notes/recent needs project:read (docs/archive/plans/internal-sync.md);
  // without it the panel would only show a 403 error.
  const { user } = useAuth();
  const canReadNotes = hasPermission(user, "project:read");
  // Per-project task-overdue and open-risk counts come from GET /projects
  // (server-computed `health`); the overview portfolio rows don't carry them.
  const { data: projects } = useProjects();
  const healthById = new Map<number, ProjectHealth>();
  for (const p of projects ?? []) {
    if (p.health) healthById.set(p.id, p.health);
  }

  return (
    <>
      {/* Work tiles — each is a link to the list it counts */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi
          label="Overdue"
          value={overdue}
          hint={overdue === 1 ? "open task past due" : "open tasks past due"}
          icon="event_busy"
          tone={overdue > 0 ? "error" : "neutral"}
          to="/tasks?view=overdue"
          ariaLabel={`Overdue: ${overdue} ${overdue === 1 ? "task" : "tasks"}`}
        />
        <Kpi
          label="Due this week"
          value={dueThisWeek}
          hint="open, due by Sunday"
          icon="date_range"
          tone="primary"
          to="/tasks?view=week"
          ariaLabel={`Due this week: ${dueThisWeek} ${dueThisWeek === 1 ? "task" : "tasks"}`}
        />
        <Kpi
          label="Open risks"
          value={openRisks}
          hint="across your projects"
          icon="warning"
          tone="neutral"
          to="/daily-review"
          ariaLabel={`Open risks: ${openRisks}`}
        />
      </div>

      {/* Projects needing attention */}
      <div className="min-w-0 rounded-sm border border-outline-variant bg-surface-container-lowest p-5">
        <header className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-sm font-bold text-on-surface">Projects needing attention</h3>
          <Link to="/projects" className="text-meta font-semibold text-primary hover:underline">
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
              .map((p) => {
                const health = healthById.get(p.id);
                const overdueTasks = health?.overdueCount ?? 0;
                const risks = health?.openRiskCount ?? 0;
                return (
                  // min-w-0: a grid item's automatic minimum is its
                  // min-content width — lets the row's `truncate` name
                  // actually shrink on a phone.
                  <li key={p.id} className="min-w-0">
                    <Link
                      to={`/projects/${p.id}`}
                      className={`flex items-center gap-3 rounded-sm border border-l-3 border-outline-variant bg-surface-container-lowest px-3 py-2 transition-colors hover:border-y-primary hover:border-r-primary ${healthBorder(p)}`}
                    >
                      <span className="font-mono text-meta text-on-surface-variant">P-{String(p.id).padStart(3, "0")}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-on-surface">{p.name}</span>
                      {overdueTasks > 0 && (
                        <span
                          title="Open tasks past their due date"
                          className="shrink-0 whitespace-nowrap rounded-sm bg-chip-rose-bg px-1.5 py-0.5 text-meta font-semibold text-chip-rose-text"
                        >
                          {overdueTasks} overdue
                        </span>
                      )}
                      {risks > 0 && (
                        <span
                          title="Open risks"
                          className="shrink-0 whitespace-nowrap rounded-sm bg-chip-amber-bg px-1.5 py-0.5 text-meta font-semibold text-chip-amber-text"
                        >
                          {risks} {risks === 1 ? "risk" : "risks"}
                        </span>
                      )}
                      <ProjectStatusChip status={p.status} />
                    </Link>
                  </li>
                );
              })}
          </ul>
        )}
      </div>

      {/* Full-width portfolio timeline */}
      <section className="space-y-3">
        <header>
          <h3 className="font-display text-sm font-bold text-on-surface">Portfolio timeline</h3>
          <p className="text-xs text-on-surface-variant">
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

      {/* Recent notes — the heading stays a direct child of this panel
          (daily-review.spec.ts walks ancestor::div[1] from it). */}
      {canReadNotes && (
        <div className="min-w-0 rounded-sm border border-outline-variant bg-surface-container-lowest p-5">
          <header className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-sm font-bold text-on-surface">Recent notes</h3>
            <Link to="/daily-review" className="text-meta font-semibold text-primary hover:underline">
              Daily Review →
            </Link>
          </header>
          <RecentNotesFeed />
        </div>
      )}
    </>
  );
}

interface KpiProps {
  label: string;
  value: number;
  hint?: string;
  icon: string;
  tone: "primary" | "error" | "neutral";
  to: string;
  ariaLabel: string;
}

function Kpi({ label, value, hint, icon, tone, to, ariaLabel }: KpiProps) {
  const iconColor =
    tone === "primary" ? "text-primary" : tone === "error" ? "text-error" : "text-on-surface-variant";
  return (
    <Link
      to={to}
      aria-label={ariaLabel}
      className="block rounded-sm border border-outline-variant bg-surface-container-lowest p-4 transition-colors hover:border-primary"
    >
      <div className="flex items-center justify-between">
        <span className="text-label-caps uppercase text-on-surface-variant">{label}</span>
        <span aria-hidden="true" className={`material-symbols-outlined text-base ${iconColor}`}>{icon}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span
          className={`text-3xl font-bold tabular-nums ${tone === "error" ? "text-error" : "text-on-surface"}`}
        >
          {value}
        </span>
        {hint && <span className="text-meta text-on-surface-variant">{hint}</span>}
      </div>
    </Link>
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
      <div className="flex items-baseline gap-2 text-meta text-on-surface-variant">
        <span className="shrink-0 tabular-nums">{day ? fmtDay(day) : "—"}</span>
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
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-sm bg-surface-container-low" />
        ))}
      </div>
      <div className="h-40 animate-pulse rounded-sm bg-surface-container-low" />
      <div className="h-64 animate-pulse rounded-sm bg-surface-container-low" />
      <div className="h-64 animate-pulse rounded-sm bg-surface-container-low" />
    </>
  );
}

// Health signal comes from portfolio[].isOverdue (real schedule data):
// overdue (error) → active on-track (primary) → everything else (muted).
function healthRank(p: { status: ProjectStatus; isOverdue: boolean }): number {
  if (p.isOverdue) return 0;
  if (p.status === "ACTIVE") return 1;
  return 2;
}
// Left-edge accent of an attention row, as token classes.
function healthBorder(p: { status: ProjectStatus; isOverdue: boolean }): string {
  if (p.isOverdue) return "border-l-error";
  if (p.status === "ACTIVE") return "border-l-primary";
  return "border-l-on-surface-variant/40";
}
