import { Link, useSearchParams } from "react-router-dom";
import {
  PortfolioCalendar,
  sortPortfolioRows,
} from "@/components/portfolio/PortfolioCalendar";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { QueryErrorAlert } from "@/components/QueryErrorAlert";
import { ProjectStatusChip } from "@/components/StatusChip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dateToDay, dayFromIso } from "@/lib/dateField";
import { hasPermission, useAuth } from "@/lib/auth";
import { fmtDay, fmtDayLong } from "@/lib/formatDate";
import {
  type OverviewFilters,
  type OverviewPerson,
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
        <h1 className="font-display text-h1 text-on-surface">Overview</h1>
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

// A positive-integer URL param, or undefined for anything else.
function idParam(raw: string | null): number | undefined {
  const n = Number(raw);
  return raw !== null && Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : undefined;
}

function OverviewLoaded() {
  // The person filters live in the URL (/overview?tamId=7&assigneeId=12) so a
  // reload or a shared link keeps them.
  const [searchParams, setSearchParams] = useSearchParams();
  const filters: OverviewFilters = {
    tamId: idParam(searchParams.get("tamId")),
    assigneeId: idParam(searchParams.get("assigneeId")),
  };
  const setFilter = (key: "tamId" | "assigneeId", id: number | undefined) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (id === undefined) params.delete(key);
        else params.set(key, String(id));
        return params;
      },
      { replace: true },
    );
  };
  const { data, isLoading, isError, error, refetch } = useOverview(filters);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="font-display text-h1 text-on-surface">Overview</h1>
          <p className="text-sm text-on-surface-variant">{fmtDayLong(dateToDay(new Date()))}</p>
        </div>
        {(data || filters.tamId !== undefined || filters.assigneeId !== undefined) && (
          <div className="flex flex-wrap items-center gap-2">
            <PersonPicker
              label="TAM"
              people={data?.people.tams ?? []}
              value={filters.tamId}
              onChange={(id) => setFilter("tamId", id)}
            />
            <PersonPicker
              label="Assignee"
              people={data?.people.assignees ?? []}
              value={filters.assigneeId}
              onChange={(id) => setFilter("assigneeId", id)}
            />
          </div>
        )}
      </div>

      {isLoading && <SkeletonGrid />}

      {isError && (
        <QueryErrorAlert title="Could not load overview" error={error} onRetry={refetch} />
      )}

      {data && <OverviewBody data={data} filters={filters} />}
    </div>
  );
}

// One person filter: a select showing the chosen person, plus a × that clears
// it. An id the server no longer lists (out of scope) still shows, as "User #id".
function PersonPicker({
  label,
  people,
  value,
  onChange,
}: {
  label: string;
  people: OverviewPerson[];
  value: number | undefined;
  onChange: (id: number | undefined) => void;
}) {
  const options = people.map((p) => ({ value: String(p.id), label: p.username }));
  if (value !== undefined && !options.some((o) => o.value === String(value))) {
    options.push({ value: String(value), label: `User #${value}` });
  }
  return (
    <div className="flex items-center gap-1">
      <Select
        items={options}
        value={value === undefined ? null : String(value)}
        onValueChange={(v) => onChange(v === null ? undefined : Number(v))}
      >
        <SelectTrigger
          size="sm"
          aria-label={`${label} filter`}
          className={value === undefined ? "text-on-surface-variant" : "border-primary text-on-surface"}
        >
          <span className="text-label-caps uppercase text-on-surface-variant">{label}</span>
          <SelectValue placeholder="All" />
        </SelectTrigger>
        {/* Opens below the trigger, never over it: Base UI's default
            alignItemWithTrigger places the selected item on the trigger, which
            pushed long people lists up over the top bar and clipped their top.
            Capped height scrolls; type-ahead (typing a name) still works. */}
        <SelectContent
          side="bottom"
          align="start"
          alignItemWithTrigger={false}
          className="max-h-[min(var(--available-height),18rem)]"
        >
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value !== undefined && (
        <button
          type="button"
          aria-label={`Clear ${label} filter`}
          onClick={() => onChange(undefined)}
          className="flex h-8 w-8 items-center justify-center rounded-sm text-on-surface-variant transition-colors hover:text-primary outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-base">close</span>
        </button>
      )}
    </div>
  );
}

function OverviewBody({ data, filters }: { data: OverviewResponse; filters: OverviewFilters }) {
  const assigneeName = data.people.assignees.find((p) => p.id === filters.assigneeId)?.username;
  const assigneeLabel = filters.assigneeId === undefined ? null : (assigneeName ?? `User #${filters.assigneeId}`);
  const tamName = data.people.tams.find((p) => p.id === filters.tamId)?.username;
  const tamLabel = filters.tamId === undefined ? null : (tamName ?? `User #${filters.tamId}`);
  // Combined phrase for tile hints and panel subtitles.
  const scopeHint =
    assigneeLabel && tamLabel
      ? `assigned to ${assigneeLabel} on ${tamLabel}'s projects`
      : assigneeLabel
        ? `assigned to ${assigneeLabel}`
        : tamLabel
          ? `on ${tamLabel}'s projects`
          : null;
  const timelineHint =
    tamLabel || assigneeLabel
      ? `Where ${tamLabel ? `${tamLabel}'s projects` : "the projects"}${
          assigneeLabel ? ` with ${assigneeLabel}'s open tasks` : ""
        } sit across the year`
      : null;
  const projectsHint =
    assigneeLabel && tamLabel
      ? `on ${tamLabel}'s projects where ${assigneeLabel} has open tasks`
      : assigneeLabel
        ? `on projects where ${assigneeLabel} has open tasks`
        : tamLabel
          ? `on ${tamLabel}'s projects`
          : null;
  const filtered = filters.tamId !== undefined || filters.assigneeId !== undefined;
  // Tile links carry the filter to /tasks, which reads the same params.
  const personQs =
    (filters.tamId ? `&tamId=${filters.tamId}` : "") +
    (filters.assigneeId ? `&assigneeId=${filters.assigneeId}` : "");
  const portfolioIds = new Set(data.portfolio.map((p) => p.id));
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
          hint={scopeHint ?? (overdue === 1 ? "open task past due" : "open tasks past due")}
          icon="event_busy"
          tone={overdue > 0 ? "error" : "neutral"}
          to={`/tasks?view=overdue${personQs}`}
          ariaLabel={`Overdue: ${overdue} ${overdue === 1 ? "task" : "tasks"}`}
        />
        <Kpi
          label="Due this week"
          value={dueThisWeek}
          hint={scopeHint ? `due by Sunday, ${scopeHint}` : "open, due by Sunday"}
          icon="date_range"
          tone="primary"
          to={`/tasks?view=week${personQs}`}
          ariaLabel={`Due this week: ${dueThisWeek} ${dueThisWeek === 1 ? "task" : "tasks"}`}
        />
        <Kpi
          label="Open risks"
          value={openRisks}
          hint={projectsHint ?? "across your projects"}
          icon="warning"
          tone="neutral"
          to="/daily-review"
          ariaLabel={`Open risks: ${openRisks}`}
        />
      </div>

      {/* Projects needing attention */}
      <div className="min-w-0 rounded-sm border border-outline-variant bg-surface-container-lowest p-5">
        <header className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="font-display text-sm font-bold text-on-surface">Projects needing attention</h3>
            {projectsHint && <p className="text-xs text-on-surface-variant">{projectsHint.replace(/^on /, "")}</p>}
          </div>
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
            {timelineHint ?? "Where each of your projects sits across the year"}
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
          <RecentNotesFeed projectIds={filtered ? portfolioIds : null} />
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
function RecentNotesFeed({ projectIds }: { projectIds: Set<number> | null }) {
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
  // While a person filter is active, keep only notes on the filtered portfolio's
  // projects; operations (customer) notes aren't tied to a project, so they hide.
  const notes = projectIds
    ? data.notes.filter((n) => n.project !== null && projectIds.has(n.project.id))
    : data.notes;
  return (
    <>
      {isError && <p className="mb-2 text-xs text-error">Could not refresh — showing the last loaded notes.</p>}
      {notes.length === 0 ? (
        <EmptyHint
          label={
            projectIds
              ? "No recent notes on these projects."
              : `No notes in the last ${windowDays(data.from, data.to)} days.`
          }
        />
      ) : (
        <ul className="max-h-96 divide-y divide-outline-variant overflow-y-auto text-xs">
          {notes.map((n) => (
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
