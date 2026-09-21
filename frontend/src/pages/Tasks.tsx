import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
import { TaskFormModal } from "@/components/TaskFormModal";
import { TaskStatusChip } from "@/components/StatusChip";
import { dateToDay, dayFromIso, dayToDate } from "@/lib/dateField";
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
  useTasks,
  useUsers,
} from "@/lib/queries";

const STATUSES: TaskStatus[] = ["TODO", "IN_PROGRESS", "DONE"];
const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
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

export function Tasks() {
  // Filters chip state is UI-only (Filter[]); it is derived down into the
  // TasksFilter shape useTasks/queries.ts already expects — see `filter` below.
  const [activeFilters, setActiveFilters] = useState<Filter<string>[]>([]);
  const [overdue, setOverdue] = useState(false);
  const [topLevel, setTopLevel] = useState(true);
  // Replaces the old hand-rolled `sortKey` header state: TanStack owns
  // sorting now, driven entirely through DataGridColumnHeader. Same default
  // as before — due ascending.
  const [sorting, setSorting] = useState<SortingState>([{ id: "due", desc: false }]);
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
        options: STATUSES.map((s) => ({ value: s, label: s.replace("_", " ") })),
      },
      {
        key: "priority",
        label: "Priority",
        type: "select",
        operators: ONLY_IS_OPERATOR,
        options: PRIORITIES.map((p) => ({ value: p, label: p })),
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
  const filter = useMemo<TasksFilter>(() => {
    const valueFor = (key: string) =>
      activeFilters.find((f) => f.field === key)?.values[0];
    const status = valueFor("status");
    const priority = valueFor("priority");
    const assignedToId = valueFor("assignedToId");
    const customerId = valueFor("customerId");
    return {
      status: status as TaskStatus | undefined,
      priority: priority as Priority | undefined,
      assignedToId: assignedToId === undefined ? undefined : Number(assignedToId),
      customerId: customerId === undefined ? undefined : Number(customerId),
      overdue: overdue || undefined,
      topLevel: topLevel || undefined,
    };
  }, [activeFilters, overdue, topLevel]);

  const { data: tasks, isLoading, isError, error } = useTasks(filter);

  // Hoisted once per render of the list rather than once per cell — the
  // day string is identical for every row in a single render pass.
  const todayDay = dateToDay(startOfToday());

  const columns = useMemo<ColumnDef<TaskWithProject>[]>(
    () => [
      {
        id: "id",
        header: ({ column }) => <DataGridColumnHeader column={column} title="ID" />,
        enableSorting: false,
        cell: ({ row }) => (
          <span className="font-mono text-[11px] uppercase tracking-widest text-on-surface-variant">
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
              <span className="text-[11px] text-on-surface-variant">
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
                  ? "font-mono text-[12px] font-bold text-error"
                  : "font-mono text-[12px] text-on-surface-variant"
              }
            >
              {fmt(task.dueDate)}
              {isOverdue && " · OVERDUE"}
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
          Cross-project task list. Apply filters, sort, click any row to open the editor.
        </p>
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
            checked={overdue}
            onChange={(e) => setOverdue(e.target.checked)}
            className="h-3.5 w-3.5 accent-primary"
          />
          Overdue only
        </label>
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
            setOverdue(false);
            setTopLevel(true);
          }}
          className="ml-auto rounded-sm border border-outline-variant px-2 py-1 font-display text-label-caps uppercase tracking-wider text-on-surface-variant hover:border-primary hover:text-primary"
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

function fmt(iso: string | null) {
  // Derive the day via the UTC date-part,
  // not a local-time parse of the ISO instant.
  const d = dayToDate(dayFromIso(iso));
  if (!d) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// Re-export Task to silence TS in callers that import this file.
export type { Task };
