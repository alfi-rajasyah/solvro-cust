import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { AssigneeAvatar } from "@/components/AssigneeAvatar";
import { LabelChip } from "@/components/LabelChip";
import { PriorityBadge } from "@/components/PriorityBadge";
import { QueryErrorAlert } from "@/components/QueryErrorAlert";
import { Tabs } from "@/components/Tabs";
import { TaskFormModal } from "@/components/TaskFormModal";
import { STATUS_TONE_DOT_CLASS, TaskStatusChip } from "@/components/StatusChip";
import { hasPermission, useAuth } from "@/lib/auth";
import { dateToDay, dayFromIso } from "@/lib/dateField";
import { EMPTY_VALUE } from "@/lib/emptyValue";
import { fmtDay, fmtDue } from "@/lib/formatDate";
import { parseWeekKey, weekKeyOf } from "@/lib/isoWeek";
import { TASK_CATEGORY_GROUP_LABEL, priorityOptions } from "@/lib/labels";
import { statusFilterOptions, statusFilterToQuery, statusSortKey } from "@/lib/taskStatuses";
import {
  type Filter,
  type FilterFieldConfig,
  Filters,
} from "@/components/reui/filters";
import { DataGrid, DataGridContainer } from "@/components/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type Priority,
  type Task,
  type TaskWithProject,
  type TasksFilter,
  useCustomers,
  useInfiniteTasks,
  useTaskStatuses,
  useUsers,
} from "@/lib/queries";

const PRIORITY_ORDER: Record<Priority, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

// Stable empty-array reference for `data:` while `useInfiniteTasks` is loading —
// avoids a fresh `[]` literal (and therefore a new TanStack row model) on
// every render that a `tasks ?? []` inline fallback would produce.
const EMPTY_TASKS: TaskWithProject[] = [];

// Only the affirmative "is" operator is offered on every filter field below —
// the derivation in Tasks() reads just `.values[0]` per field, so a
// select-type field's other vendored-default operators ("is not", "is
// empty", "is not empty") would render a chip whose label lies about what's
// actually being sent to useInfiniteTasks (e.g. a "Status is not DONE" chip would
// still filter as "Status is DONE"). Same fix as Projects.tsx's customer field.
const ONLY_IS_OPERATOR = [{ value: "is", label: "is" }];

// Saved views, synced to `?view=`. "open" is the default and is written to the
// URL as the absence of the param, so `/tasks` and `/tasks?view=open` agree.
const VIEWS = [
  { key: "open", label: "All open" },
  { key: "my-open", label: "My open" },
  { key: "overdue", label: "Overdue" },
  { key: "week", label: "This week" },
  { key: "all", label: "All" },
] as const;
type ViewKey = (typeof VIEWS)[number]["key"];
const DEFAULT_VIEW: ViewKey = "open";

// A positive-integer URL param, or undefined for anything else.
function idParam(raw: string | null): number | undefined {
  const n = Number(raw);
  return raw !== null && Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : undefined;
}

function parseView(raw: string | null): ViewKey {
  return VIEWS.find((v) => v.key === raw)?.key ?? DEFAULT_VIEW;
}

// The server-side part of each view. The Filters chips and "Top-level only"
// are layered on top of this in Tasks().
function viewFilter(view: ViewKey, todayDay: string, userId: number | undefined): TasksFilter {
  switch (view) {
    case "open":
      return { open: true, sort: "due" };
    case "my-open":
      return { open: true, assignedToId: userId, sort: "due" };
    case "overdue":
      return { overdue: true, sort: "due" };
    case "week": {
      // ISO week Sunday (Mon..Sun weeks), as a "yyyy-MM-dd" calendar day.
      const sunday = parseWeekKey(weekKeyOf(todayDay))?.days[6];
      return { open: true, dueFrom: todayDay, dueTo: sunday, sort: "due" };
    }
    case "all":
      return { sort: "due" };
  }
}

export function Tasks() {
  // Filters chip state is UI-only (Filter[]); it is derived down into the
  // TasksFilter shape useInfiniteTasks/queries.ts already expects — see `filter` below.
  const [activeFilters, setActiveFilters] = useState<Filter<string>[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  // Person filters carried in from the Overview (?tamId=&assigneeId=). With an
  // assignee the list includes subtasks by default, so it matches the Overview
  // tile that links here; the "Top-level only" box can still narrow it.
  const urlTamId = idParam(searchParams.get("tamId"));
  const urlAssigneeId = idParam(searchParams.get("assigneeId"));
  const [topLevel, setTopLevel] = useState(urlAssigneeId === undefined);
  // Clearing (or Back/Forward changing) the assignee param restores the
  // default "Top-level only"; setting it includes subtasks.
  const [seenAssigneeId, setSeenAssigneeId] = useState(urlAssigneeId);
  if (seenAssigneeId !== urlAssigneeId) {
    setSeenAssigneeId(urlAssigneeId);
    setTopLevel(urlAssigneeId === undefined);
  }
  // TanStack owns header sorting (DataGridColumnHeader). It starts empty: the
  // server already returns rows soonest-due first (`sort=due`), and a header
  // click re-sorts the loaded rows client-side.
  const [sorting, setSorting] = useState<SortingState>([]);
  const view = parseView(searchParams.get("view"));
  const { user } = useAuth();
  const [editTask, setEditTask] = useState<TaskWithProject | null>(null);

  // /users and /customers need project:read; without it the filters stay empty.
  const canRead = hasPermission(user, "project:read");
  const { data: users } = useUsers(canRead);
  const { data: customers } = useCustomers(canRead && hasPermission(user, "customer:read"));
  const { data: statusDefs } = useTaskStatuses();

  const filterFields = useMemo<FilterFieldConfig<string>[]>(
    () => [
      {
        key: "status",
        label: "Status",
        type: "select",
        operators: ONLY_IS_OPERATOR,
        // Grouped by category; a whole category is one pick (?status=), a
        // single status another (?statusId=) — see lib/taskStatuses.ts.
        options: statusFilterOptions(statusDefs, TASK_CATEGORY_GROUP_LABEL).map((o) => ({
          value: o.value,
          label: o.label,
          icon: o.def ? (
            <span aria-hidden="true" className={`size-2 rounded-full ${STATUS_TONE_DOT_CLASS[o.def.color]}`} />
          ) : undefined,
        })),
      },
      {
        key: "priority",
        label: "Priority",
        type: "select",
        operators: ONLY_IS_OPERATOR,
        options: priorityOptions,
      },
      {
        key: "assignedToId",
        label: "Assignee",
        type: "select",
        operators: ONLY_IS_OPERATOR,
        options: (users ?? []).map((u) => ({ value: String(u.id), label: u.username })),
      },
      // Hidden without customer:read: GET /customers would 403 and the picker would be empty.
      ...(hasPermission(user, "customer:read")
        ? [
            {
              key: "customerId",
              label: "Customer",
              type: "select" as const,
              operators: ONLY_IS_OPERATOR,
              options: (customers ?? []).map((c) => ({ value: String(c.id), label: c.name })),
            },
          ]
        : []),
    ],
    [users, customers, user, statusDefs],
  );

  // Derive the TasksFilter useInfiniteTasks/queries.ts expects from the active Filter
  // chips: first value per field, absent field -> undefined (never ""/null —
  // a different shape would splinter the react-query cache key).
  // Hoisted once per render of the list rather than once per cell — the
  // day string is identical for every row in a single render pass.
  const todayDay = dateToDay(startOfToday());

  const userId = user?.id;
  const filter = useMemo<TasksFilter>(() => {
    const valueFor = (key: string) =>
      activeFilters.find((f) => f.field === key)?.values[0];
    const status = valueFor("status");
    const priority = valueFor("priority");
    const assignedToId = valueFor("assignedToId");
    const customerId = valueFor("customerId");
    const base = viewFilter(view, todayDay!, userId);
    return {
      ...base,
      // An explicit Status chip wins over the view's "hide Done" — otherwise
      // picking Status "Done" inside an open-only view would always be empty.
      open: status ? undefined : base.open,
      ...statusFilterToQuery(status),
      priority: priority as Priority | undefined,
      // Likewise an Assignee chip wins over "My open"'s current user.
      assignedToId:
        assignedToId !== undefined
          ? Number(assignedToId)
          : (urlAssigneeId ?? base.assignedToId),
      tamId: urlTamId,
      customerId: customerId === undefined ? undefined : Number(customerId),
      topLevel: topLevel || undefined,
    };
  }, [activeFilters, topLevel, view, todayDay, userId, urlTamId, urlAssigneeId]);

  const { data, isLoading, isError, error, refetch, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useInfiniteTasks(filter);
  const tasks = useMemo(() => data?.pages.flatMap((p) => p.tasks), [data]);
  const total = data?.pages[data.pages.length - 1]?.total ?? 0;

  const setView = (next: ViewKey) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === DEFAULT_VIEW) params.delete("view");
        else params.set("view", next);
        // "My open" is its own assignee scope; a carried-in assignee would fight it.
        if (next === "my-open") params.delete("assigneeId");
        return params;
      },
      { replace: false },
    );
  };

  const clearParam = (key: "tamId" | "assigneeId") => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.delete(key);
        return params;
      },
      { replace: true },
    );
  };
  const nameOf = (id: number) => users?.find((u) => u.id === id)?.username ?? `User #${id}`;

  const columns = useMemo<ColumnDef<TaskWithProject>[]>(
    () => [
      {
        id: "id",
        header: ({ column }) => <DataGridColumnHeader column={column} title="ID" />,
        enableSorting: false,
        cell: ({ row }) => (
          <span className="font-mono text-label-caps uppercase text-on-surface-variant">
            T-{String(row.original.id).padStart(3, "0")}
          </span>
        ),
        meta: { skeleton: <Skeleton className="h-3.5 w-10" /> },
      },
      {
        id: "title",
        accessorKey: "title",
        header: ({ column }) => <DataGridColumnHeader column={column} title="Title" />,
        enableSorting: false,
        cell: ({ row }) => (
          <span className="font-medium text-on-surface">{row.original.title}</span>
        ),
        meta: { skeleton: <Skeleton className="h-3.5 w-32" /> },
      },
      {
        id: "project",
        accessorFn: (row) => row.project.name,
        header: ({ column }) => <DataGridColumnHeader column={column} title="Project" />,
        // DELIBERATE change from the old table's `a.project.name.localeCompare(b.project.name)`
        // (reui-data-grid.md Checkpoint B fix round, SF4 — endorsed as an
        // improvement, not a regression to fix): TanStack's built-in
        // "alphanumeric" sortingFn gives natural number ordering within
        // project names ("Project 2" before "Project 10"), which
        // `localeCompare` does not. Trade-off: accented characters sort
        // after "z" instead of locale-aware collation — acceptable for
        // project names, which are operator-entered ASCII in practice.
        sortingFn: "alphanumeric",
        cell: ({ row }) => (
          <Link
            to={`/projects/${row.original.project.id}`}
            onClick={(e) => e.stopPropagation()}
            className="[@media(pointer:coarse)]:inline-block text-on-surface-variant hover:text-primary [@media(pointer:coarse)]:py-3"
          >
            {row.original.project.name}
          </Link>
        ),
        meta: { skeleton: <Skeleton className="h-3.5 w-24" /> },
      },
      {
        id: "labels",
        header: ({ column }) => <DataGridColumnHeader column={column} title="Labels" />,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.labels.slice(0, 2).map((l) => (
              <LabelChip key={l.id} label={l} compact />
            ))}
            {row.original.labels.length > 2 && (
              <span className="text-meta text-on-surface-variant">
                +{row.original.labels.length - 2}
              </span>
            )}
          </div>
        ),
        meta: { skeleton: <Skeleton className="h-4 w-12 rounded-full" /> },
      },
      {
        id: "priority",
        accessorFn: (row) => PRIORITY_ORDER[row.priority],
        header: ({ column }) => <DataGridColumnHeader column={column} title="Priority" />,
        cell: ({ row }) => <PriorityBadge priority={row.original.priority} compact />,
        meta: { skeleton: <Skeleton className="h-4 w-10 rounded-full" /> },
      },
      {
        id: "assignee",
        header: ({ column }) => <DataGridColumnHeader column={column} title="Assignee" />,
        enableSorting: false,
        cell: ({ row }) => <AssigneeAvatar user={row.original.assignedTo} size="xs" />,
        meta: { skeleton: <Skeleton className="h-5 w-5 rounded-full" /> },
      },
      {
        id: "due",
        accessorFn: (row) =>
          row.dueDate ? new Date(row.dueDate).getTime() : Number.POSITIVE_INFINITY,
        header: ({ column }) => <DataGridColumnHeader column={column} title="Due" />,
        cell: ({ row }) => {
          const task = row.original;
          // Compare calendar days, not instants — lexicographic "yyyy-MM-dd"
          // comparison is calendar-correct (dateField.ts). `todayDay` is
          // hoisted above (once per render, not once per cell).
          const isOverdue =
            task.dueDate && task.status !== "DONE" && dayFromIso(task.dueDate)! < todayDay!;
          return (
            <span
              className={
                isOverdue
                  ? "text-meta font-bold text-error"
                  : "text-meta text-on-surface-variant"
              }
            >
              {fmt(task.dueDate, task.status === "DONE")}
            </span>
          );
        },
        meta: { skeleton: <Skeleton className="h-3.5 w-16" /> },
      },
      {
        id: "status",
        accessorFn: (row) => statusSortKey(row.statusDef),
        header: ({ column }) => <DataGridColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <TaskStatusChip status={row.original.status} def={row.original.statusDef} />,
        meta: { skeleton: <Skeleton className="h-4 w-16 rounded-full" /> },
      },
    ],
    [todayDay],
  );

  const table = useReactTable({
    data: tasks ?? EMPTY_TASKS,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (row) => String(row.id),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    // Pagination stays OFF (pilot verdict — see docs/plans/reui-data-grid.md
    // Checkpoint B): no getPaginationRowModel, so the full sorted row model
    // renders. `pageSize` here only sizes the loading-skeleton row count.
    initialState: { pagination: { pageSize: 8 } },
  });

  return (
    <div>
      <div className="mb-4">
        <h1 className="font-display text-h1 text-on-surface">Tasks</h1>
        <p className="text-sm text-on-surface-variant">
          Cross-project task list. Pick a view, apply filters, click any row to open the editor.
        </p>
      </div>

      <div className="mb-3 overflow-x-auto">
        <Tabs items={VIEWS} active={view} onChange={setView} />
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-sm border border-outline-variant bg-surface-container-lowest p-3">
        <Filters
          filters={activeFilters}
          fields={filterFields}
          onChange={setActiveFilters}
          size="sm"
          allowMultiple={false}
        />
        <label className="flex items-center gap-2 text-xs text-on-surface-variant [@media(pointer:coarse)]:min-h-11">
          <input
            type="checkbox"
            checked={topLevel}
            onChange={(e) => setTopLevel(e.target.checked)}
            className="h-3.5 w-3.5 accent-primary"
          />
          Top-level only
        </label>
        <button
          type="button"
          onClick={() => {
            setActiveFilters([]);
            setTopLevel(true);
            setSearchParams({}, { replace: false });
          }}
          className="ml-auto rounded-sm border border-outline-variant px-2 py-1 font-display text-sm text-on-surface-variant hover:border-primary hover:text-primary font-semibold [@media(pointer:coarse)]:min-h-11"
        >
          Reset
        </button>
      </div>

      {(urlTamId !== undefined || urlAssigneeId !== undefined) && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {urlTamId !== undefined && (
            <PersonChip label={`TAM: ${nameOf(urlTamId)}`} onClear={() => clearParam("tamId")} />
          )}
          {urlAssigneeId !== undefined && (
            <PersonChip
              label={`Assigned to ${nameOf(urlAssigneeId)}`}
              onClear={() => clearParam("assigneeId")}
            />
          )}
        </div>
      )}

      {isError && (
        <QueryErrorAlert title="Could not load tasks" error={error} onRetry={refetch} />
      )}

      {(!isError || tasks) && (
        <DataGrid
          table={table}
          recordCount={tasks?.length ?? 0}
          isLoading={isLoading}
          loadingMode="skeleton"
          onRowClick={(task) => setEditTask(task)}
          emptyMessage="No tasks match the current filters."
          tableLayout={{
            dense: true,
            rowBorder: true,
            headerBorder: true,
            headerBackground: false,
            // SOLVRO PATCH (reui-data-grid.md Checkpoint B fix round, SF2)
            // — "fixed" gave every column TanStack's untouched 150px
            // default (no column defines its own `size`), so long titles
            // wrapped instead of the columns sizing proportionally to their
            // content the way the pre-DataGrid `<table>` did. "auto" (→
            // `table-auto` in DataGridTableBase, `<col>` left unsized) lets
            // the browser's own auto-layout algorithm distribute width by
            // content again, matching the old table's look.
            width: "auto",
          }}
          tableClassNames={{
            // SOLVRO PATCH (reui-data-grid.md Checkpoint B fix round, SF6)
            // — dropped `text-on-surface-variant`: every `<th>` already
            // renders `text-muted-foreground` via
            // `data-grid-column-header.tsx`'s headerLabelClassName/
            // headerButtonClassName (both header paths, since the fix
            // round's lib/utils.ts twMerge fix), so this `<thead>`-level
            // color class had no descendant left to reach. `bg-surface-
            // container-low` stays — it's the one piece the grid's own
            // `headerBackground` boolean can't reproduce (its `bg-muted`
            // resolves to a different token, `--surface-container`).
            header: "bg-surface-container-low",
          }}
        >
          {/* SOLVRO PATCH — see data-grid.tsx's DataGridContainer: its
              `border` prop is accepted-and-ignored (no hairline painted), so
              the Level-1 hairline (DESIGN.md §4) is carried on this
              className instead. Phase-wide decision (reui-data-grid.md
              Checkpoint B) — every DataGrid table across the app wraps its
              DataGridContainer this way. */}
          <DataGridContainer className="rounded-sm border border-outline-variant bg-surface-container-lowest">
            <DataGridScrollArea>
              <DataGridTable />
            </DataGridScrollArea>
          </DataGridContainer>
        </DataGrid>
      )}

      {!isError && !isLoading && total > (tasks?.length ?? 0) && (
        <div className="mt-2 flex items-center gap-3">
          <p className="text-xs text-on-surface-variant">
            Showing {tasks?.length ?? 0} of {total}
          </p>
          {hasNextPage && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isFetchingNextPage}
              onClick={() => void fetchNextPage()}
            >
              {isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          )}
        </div>
      )}

      {editTask && (
        <TaskFormModal
          mode="edit"
          open={editTask !== null}
          onClose={() => setEditTask(null)}
          projectId={editTask.projectId}
          task={editTask}
        />
      )}
    </div>
  );
}

// Done tasks show the plain date — "Nd late" would misreport a finished task.
function fmt(iso: string | null, done: boolean) {
  return (done ? fmtDay(iso) : fmtDue(iso)) || EMPTY_VALUE;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// Re-export Task to silence TS in callers that import this file.
export type { Task };

// Removable chip for a person filter carried in the URL from the Overview.
function PersonChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 [@media(pointer:coarse)]:gap-3 rounded-sm border border-primary bg-surface-container-lowest py-0.5 pl-2 pr-0.5 [@media(pointer:coarse)]:pr-3 text-meta font-semibold text-on-surface">
      {label}
      <button
        type="button"
        aria-label={`Remove filter: ${label}`}
        onClick={onClear}
        className="tap-target flex h-5 w-5 items-center justify-center rounded-sm text-on-surface-variant transition-colors hover:text-primary outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-base">close</span>
      </button>
    </span>
  );
}
