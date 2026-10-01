import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { EmptyState } from "@/components/EmptyState";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { Badge } from "@/components/reui/badge";
import { DataGrid, DataGridContainer } from "@/components/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";
import { Chip, ProjectStatusChip } from "@/components/StatusChip";
import { Skeleton } from "@/components/ui/skeleton";
import { dayFromIso } from "@/lib/dateField";
import { fmtDateTime, fmtDay, fmtRange } from "@/lib/formatDate";
import { WEEKLY_HEALTH_LABEL, WEEKLY_STATUS_LABEL } from "@/lib/labels";
import { formatWeekRange, weekKeyOf } from "@/lib/isoWeek";
import {
  type CustomerDetail,
  type ProjectStatus,
  type ProjectSummary,
  type WeeklyHealth,
  type WeeklyStatus,
  type WeeklyUpdate,
  useCustomerNotes,
  useCustomerWeeklyUpdates,
} from "@/lib/queries";
import { personNameSortingFn } from "@/lib/tableSort";

// Overview tab of the customer account page: projects with progress and
// health, the latest weekly update, recent notes, then the profile (collapsed).
// Everything about a project comes from the nested `projects[].health` of
// GET /customers/:id — no per-project fetch.

const RECENT_NOTES_LIMIT = 5;

export function AccountOverview({
  customer,
  canMutate,
  onEdit,
}: {
  customer: CustomerDetail;
  canMutate: boolean;
  onEdit: () => void;
}) {
  return (
    <div className="space-y-6">
      <Section icon="assignment" title="Projects">
        {customer.projects.length === 0 ? (
          <EmptyState
            icon="assignment"
            title="No projects yet"
            message="When projects are linked to this customer, they'll appear here."
          />
        ) : (
          <ProjectsDataGrid projects={customer.projects} />
        )}
      </Section>

      <Section icon="calendar_month" title="Weekly updates">
        <WeeklyUpdatesPanel customerId={customer.id} />
      </Section>

      <Section icon="sticky_note_2" title="Recent notes">
        <RecentNotes customerId={customer.id} />
      </Section>

      <ProfileSection customer={customer} canMutate={canMutate} onEdit={onEdit} />
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <span className="material-symbols-outlined text-[19px] text-primary" aria-hidden="true">
          {icon}
        </span>
        <h2 className="font-display text-sm font-bold uppercase tracking-wider text-on-surface">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

// ---- Projects ---------------------------------------------------------------

const PROJECT_STATUSES: ProjectStatus[] = [
  "PLANNING",
  "ACTIVE",
  "ON_HOLD",
  "COMPLETED",
  "CANCELLED",
];

function progressPct(p: ProjectSummary): number | null {
  const progress = p.health?.progress;
  if (!progress || progress.total === 0) return null;
  return Math.round((progress.done / progress.total) * 100);
}

function ProgressCell({ project }: { project: ProjectSummary }) {
  const pct = progressPct(project);
  const progress = project.health?.progress;
  if (pct === null || !progress) {
    return <span className="text-meta text-on-surface-variant">No tasks</span>;
  }
  return (
    <div className="flex items-center gap-2">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={`${project.name} progress`}
        className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-surface-container-high"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <span className="whitespace-nowrap text-meta tabular-nums text-on-surface-variant">
        {pct}% · {progress.done} of {progress.total}
      </span>
    </div>
  );
}

function HealthCell({ project }: { project: ProjectSummary }) {
  const health = project.health;
  if (!health) return <span className="text-meta text-on-surface-variant">—</span>;
  if (health.overdueCount === 0 && health.openRiskCount === 0) {
    return <span className="text-meta text-on-surface-variant">No issues</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {health.overdueCount > 0 && <Chip tone="rose">{health.overdueCount} overdue</Chip>}
      {health.openRiskCount > 0 && (
        <Chip tone="amber">
          {health.openRiskCount} open {health.openRiskCount === 1 ? "risk" : "risks"}
        </Chip>
      )}
    </div>
  );
}

function ProjectsDataGrid({ projects }: { projects: ProjectSummary[] }) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const columns = useMemo<ColumnDef<ProjectSummary>[]>(
    () => [
      {
        id: "project",
        accessorKey: "name",
        header: ({ column }) => <DataGridColumnHeader column={column} title="Project" />,
        // Same underlying field as Tasks.tsx's "project" column
        // (Project.name) — mirrors its "alphanumeric" choice (decision 7)
        // for natural number ordering ("Project 2" before "Project 10"),
        // consistent across the app for the same data.
        sortingFn: "alphanumeric",
        cell: ({ row }) => (
          <Link
            to={`/projects/${row.original.id}`}
            className="font-medium text-on-surface hover:text-primary"
          >
            {row.original.name}
          </Link>
        ),
        meta: { skeleton: <Skeleton className="h-3.5 w-32" /> },
      },
      {
        id: "status",
        // Numeric accessor (workflow-order index), not a string column —
        // decision 7's auto-detect hazard is specific to string columns, so
        // no explicit sortingFn is needed here (same pattern as Tasks.tsx's
        // own status/priority/due columns).
        accessorFn: (row) => PROJECT_STATUSES.indexOf(row.status),
        header: ({ column }) => <DataGridColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <ProjectStatusChip status={row.original.status} />,
        meta: { skeleton: <Skeleton className="h-4 w-16 rounded-full" /> },
      },
      {
        id: "progress",
        // Projects without tasks sort below every started one.
        accessorFn: (row) => progressPct(row) ?? -1,
        header: ({ column }) => <DataGridColumnHeader column={column} title="Progress" />,
        cell: ({ row }) => <ProgressCell project={row.original} />,
        meta: { skeleton: <Skeleton className="h-3.5 w-28" /> },
      },
      {
        id: "health",
        // Overdue work first, open risks as the tie-breaker.
        accessorFn: (row) =>
          (row.health?.overdueCount ?? 0) * 1000 + (row.health?.openRiskCount ?? 0),
        header: ({ column }) => <DataGridColumnHeader column={column} title="Health" />,
        cell: ({ row }) => <HealthCell project={row.original} />,
        meta: { skeleton: <Skeleton className="h-4 w-20 rounded-full" /> },
      },
      {
        id: "dates",
        // "yyyy-MM-dd" sorts lexically; undated projects sort together first.
        accessorFn: (row) => row.health?.startDate ?? "",
        header: ({ column }) => <DataGridColumnHeader column={column} title="Dates" />,
        sortingFn: "basic",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-meta text-on-surface-variant">
            {fmtRange(row.original.health?.startDate, row.original.health?.endDate)}
          </span>
        ),
        meta: { skeleton: <Skeleton className="h-3.5 w-24" /> },
      },
      {
        id: "tam",
        accessorFn: (row) => row.tam.username,
        header: ({ column }) => <DataGridColumnHeader column={column} title="TAM" />,
        sortingFn: personNameSortingFn,
        cell: ({ row }) => (
          <span className="text-on-surface-variant">{row.original.tam.username}</span>
        ),
        meta: { skeleton: <Skeleton className="h-3.5 w-20" /> },
      },
    ],
    [],
  );

  const table = useReactTable({
    data: projects,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (row) => String(row.id),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <DataGrid
      table={table}
      recordCount={projects.length}
      tableLayout={{
        dense: true,
        rowBorder: true,
        headerBorder: true,
        headerBackground: false,
        // "auto" (not "fixed"): see Tasks.tsx / reui-data-grid.md Checkpoint
        // B, decision 6 — "fixed" pins every column to TanStack's untouched
        // 150px default instead of sizing to content.
        width: "auto",
      }}
      tableClassNames={{
        // The one piece tableLayout.headerBackground can't reproduce (its
        // `bg-muted` resolves to the wrong token) — see Tasks.tsx / decision 2.
        header: "bg-surface-container-low",
      }}
    >
      {/* Hairline wrapper — DataGridContainer's own `border` prop is
          accepted-and-ignored (Tasks.tsx / reui-data-grid.md Checkpoint B,
          decision 2). Phase-wide: every DataGrid table wraps its
          DataGridContainer this way. */}
      <DataGridContainer className="rounded-sm border border-outline-variant bg-surface-container-lowest">
        <DataGridScrollArea>
          <DataGridTable />
        </DataGridScrollArea>
      </DataGridContainer>
    </DataGrid>
  );
}

// ---- Recent notes -------------------------------------------------------------

function RecentNotes({ customerId }: { customerId: number }) {
  const { data: notes, isLoading, isError, error } = useCustomerNotes(
    customerId,
    RECENT_NOTES_LIMIT,
  );

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-sm bg-surface-container-low" />
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Could not load notes{error ? `: ${(error as Error).message}` : "."}
        </AlertDescription>
      </Alert>
    );
  }
  if (!notes || notes.length === 0) {
    return (
      <p className="rounded-sm border border-outline-variant bg-surface-container-lowest p-4 text-sm text-on-surface-variant">
        No notes yet. Customer notes are written in the Daily Review.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-outline-variant/60 rounded-sm border border-outline-variant bg-surface-container-lowest">
      {notes.map((note) => (
        <li key={note.id} className="px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="min-w-0 truncate font-display text-sm font-semibold text-on-surface">
              {note.title}
            </p>
            <p className="shrink-0 text-meta text-on-surface-variant">
              {fmtDay(note.noteDate)} · {note.author.username}
            </p>
          </div>
          {note.body && (
            <p className="mt-0.5 line-clamp-2 whitespace-pre-line wrap-break-word text-sm text-on-surface-variant">
              {note.body}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

// ---- Profile (collapsed by default) --------------------------------------------

function ProfileSection({
  customer,
  canMutate,
  onEdit,
}: {
  customer: CustomerDetail;
  canMutate: boolean;
  onEdit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = "account-profile-body";

  return (
    <section className="rounded-sm border border-outline-variant bg-surface-container-lowest">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-center gap-2 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        <span className="material-symbols-outlined text-[19px] text-primary" aria-hidden="true">
          {open ? "expand_more" : "chevron_right"}
        </span>
        <h2 className="font-display text-sm font-bold uppercase tracking-wider text-on-surface">
          Profile
        </h2>
        <span className="text-meta text-on-surface-variant">
          Description, services and tools
        </span>
      </button>

      {open && (
        <div id={bodyId} className="space-y-4 border-t border-outline-variant px-4 py-4">
          <div>
            <p className="mb-1 font-display text-label-caps uppercase text-on-surface-variant">
              Description
            </p>
            {customer.description.trim() ? (
              <p className="max-w-3xl whitespace-pre-line wrap-break-word text-sm text-on-surface">
                {customer.description}
              </p>
            ) : (
              <p className="text-sm text-on-surface-variant">
                No description yet.
                {canMutate && (
                  <>
                    {" "}
                    <button
                      type="button"
                      onClick={onEdit}
                      className="font-semibold text-primary hover:underline"
                    >
                      Add one
                    </button>
                  </>
                )}
              </p>
            )}
          </div>

          <div>
            <p className="mb-1 font-display text-label-caps uppercase text-on-surface-variant">
              Services and tools
            </p>
            {customer.services.length === 0 ? (
              <p className="text-sm text-on-surface-variant">
                No services mapped yet. Assign them from the Services tab.
              </p>
            ) : (
              <ul className="divide-y divide-outline-variant/60">
                {customer.services.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-start justify-between gap-4 py-2 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-on-surface">{a.service.name}</p>
                      {a.service.description && (
                        <p className="text-meta text-on-surface-variant">
                          {a.service.description}
                        </p>
                      )}
                    </div>
                    <div className="flex max-w-[60%] shrink-0 flex-wrap justify-end gap-1">
                      {a.tools.length === 0 ? (
                        <span className="text-meta italic text-on-surface-variant">
                          No tools listed
                        </span>
                      ) : (
                        a.tools.map((t, i) => (
                          <span
                            key={`${t}-${i}`}
                            className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-meta text-primary"
                          >
                            {t}
                          </span>
                        ))
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// ---- Weekly updates -------------------------------------------------------------

function WeeklyUpdatesPanel({ customerId }: { customerId: number }) {
  // The latest week only, until the reader asks for the history (the backend
  // caps `limit` at 52 — a year of weeks; the hook's default of 12 silently
  // truncated this list once, phase review finding N8). The limit-1 entry is
  // the same cache key the header's health line reads.
  const [showAll, setShowAll] = useState(false);
  const limit = showAll ? 52 : 1;
  const { data: updates, isLoading, isError, error } = useCustomerWeeklyUpdates(
    customerId,
    limit,
  );

  let body: ReactNode;
  if (isLoading) {
    body = <div className="h-16 animate-pulse rounded-sm bg-surface-container-low" />;
  } else if (isError) {
    body = (
      <Alert variant="destructive">
        <AlertDescription>
          Could not load weekly updates{error ? `: ${(error as Error).message}` : "."}
        </AlertDescription>
      </Alert>
    );
  } else if (!updates || updates.length === 0) {
    body = <p className="text-sm text-on-surface-variant">No weekly updates yet.</p>;
  } else {
    body = (
      <>
        <ul className="divide-y divide-outline-variant/60">
          {updates.map((update) => (
            <WeeklyUpdateRow key={update.id} update={update} />
          ))}
        </ul>
        {showAll && updates.length === 52 && (
          <p className="mt-2 text-xs text-on-surface-variant">Showing the last 52 weeks.</p>
        )}
      </>
    );
  }

  return (
    <div className="rounded-sm border border-outline-variant bg-surface-container-lowest p-4">
      {body}
      {!isLoading && !isError && updates && updates.length > 0 && (showAll || updates.length === 1) && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-3 text-meta font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          {showAll ? "Show latest only" : "Show earlier weeks"}
        </button>
      )}
    </div>
  );
}

function WeeklyUpdateRow({ update }: { update: WeeklyUpdate }) {
  const weekKey = weekKeyOf(dayFromIso(update.weekStart)!);
  const isDone = update.status === "DONE";
  const [midweekOpen, setMidweekOpen] = useState(false);
  const midweekFieldsId = `weekly-update-${update.id}-midweek-fields`;
  const hasMidweekContent = update.highlights.length > 0;

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-display text-meta font-bold uppercase tracking-wider text-on-surface">
            {weekKey}
          </span>
          <span className="text-meta text-on-surface-variant">
            {formatWeekRange(weekKey)}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {healthChip(update.health)}
          {statusBadge(update.status)}
        </div>
      </div>

      {update.category && (
        <p className="mt-1 font-display text-sm font-semibold text-on-surface">
          {update.category}
        </p>
      )}

      <div className="mt-2 flex flex-col gap-2.5">
        <p className="text-label-caps uppercase text-on-surface-variant">
          Achievements · {update.achievements.length}
        </p>
        {update.achievements.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No achievements.</p>
        ) : (
          update.achievements.map((achievement, i) => (
            <div
              key={achievement.id}
              className={
                i === 0
                  ? "flex flex-col gap-2"
                  : "flex flex-col gap-2 border-t border-outline-variant/60 pt-2.5"
              }
            >
              <div>
                <p
                  className={
                    isDone
                      ? "wrap-break-word text-sm text-on-surface"
                      : "wrap-break-word text-sm text-on-surface-variant"
                  }
                >
                  {achievement.title}
                </p>
                {achievement.detail && (
                  <p className="whitespace-pre-wrap wrap-break-word text-sm text-on-surface-variant">
                    {achievement.detail}
                  </p>
                )}
              </div>
              <div className="grid gap-x-5 gap-y-2.5 sm:grid-cols-2">
                <WeeklyUpdateField
                  label="Outstanding issue"
                  value={achievement.outstandingIssue}
                  isDone={isDone}
                />
                <WeeklyUpdateField
                  label="Lesson learned"
                  value={achievement.lessonLearned}
                  isDone={isDone}
                />
                <WeeklyUpdateField
                  label="Next week focus"
                  value={achievement.nextWeekFocus}
                  isDone={isDone}
                />
                <WeeklyUpdateField
                  label="Need manager decision"
                  value={achievement.managerDecision}
                  isDone={isDone}
                  spanBothColumns
                  labelClassName="text-chip-amber-text"
                />
              </div>
            </div>
          ))
        )}
      </div>

      {hasMidweekContent && (
        <>
          <button
            type="button"
            onClick={() => setMidweekOpen((v) => !v)}
            aria-expanded={midweekOpen}
            aria-controls={midweekFieldsId}
            className="mt-2 text-meta font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            {midweekOpen ? "Hide mid-week" : "Show mid-week"}
          </button>

          {midweekOpen && (
            <div id={midweekFieldsId} className="mt-2 flex flex-col gap-2.5">
              <p className="text-label-caps uppercase text-on-surface-variant">
                Highlights · {update.highlights.length}
              </p>
              {update.highlights.map((highlight, i) => (
                <div
                  key={highlight.id}
                  className={
                    i === 0
                      ? "flex flex-col gap-2"
                      : "flex flex-col gap-2 border-t border-outline-variant/60 pt-2.5"
                  }
                >
                  <div>
                    <p
                      className={
                        isDone
                          ? "wrap-break-word text-sm text-on-surface"
                          : "wrap-break-word text-sm text-on-surface-variant"
                      }
                    >
                      {highlight.title}
                    </p>
                    {highlight.detail && (
                      <p className="whitespace-pre-wrap wrap-break-word text-sm text-on-surface-variant">
                        {highlight.detail}
                      </p>
                    )}
                  </div>
                  <div className="grid gap-x-5 gap-y-2.5 sm:grid-cols-2">
                    <WeeklyUpdateField label="Risk" value={highlight.risk} isDone={isDone} />
                    <WeeklyUpdateField label="Action" value={highlight.action} isDone={isDone} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <p className="mt-1.5 text-xs text-on-surface-variant">
        by {update.author.username} · updated{" "}
        {fmtDateTime(update.updatedAt)}
        {update.doneAt && ` · done ${fmtDateTime(update.doneAt)}`}
      </p>
    </li>
  );
}

function WeeklyUpdateField({
  label,
  value,
  isDone,
  spanBothColumns,
  labelClassName,
}: {
  label: string;
  value: string | null;
  isDone: boolean;
  spanBothColumns?: boolean;
  labelClassName?: string;
}) {
  return (
    <div className={spanBothColumns ? "sm:col-span-2" : undefined}>
      <p
        className={[
          "text-label-caps uppercase",
          labelClassName ?? "text-on-surface-variant",
        ].join(" ")}
      >
        {label}
      </p>
      <p
        className={[
          "whitespace-pre-wrap text-sm",
          value ? (isDone ? "text-on-surface" : "text-on-surface-variant") : "text-on-surface-variant",
        ].join(" ")}
      >
        {value || "—"}
      </p>
    </div>
  );
}

function healthChip(health: WeeklyHealth | null) {
  if (health === "GREEN") return <Chip tone="emerald">{WEEKLY_HEALTH_LABEL.GREEN}</Chip>;
  if (health === "AMBER") return <Chip tone="amber">{WEEKLY_HEALTH_LABEL.AMBER}</Chip>;
  if (health === "RED") return <Chip tone="rose">{WEEKLY_HEALTH_LABEL.RED}</Chip>;
  return <Chip tone="gray">No health</Chip>;
}

function statusBadge(status: WeeklyStatus) {
  const variant =
    status === "DONE" ? "success-light" : status === "DRAFT" ? "warning-light" : "outline";
  return <Badge variant={variant}>{WEEKLY_STATUS_LABEL[status]}</Badge>;
}
