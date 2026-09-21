// Pipeline "List" view (PRD §2.4, M3.12) — the deal list on the vendored
// `reui/data-grid`. Closest existing consumer read end-to-end before writing
// this: `pages/views/ProjectRisks.tsx` (same `pages/views/` split, same
// DataGrid/DataGridColumnHeader/DataGridScrollArea/DataGridTable wiring) and
// `pages/Tasks.tsx` (the house convention for a full-page, no-mobile-
// fallback grid — no separate `md:hidden` card tree, DataGridScrollArea's
// own horizontal scroll carries narrow viewports instead, which is what
// this file mirrors since PipelineList is a full-width view body, not a
// tab-embedded panel like ProjectRisks).
//
// Self-contained like `SolvroPipelineKanban.tsx`/`PipelineQuarter.tsx`
// (M3.14, read alongside this file — same self-contained-view precedent):
// fetches its own data via `useOpportunities()` — the same query cache the
// board reads (`pipelineKeys.list`) — rather than taking deals as a prop,
// since the view switcher (`Pipeline.tsx`, wired in a later integration
// task) mounts each view independently. No KPI bar here, matching
// PipelineQuarter.tsx's identical call: PRD §2.4's "shared toolbar and KPI
// bar stay mounted" implies that bar is hoisted to the Pipeline.tsx switcher
// shell, not owned by each view body.
//
// Column set follows this task's dispatch brief, which combines PRD §2.4's
// "List (from list-view.tsx)" spec with the reference app's actual behavior
// where the two disagree — see this task's report for the full rationale:
// - Deal value renders full IDR (`formatIDR`), not compact. PRD §2.4's
//   prose says "right-aligned compact IDR" but the reference
//   (../VeloraApp/components/kanban/list-view.tsx, read-only) actually
//   calls the full-currency `formatCurrency` in its list row; this task's
//   dispatch brief calls that discrepancy out explicitly and asks for full.
// - "Opportunity" (title + customer stacked in one cell) matches the
//   reference's actual combined cell rather than reading PRD §2.4's prose
//   as two separate columns.
// - Request date is included (per the dispatch brief) though neither PRD
//   §2.4's text nor the reference lists it as a List column. Produk
//   (`productSolution`) was initially dropped (M3.12) though PRD §2.4 lists
//   it; the M3 integration task added it back (see the "productSolution"
//   column below), placed right after Win% to match PRD §2.4's own
//   Win%→Produk adjacency without reordering the already-shipped
//   requestDate/deadline columns after it.
// - Row click now opens the opportunity detail page (`/pipeline/:id`, PRD
//   §2.5, M3.16) via `onRowClick` below — wired by the M3 integration task,
//   same shape as Tasks.tsx's `onRowClick={(task) => setEditTask(task)}`.
//   Still no separate row-hover edit action (PRD §2.4's "row-hover actions
//   (open, edit)") — edit lives on the detail page's own Edit button
//   (OpportunityDetail.tsx), out of this task's scope.
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { AssigneeAvatar } from "@/components/AssigneeAvatar";
import { isDealOverdue, probabilityTone } from "@/components/pipeline/kpi";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { DataGrid, DataGridContainer } from "@/components/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";
import { StageChip } from "@/components/StageChip";
import { Chip } from "@/components/StatusChip";
import { Skeleton } from "@/components/ui/skeleton";
import { dayToDate } from "@/lib/dateField";
import { formatIDR, formatPipelineDate, formatWinProbability, STAGE_ORDER } from "@/lib/pipelineFormat";
import { type Opportunity, useOpportunities } from "@/lib/queries";
import { personNameSortingFn } from "@/lib/tableSort";

// Stable empty-array constant (PRD §2.4: "`data:` gets a stable empty-array
// constant") — same convention as Tasks.tsx's `EMPTY_TASKS`, avoiding a new
// array identity on every render while the query is loading/undefined.
const EMPTY_DEALS: Opportunity[] = [];

export function PipelineList() {
  const { data: deals, isLoading, isError, error } = useOpportunities();

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Could not load the Pipeline list: {(error as Error).message}</AlertDescription>
      </Alert>
    );
  }

  return <PipelineListGrid deals={deals ?? EMPTY_DEALS} isLoading={isLoading} />;
}

function PipelineListGrid({ deals, isLoading }: { deals: Opportunity[]; isLoading: boolean }) {
  // No default TanStack sort — `deals` arrives pre-sorted `[{stage: "asc"},
  // {stageOrder: "asc"}]` from GET /opportunities (backend/src/routes/
  // opportunities.ts), the same board order the Kanban shows. PRD §2.4:
  // "Default sort: none (server order)"; sort cycle desc -> asc -> off is
  // DataGridColumnHeader's own native affordance, same as every other house
  // DataGrid table.
  const [sorting, setSorting] = useState<SortingState>([]);
  const navigate = useNavigate();

  const columns = useMemo<ColumnDef<Opportunity>[]>(
    () => [
      {
        id: "opportunity",
        accessorKey: "title",
        header: ({ column }) => <DataGridColumnHeader column={column} title="Opportunity" />,
        // Free-text title — no natural sort a user reaches for, same call as
        // Tasks.tsx's own "title" column and RisksDataGrid's "description".
        enableSorting: false,
        cell: ({ row }) => (
          <div className="min-w-0">
            {/* Title as a real `<Link>` — keyboard/screen-reader route to
                the detail page (`onRowClick` below fires on a row click,
                but a data-grid row isn't natively Tab-reachable).
                `stopPropagation` keeps the click from also bubbling to
                `onRowClick` and double-navigating; the row click stays the
                mouse affordance. Unobtrusive styling — same ink color as
                before, `hover:text-primary` only as the extra affordance. */}
            <Link
              to={`/pipeline/${row.original.id}`}
              onClick={(e) => e.stopPropagation()}
              className="block truncate rounded-sm font-medium text-on-surface hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              {row.original.title}
            </Link>
            <p className="truncate text-xs text-on-surface-variant">{row.original.customerName}</p>
          </div>
        ),
        meta: { skeleton: <Skeleton className="h-3.5 w-40" /> },
      },
      {
        id: "stage",
        // Workflow-order index, not a person/free-text column — same
        // "numeric accessorFn, no explicit sortingFn" call as Tasks.tsx's
        // priority/status columns.
        accessorFn: (row) => STAGE_ORDER.indexOf(row.stage),
        header: ({ column }) => <DataGridColumnHeader column={column} title="Stage" />,
        cell: ({ row }) => <StageChip stage={row.original.stage} />,
        meta: { skeleton: <Skeleton className="h-5 w-24 rounded-full" /> },
      },
      {
        id: "dealValue",
        accessorKey: "dealValue",
        header: ({ column }) => <DataGridColumnHeader column={column} title="Deal value" />,
        // Right-aligned per PRD §2.4 ("Nilai" column); numeric accessorKey
        // needs no explicit sortingFn, same as Admin.tsx's/CustomerDetail's
        // numeric count columns.
        cell: ({ row }) => (
          <span className="font-mono text-[13px] tabular-nums text-on-surface">
            {formatIDR(row.original.dealValue)}
          </span>
        ),
        meta: {
          headerClassName: "text-right",
          cellClassName: "text-right",
          skeleton: <Skeleton className="ml-auto h-3.5 w-28" />,
        },
      },
      {
        id: "pic",
        accessorFn: (row) => row.pic?.username ?? "",
        header: ({ column }) => <DataGridColumnHeader column={column} title="PIC" />,
        // Person-name column — explicit sortingFn per lib/tableSort.ts's own
        // rationale (TanStack's sortingFn auto-detect samples from row 10
        // onward, so small tables never get sampled and silently fall back
        // to raw codepoint compare). "" for unassigned sorts first
        // ascending, same convention as CustomerDetail.tsx's "sa" column.
        sortingFn: personNameSortingFn,
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-1.5">
            <AssigneeAvatar user={row.original.pic} size="xs" />
            <span className="truncate text-on-surface-variant">
              {row.original.pic?.username ?? "Unassigned"}
            </span>
          </span>
        ),
        meta: { skeleton: <Skeleton className="h-5 w-24" /> },
      },
      {
        id: "winProbability",
        accessorKey: "winProbability",
        header: ({ column }) => <DataGridColumnHeader column={column} title="Win %" />,
        // Centered chip per PRD §2.4 ("Win% (centered chip)").
        cell: ({ row }) => (
          <div className="flex justify-center">
            <Chip tone={probabilityTone(row.original.winProbability)}>
              {formatWinProbability(row.original.winProbability)}
            </Chip>
          </div>
        ),
        meta: {
          headerClassName: "text-center",
          cellClassName: "text-center",
          skeleton: <Skeleton className="mx-auto h-5 w-12 rounded-full" />,
        },
      },
      {
        id: "productSolution",
        accessorKey: "productSolution",
        header: ({ column }) => <DataGridColumnHeader column={column} title="Produk" />,
        // Free-text field, truncated — same "no natural sort" call as the
        // "opportunity" column's title; not sortable per this task's
        // dispatch brief ("sortable optional").
        enableSorting: false,
        cell: ({ row }) => (
          <span className="block max-w-48 truncate text-xs text-on-surface-variant">
            {row.original.productSolution || "—"}
          </span>
        ),
        meta: { skeleton: <Skeleton className="h-3.5 w-32" /> },
      },
      {
        id: "requestDate",
        // `requestDate` is already a plain "yyyy-MM-dd" day string (never an
        // ISO instant — see Opportunity's own doc comment in queries.ts), so
        // `dayToDate` parses it directly with no `dayFromIso` step, unlike
        // Tasks.tsx's ISO-instant `dueDate`. Null sorts to the end
        // ascending / start descending, same `POSITIVE_INFINITY` convention
        // as Tasks.tsx's "due" column.
        accessorFn: (row) => dayToDate(row.requestDate)?.getTime() ?? Number.POSITIVE_INFINITY,
        header: ({ column }) => <DataGridColumnHeader column={column} title="Request date" />,
        cell: ({ row }) => (
          <span className="font-mono text-[12px] text-on-surface-variant">
            {row.original.requestDate ? formatPipelineDate(row.original.requestDate) : "—"}
          </span>
        ),
        meta: { skeleton: <Skeleton className="h-3.5 w-16" /> },
      },
      {
        id: "deadline",
        accessorFn: (row) => dayToDate(row.deadline)?.getTime() ?? Number.POSITIVE_INFINITY,
        header: ({ column }) => <DataGridColumnHeader column={column} title="Deadline" />,
        // Overdue treatment consistent with house: same `isDealOverdue`
        // helper (components/pipeline/kpi.ts) OpportunityCard.tsx uses for
        // its card deadline row, and the same bold-error + "· OVERDUE"
        // suffix Tasks.tsx's "due" column uses for an overdue task date.
        cell: ({ row }) => {
          const deal = row.original;
          const overdue = isDealOverdue(deal.deadline);
          return (
            <span
              className={
                overdue
                  ? "font-mono text-[12px] font-bold text-error"
                  : "font-mono text-[12px] text-on-surface-variant"
              }
            >
              {deal.deadline ? formatPipelineDate(deal.deadline) : "—"}
              {overdue && " · OVERDUE"}
            </span>
          );
        },
        meta: { skeleton: <Skeleton className="h-3.5 w-16" /> },
      },
    ],
    [],
  );

  const table = useReactTable({
    data: deals,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    // Pagination stays OFF app-wide (PRD §2.4 / reui-data-grid.md Checkpoint
    // B): no getPaginationRowModel, so the full sorted row model renders.
    // `pageSize` here only sizes the loading-skeleton row count.
    initialState: { pagination: { pageSize: 8 } },
  });

  return (
    <DataGrid
      table={table}
      recordCount={deals.length}
      isLoading={isLoading}
      loadingMode="skeleton"
      emptyMessage="No opportunities match yet."
      // Row click -> opportunity detail (M3 integration; M3.12's dispatch
      // brief originally left this seam unwired pending OpportunityDetail).
      // Same shape as Tasks.tsx's `onRowClick={(task) => setEditTask(task)}`.
      onRowClick={(deal) => navigate(`/pipeline/${deal.id}`)}
      tableLayout={{
        dense: true,
        rowBorder: true,
        headerBorder: true,
        headerBackground: false,
        // "auto", not "fixed" — see Tasks.tsx / reui-data-grid.md Checkpoint
        // B, decision 6: "fixed" pins every column to TanStack's untouched
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
          DataGridContainer this way. DataGridScrollArea (not a separate
          `md:hidden` mobile card tree) is what carries narrow viewports —
          same "the data-grid's own overflow behavior" call as Tasks.tsx,
          the closest full-page, non-tab-embedded DataGrid consumer. */}
      <DataGridContainer className="rounded-sm border border-outline-variant bg-surface-container-lowest">
        <DataGridScrollArea>
          <DataGridTable />
        </DataGridScrollArea>
      </DataGridContainer>
    </DataGrid>
  );
}
