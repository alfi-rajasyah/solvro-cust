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
import { Alert, AlertDescription } from "@/components/reui/alert";
import { Tabs } from "@/components/Tabs";
import { TaskFormModal } from "@/components/TaskFormModal";
import { TaskStatusChip } from "@/components/StatusChip";
import { useAuth } from "@/lib/auth";
import { dateToDay, dayFromIso } from "@/lib/dateField";
import { fmtDay, fmtDue } from "@/lib/formatDate";
import { parseWeekKey, weekKeyOf } from "@/lib/isoWeek";
import { priorityOptions, taskStatusOptions } from "@/lib/labels";
import {
  type Filter,
  type FilterFieldConfig,
  Filters,
} from "@/components/reui/filters";
import { DataGrid, DataGridContainer } from "@/components/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type Priority,
  type Task,
  type TaskStatus,
  type TaskWithProject,
  type TasksFilter,
  useCustomers,
  useTasksWithTotal,
  useUsers,
} from "@/lib/queries";

const STATUSES: TaskStatus[] = ["TODO", "IN_PROGRESS", "DONE"];
const PRIORITY_ORDER: Record<Priority, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

// Stable empty-array reference for `data:` while `useTasks` is loading —
// avoids a fresh `[]` literal (and therefore a new TanStack row model) on
// every render that a `tasks ?? []` inline fallback would produce.
const EMPTY_TASKS: TaskWithProject[] = [];

// Only the affirmative "is" operator is offered on every filter field below —
// the derivation in Tasks() reads just `.values[0]` per field, so a
// select-type field's other vendored-default operators ("is not", "is
// empty", "is not empty") would render a chip whose label lies about what's
// actually being sent to useTasks (e.g. a "Status is not DONE" chip would
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
  // TasksFilter shape useTasks/queries.ts already expects — see `filter` below.
  const [activeFilters, setActiveFilters] = useState<Filter<string>[]>([]);
  const [topLevel, setTopLevel] = useState(true);
  // TanStack owns header sorting (DataGridColumnHeader). It starts empty: the
  // server already returns rows soonest-due first (`sort=due`), and a header
  // click re-sorts the loaded rows client-side.
  const [sorting, setSorting] = useState<SortingState>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const view = parseView(searchParams.get("view"));
  const { user } = useAuth();
  const [editTask, setEditTask] = useState<TaskWithProject | null>(null);

  const { data: users } = useUsers();
  const { data: customers } = useCustomers();

  const filterFields = useMemo<FilterFieldConfig<string>[]>(
    () => [
      {
        key: "status",
        label: "Status",
        type: "select",
        operators: ONLY_IS_OPERATOR,
        options: taskStatusOptions,
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
      {
        key: "customerId",
        label: "Customer",
        type: "select",
        operators: ONLY_IS_OPERATOR,
        options: (customers ?? []).map((c) => ({ value: String(c.id), label: c.name })),
      },
    ],
    [users, customers],
  );

  // Derive the TasksFilter useTasks/queries.ts expects from the active Filter
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
      status: status as TaskStatus | undefined,
      priority: priority as Priority | undefined,
      // Likewise an Assignee chip wins over "My open"'s current user.
      assignedToId: assignedToId === undefined ? base.assignedToId : Number(assignedToId),
      customerId: customerId === undefined ? undefined : Number(customerId),
      topLevel: topLevel || undefined,
    };
  }, [activeFilters, topLevel, view, todayDay, userId]);

  const { data, isLoading, isError, error } = useTasksWithTotal(filter);
  const tasks = data?.tasks;
  const total = data?.total ?? 0;

  const setView = (next: ViewKey) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === DEFAULT_VIEW) params.delete("view");
        else params.set("view", next);
        return params;
      },
      { replace: false },
    );
  };

  const columns = useMemo<ColumnDef<TaskWithProject>[]>(
    () => [
      {
        id: "id",
        header: ({ column }) => <DataGridColumnHeader column={column} title="ID" />,
        enableSorting: false,
        cell: ({ row }) => (
          <span className="font-mono text-label-caps uppercase tracking-widest text-on-surface-variant">
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
            className="text-on-surface-variant hover:text-primary"
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
                  ? "text-[12px] font-bold text-error"
                  : "text-[12px] text-on-surface-variant"
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
        accessorFn: (row) => STATUSES.indexOf(row.status),
        header: ({ column }) => <DataGridColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <TaskStatusChip status={row.original.status} />,
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
        <h1 className="font-display text-2xl font-bold text-on-surface">Tasks</h1>
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
        <label className="flex items-center gap-2 text-xs text-on-surface-variant">
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
            setView(DEFAULT_VIEW);
          }}
          className="ml-auto rounded-sm border border-outline-variant px-2 py-1 font-display text-sm text-on-surface-variant hover:border-primary hover:text-primary font-semibold"
        >
          Reset
        </button>
      </div>

      {isError && (
        <Alert variant="destructive">
          <AlertDescription>Could not load tasks: {(error as Error).message}</AlertDescription>
        </Alert>
      )}

      {!isError && (
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
        <p className="mt-2 text-xs text-on-surface-variant">
          Showing {tasks?.length ?? 0} of {total}
        </p>
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
  return (done ? fmtDay(iso) : fmtDue(iso)) || "—";
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// Re-export Task to silence TS in callers that import this file.
export type { Task };
