import { useMemo, useState } from "react";
import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useProjectContext } from "../ProjectDetail";
import { ConfirmModal } from "@/components/ConfirmModal";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { DataGrid, DataGridContainer } from "@/components/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";
import { RiskFormModal } from "@/components/RiskFormModal";
import { RiskScoreChip } from "@/components/RiskScoreChip";
import { Chip, type Tone } from "@/components/StatusChip";
import { TOOLBAR_BUTTON_PRIMARY, TOOLBAR_STAT } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { hasPermission, useAuth } from "@/lib/auth";
import { RISK_CATEGORY_LABEL, RISK_STATUS_LABEL } from "@/lib/labels";
import {
  type Risk,
  type RiskCategory,
  type RiskStatus,
  useDeleteRisk,
  useProjectRisks,
  useUpdateRisk,
} from "@/lib/queries";

// Open reads as needing attention, Mitigated as in hand, Closed as done.
const STATUS_TONE: Record<RiskStatus, Tone> = {
  OPEN: "rose",
  MITIGATED: "amber",
  CLOSED: "emerald",
};
// The editable status is a native select, which cannot be a pill: it carries
// the same tone as its text colour on the standard input surface. These tokens
// read as a colour on a plain surface in both themes (the chip text tones are
// tuned for a chip fill and turn near-white in dark).
const STATUS_TEXT: Record<RiskStatus, string> = {
  OPEN: "text-error",
  MITIGATED: "text-chip-amber-text",
  CLOSED: "text-primary",
};

// Workflow order for the DataGrid's Status column (accessorFn below) —
// matches RISK_STATUS_LABEL's own key order, same "not a person column, numeric
// workflow-order accessor" call as Tasks.tsx's status column.
const STATUS_ORDER: RiskStatus[] = ["OPEN", "MITIGATED", "CLOSED"];

const CATEGORIES: (RiskCategory | "ALL")[] = [
  "ALL",
  "EXTERNAL",
  "INTERNAL",
  "TECHNICAL",
  "ORGANIZATIONAL",
  "FINANCIAL",
];

const STATUSES: (RiskStatus | "ALL")[] = ["ALL", "OPEN", "MITIGATED", "CLOSED"];

const SCALE = [1, 2, 3, 4, 5];

export function ProjectRisks() {
  const { project } = useProjectContext();
  const { user } = useAuth();
  const { data: risks, isLoading, isError, error } = useProjectRisks(project.id);
  const updateRisk = useUpdateRisk(project.id);
  const deleteRisk = useDeleteRisk(project.id);

  const canEdit = hasPermission(user, "project:write");

  const [categoryFilter, setCategoryFilter] = useState<RiskCategory | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<RiskStatus | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Risk | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Risk | null>(null);

  const filtered = useMemo(() => {
    if (!risks) return [];
    const q = search.trim().toLowerCase();
    return risks
      .filter((r) => categoryFilter === "ALL" || r.category === categoryFilter)
      .filter((r) => statusFilter === "ALL" || r.status === statusFilter)
      .filter((r) =>
        q === ""
          ? true
          : r.description.toLowerCase().includes(q) ||
            (r.mitigationPlan ?? "").toLowerCase().includes(q) ||
            (r.contingencyPlan ?? "").toLowerCase().includes(q),
      )
      .sort((a, b) => b.probability * b.impact - a.probability * a.impact);
  }, [risks, categoryFilter, statusFilter, search]);

  const summary = useMemo(() => {
    const out = { high: 0, medium: 0, low: 0, open: 0 };
    for (const r of risks ?? []) {
      const s = r.probability * r.impact;
      if (s <= 8) out.low++;
      else if (s <= 15) out.medium++;
      else out.high++;
      if (r.status === "OPEN") out.open++;
    }
    return out;
  }, [risks]);

  if (isLoading) {
    return (
      <div className="h-64 animate-pulse rounded-sm border border-outline-variant bg-surface-container-low" />
    );
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Could not load risks: {(error as Error).message}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-4 md:min-h-0 md:flex-1">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Stat label="High" value={summary.high} tone="high" />
          <Stat label="Medium" value={summary.medium} tone="medium" />
          <Stat label="Low" value={summary.low} tone="low" />
          <Stat label="Open" value={summary.open} />
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className={TOOLBAR_BUTTON_PRIMARY}
          >
            <span aria-hidden="true" className="material-symbols-outlined text-base">add</span>
            Add risk
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-sm border border-outline-variant bg-surface-container-lowest p-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search description, mitigation, contingency…"
          aria-label="Search risks"
          className="w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-sm text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30 sm:w-72"
        />
        <Select
          label="Category"
          value={categoryFilter}
          onChange={(v) => setCategoryFilter(v as RiskCategory | "ALL")}
          options={CATEGORIES.map((c) => ({
            value: c,
            label: c === "ALL" ? "All categories" : RISK_CATEGORY_LABEL[c],
          }))}
        />
        <Select
          label="Status"
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as RiskStatus | "ALL")}
          options={STATUSES.map((s) => ({
            value: s,
            label: s === "ALL" ? "All statuses" : RISK_STATUS_LABEL[s],
          }))}
        />
        {(categoryFilter !== "ALL" || statusFilter !== "ALL" || search) && (
          <button
            type="button"
            onClick={() => {
              setCategoryFilter("ALL");
              setStatusFilter("ALL");
              setSearch("");
            }}
            className="[@media(pointer:coarse)]:inline-flex [@media(pointer:coarse)]:items-center [@media(pointer:coarse)]:min-h-11 ml-auto rounded-sm px-2 py-1 font-display text-xs font-semibold text-on-surface-variant hover:text-primary"
          >
            Reset
          </button>
        )}
      </div>

      <div className="md:min-h-0 md:flex-1 md:overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="rounded-sm border border-dashed border-outline-variant bg-surface-container-lowest p-12 text-center text-on-surface-variant">
            <p className="text-sm">
              {risks && risks.length > 0
                ? "No risks match the current filters."
                : "No risks logged yet."}
            </p>
            {canEdit && risks && risks.length === 0 && (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="[@media(pointer:coarse)]:inline-flex [@media(pointer:coarse)]:items-center [@media(pointer:coarse)]:min-h-11 mt-3 rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-1.5 font-display text-xs font-bold text-on-surface hover:bg-surface-container"
              >
                Add the first risk
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="hidden md:block">
              <RisksDataGrid
                risks={filtered}
                canEdit={canEdit}
                onEdit={(r) => setEditing(r)}
                onDelete={(r) => setConfirmDelete(r)}
                onChange={(id, patch) => updateRisk.mutate({ id, patch })}
              />
            </div>

            <div className="space-y-2 md:hidden">
              {filtered.map((r) => (
                <RiskCard
                  key={r.id}
                  risk={r}
                  canEdit={canEdit}
                  onEdit={() => setEditing(r)}
                  onDelete={() => setConfirmDelete(r)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {(creating || editing) && (
        <RiskFormModal
          open={creating || editing !== null}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          projectId={project.id}
          risk={editing}
        />
      )}

      <ConfirmModal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) {
            deleteRisk.mutate(confirmDelete.id, {
              onSuccess: () => setConfirmDelete(null),
            });
          }
        }}
        title="Delete risk"
        body={
          confirmDelete ? (
            <p>
              Delete the risk{" "}
              <span className="font-semibold text-on-surface">
                "{truncate(confirmDelete.description, 80)}"
              </span>
              ? This cannot be undone.
            </p>
          ) : null
        }
        confirmLabel="Delete"
        confirmTone="danger"
        busy={deleteRisk.isPending}
      />
    </div>
  );
}

function RisksDataGrid({
  risks,
  canEdit,
  onEdit,
  onDelete,
  onChange,
}: {
  risks: Risk[];
  canEdit: boolean;
  onEdit: (risk: Risk) => void;
  onDelete: (risk: Risk) => void;
  onChange: (
    id: number,
    patch: { probability?: number; impact?: number; status?: RiskStatus },
  ) => void;
}) {
  // No default TanStack sort — `risks` (the `filtered` prop from
  // ProjectRisks) already arrives pre-sorted highest-risk-first (its own
  // `.sort` call), same "let the incoming array order stand until a user
  // clicks a header" call as CustomerDetail.tsx's ProjectsDataGrid.
  const [sorting, setSorting] = useState<SortingState>([]);

  const columns = useMemo<ColumnDef<Risk>[]>(() => {
    const base: ColumnDef<Risk>[] = [
      {
        id: "description",
        accessorKey: "description",
        header: ({ column }) => <DataGridColumnHeader column={column} title="Description" />,
        // Free-text field — no natural sort a user would reach for, same
        // call as ServiceCatalogueManager's Description column.
        enableSorting: false,
        cell: ({ row }) => {
          const risk = row.original;
          return (
            <div>
              <button
                type="button"
                onClick={() => onEdit(risk)}
                // Prose-overflow sweep (GH #57 convention): the pre-DataGrid
                // table's `max-w-md` cell had no wrap-hardening, so a long
                // unbroken description could stretch the table past its
                // `overflow-x-auto` bound (docs/ISSUES.md deferred finding).
                // `whitespace-pre-wrap` preserves operator-entered line
                // breaks (this text comes from a `<textarea>`); `wrap-
                // break-word` is Tailwind v4's renamed `break-words` (see
                // TaskPanel.tsx's identical comment-body treatment).
                className="block [@media(pointer:coarse)]:min-h-11 whitespace-pre-wrap wrap-break-word text-left text-sm font-medium text-on-surface hover:text-primary"
              >
                {risk.description}
              </button>
              {(risk.mitigationPlan || risk.contingencyPlan) && (
                <div className="mt-1 space-y-0.5 text-meta text-on-surface-variant">
                  {risk.mitigationPlan && (
                    <p className="line-clamp-2">
                      <span className="font-display text-label-caps uppercase">
                        Mitigation:
                      </span>{" "}
                      {risk.mitigationPlan}
                    </p>
                  )}
                  {risk.contingencyPlan && (
                    <p className="line-clamp-2">
                      <span className="font-display text-label-caps uppercase">
                        Contingency:
                      </span>{" "}
                      {risk.contingencyPlan}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        },
        meta: { cellClassName: "max-w-md align-top", skeleton: <Skeleton className="h-3.5 w-48" /> },
      },
      {
        id: "category",
        accessorFn: (row) => RISK_CATEGORY_LABEL[row.category],
        header: ({ column }) => <DataGridColumnHeader column={column} title="Category" />,
        // Operator-facing English label, not a person name — "alphanumeric"
        // (decision 7, reui-data-grid.md Checkpoint B) same as Admin.tsx's
        // Role column.
        sortingFn: "alphanumeric",
        cell: ({ row }) => (
          <span className="text-xs text-on-surface-variant">
            {RISK_CATEGORY_LABEL[row.original.category]}
          </span>
        ),
        meta: { skeleton: <Skeleton className="h-3.5 w-20" /> },
      },
      {
        id: "probability",
        accessorKey: "probability",
        header: ({ column }) => <DataGridColumnHeader column={column} title="Prob" />,
        // A 1-5 scale-select control, not a magnitude column a user scans
        // for ordering — left unsortable so its header can stay centered
        // (the vendored DataGridColumnHeader's sortable path only supports
        // left/right alignment, not center — see gantt/data-grid-column-
        // header.tsx's `alignEnd`), matching the pre-DataGrid table's own
        // `text-center` treatment exactly.
        enableSorting: false,
        cell: ({ row }) => {
          const risk = row.original;
          return canEdit ? (
            <select
              aria-label={`Probability of risk: ${risk.description}`}
              value={risk.probability}
              onChange={(e) => onChange(risk.id, { probability: Number(e.target.value) })}
              className="[@media(pointer:coarse)]:min-h-11 rounded-sm border border-outline-variant bg-surface-container-lowest px-2 py-1 font-mono text-xs"
            >
              {SCALE.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          ) : (
            <span className="font-mono text-xs">{risk.probability}</span>
          );
        },
        meta: {
          headerClassName: "text-center",
          cellClassName: "text-center",
          skeleton: <Skeleton className="mx-auto h-6 w-10" />,
        },
      },
      {
        id: "impact",
        accessorKey: "impact",
        header: ({ column }) => <DataGridColumnHeader column={column} title="Impact" />,
        // Same rationale as "probability" above.
        enableSorting: false,
        cell: ({ row }) => {
          const risk = row.original;
          return canEdit ? (
            <select
              aria-label={`Impact of risk: ${risk.description}`}
              value={risk.impact}
              onChange={(e) => onChange(risk.id, { impact: Number(e.target.value) })}
              className="[@media(pointer:coarse)]:min-h-11 rounded-sm border border-outline-variant bg-surface-container-lowest px-2 py-1 font-mono text-xs"
            >
              {SCALE.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          ) : (
            <span className="font-mono text-xs">{risk.impact}</span>
          );
        },
        meta: {
          headerClassName: "text-center",
          cellClassName: "text-center",
          skeleton: <Skeleton className="mx-auto h-6 w-10" />,
        },
      },
      {
        id: "score",
        accessorFn: (row) => row.probability * row.impact,
        header: ({ column }) => <DataGridColumnHeader column={column} title="Score" />,
        // The one genuinely sort-worthy numeric column here (it's what the
        // pre-DataGrid table's default order was already derived from) —
        // sortable, right-aligned per the pilot's numeric-column convention
        // (meta.headerClassName:"text-right", same as Admin.tsx's
        // "projects" count column).
        cell: ({ row }) => {
          const risk = row.original;
          return (
            <div className="flex justify-end">
              <RiskScoreChip probability={risk.probability} impact={risk.impact} />
            </div>
          );
        },
        meta: { headerClassName: "text-right", skeleton: <Skeleton className="ml-auto h-6 w-16" /> },
      },
      {
        id: "status",
        accessorFn: (row) => STATUS_ORDER.indexOf(row.status),
        header: ({ column }) => <DataGridColumnHeader column={column} title="Status" />,
        cell: ({ row }) => {
          const risk = row.original;
          return canEdit ? (
            <select
              aria-label={`Status of risk: ${risk.description}`}
              value={risk.status}
              onChange={(e) => onChange(risk.id, { status: e.target.value as RiskStatus })}
              className={`[@media(pointer:coarse)]:min-h-11 w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-2 py-1 font-display text-meta font-semibold focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30 ${STATUS_TEXT[risk.status]}`}
            >
              {(Object.keys(RISK_STATUS_LABEL) as RiskStatus[]).map((s) => (
                <option key={s} value={s}>
                  {RISK_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          ) : (
            <Chip tone={STATUS_TONE[risk.status]}>{RISK_STATUS_LABEL[risk.status]}</Chip>
          );
        },
        meta: { skeleton: <Skeleton className="h-6 w-24 rounded-sm" /> },
      },
    ];
    if (canEdit) {
      base.push({
        id: "actions",
        header: ({ column }) => <DataGridColumnHeader column={column} title="Actions" />,
        enableSorting: false,
        cell: ({ row }) => {
          const risk = row.original;
          return (
            <div className="flex items-center justify-end gap-1 [@media(pointer:coarse)]:gap-5">
              <button
                type="button"
                onClick={() => onEdit(risk)}
                className="tap-target rounded-sm p-1 text-on-surface-variant hover:bg-surface-container hover:text-primary"
                aria-label="Edit risk"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-base">edit</span>
              </button>
              <button
                type="button"
                onClick={() => onDelete(risk)}
                className="tap-target rounded-sm p-1 text-on-surface-variant hover:bg-error-container hover:text-error"
                aria-label="Delete risk"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-base">delete</span>
              </button>
            </div>
          );
        },
        meta: { headerClassName: "text-right", skeleton: <Skeleton className="ml-auto h-6 w-14" /> },
      });
    }
    return base;
  }, [canEdit, onEdit, onDelete, onChange]);

  const table = useReactTable({
    data: risks,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (row) => String(row.id),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    // Pagination stays OFF (pilot verdict — docs/plans/reui-data-grid.md
    // Checkpoint B): no getPaginationRowModel, so the full sorted row model
    // renders. `pageSize` here only sizes the loading-skeleton row count.
    initialState: { pagination: { pageSize: 8 } },
  });

  return (
    <DataGrid
      table={table}
      recordCount={risks.length}
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

function RiskCard({
  risk,
  canEdit,
  onEdit,
  onDelete,
}: {
  risk: Risk;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-sm border border-outline-variant bg-surface-container-lowest p-3">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onEdit}
          // Prose-overflow sweep (GH #57 convention) — same rationale as the
          // desktop DataGrid's description cell above.
          className="[@media(pointer:coarse)]:min-h-11 block flex-1 whitespace-pre-wrap wrap-break-word text-left text-sm font-medium text-on-surface hover:text-primary"
        >
          {risk.description}
        </button>
        <RiskScoreChip probability={risk.probability} impact={risk.impact} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-meta">
        <span className="text-on-surface-variant">
          {RISK_CATEGORY_LABEL[risk.category]}
        </span>
        <span className="text-on-surface-variant">
          P{risk.probability} · I{risk.impact}
        </span>
        <Chip tone={STATUS_TONE[risk.status]}>{RISK_STATUS_LABEL[risk.status]}</Chip>
      </div>
      {canEdit && (
        <div className="mt-2 flex justify-end gap-1 [@media(pointer:coarse)]:gap-5">
          <button
            type="button"
            onClick={onEdit}
            className="tap-target rounded-sm p-1 text-on-surface-variant hover:bg-surface-container hover:text-primary"
            aria-label="Edit risk"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-base">edit</span>
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="tap-target rounded-sm p-1 text-on-surface-variant hover:bg-error-container hover:text-error"
            aria-label="Delete risk"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-base">delete</span>
          </button>
        </div>
      )}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex items-center gap-2 text-meta text-on-surface-variant">
      <span className="font-display text-label-caps uppercase">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="[@media(pointer:coarse)]:min-h-11 rounded-sm border border-outline-variant bg-surface-container-lowest px-2 py-1 text-sm text-on-surface focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "high" | "medium" | "low";
}) {
  // Same box as the toolbar buttons beside it (TOOLBAR_STAT), so the row sits
  // on one line with "Add risk". The colour is on the number only, and only
  // when there is something to count: "Add risk" stays the one solid element.
  const numberTone =
    value === 0
      ? ""
      : tone === "high"
        ? "text-error"
        : tone === "medium"
          ? "text-chip-amber-text"
          : tone === "low"
            ? "text-primary"
            : "text-on-surface";
  return (
    <div className={TOOLBAR_STAT}>
      <span className={`text-sm font-bold tabular-nums ${numberTone}`}>{value}</span>
      {label}
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
