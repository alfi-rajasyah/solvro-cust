import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ConfirmModal } from "@/components/ConfirmModal";
import { CustomerFormModal } from "@/components/CustomerFormModal";
import { EmptyState } from "@/components/EmptyState";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { QueryErrorAlert } from "@/components/QueryErrorAlert";
import { DataGrid, DataGridContainer } from "@/components/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";
import { Chip } from "@/components/StatusChip";
import { TableSkeleton } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNewParam } from "@/hooks/useNewParam";
import { hasPermission, useAuth } from "@/lib/auth";
import { canChangeCustomerOwner, canOwnCustomer, saveErrorMessage } from "@/lib/ownerAccess";
import { WEEKLY_STATUS_LABEL } from "@/lib/labels";
import {
  type CustomerSummary,
  useCustomers,
  useDeleteCustomer,
  useProjects,
} from "@/lib/queries";

export function Customers() {
  const { user } = useAuth();
  const { data: customers, isLoading, isError, error, refetch } = useCustomers();
  const deleteCustomer = useDeleteCustomer();
  // TAM ids of the visible projects per customer — the "TAM of one of its
  // projects" arm of customer ownership (the list rows only carry a count).
  const { data: projects } = useProjects();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerSummary | null>(null);
  const [deleting, setDeleting] = useState<CustomerSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const projectTamIdsByCustomer = useMemo(() => {
    const map = new Map<number, number[]>();
    for (const p of projects ?? []) {
      if (p.customerId === null) continue;
      map.set(p.customerId, [...(map.get(p.customerId) ?? []), p.tamId]);
    }
    return map;
  }, [projects]);
  // Owner-only delete — see lib/ownerAccess.ts (changing the owner is narrower, and server-decided: canChangeCustomerOwner).
  const ownsCustomer = useCallback(
    (c: CustomerSummary) => canOwnCustomer(user, c, projectTamIdsByCustomer.get(c.id) ?? []),
    [user, projectTamIdsByCustomer],
  );

  const canMutate = hasPermission(user, "project:write");
  const viewAll = hasPermission(user, "project:view-all");
  useNewParam("1", canMutate, () => setCreateOpen(true));

  async function handleDelete(c: CustomerSummary) {
    setDeleting(null);
    setDeleteError(null);
    try {
      await deleteCustomer.mutateAsync(c.id);
    } catch (err) {
      setDeleteError(saveErrorMessage(err, "Delete failed."));
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-on-surface">Customers</h1>
          <p className="text-sm text-on-surface-variant">
            {viewAll
              ? "Customer database. Every project is mapped to a customer for cross-account visibility and reporting."
              : "Customers assigned to you, plus customers of the projects you work on."}
          </p>
        </div>
        {canMutate && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 font-display text-sm text-on-primary transition-colors hover:bg-primary-container font-semibold"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-base">add</span>
            New customer
          </button>
        )}
      </div>

      {deleteError && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{deleteError}</AlertDescription>
        </Alert>
      )}

      {isLoading && (
        <TableSkeleton
          rows={8}
          columns={canMutate ? 8 : 7}
          widths={["w-3/4", "w-2/3", "w-2/3", "w-8", "w-8", "w-8", "w-20", "w-6"]}
        />
      )}

      {isError && (
        <QueryErrorAlert title="Could not load customers" error={error} onRetry={refetch} />
      )}

      {customers && customers.length === 0 && (
        <EmptyState
          icon="business"
          message={viewAll ? "No customers yet." : "No customers are assigned to you."}
          action={
            canMutate ? (
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="inline-flex items-center gap-2 rounded-sm bg-primary px-4 py-2 font-display text-xs font-bold text-on-primary hover:bg-primary-container"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-base">add</span>
                Add your first customer
              </button>
            ) : null
          }
        />
      )}

      {customers && customers.length > 0 && (
        <CustomersTable
          customers={customers}
          canMutate={canMutate}
          onEdit={setEditing}
          onDelete={setDeleting}
          canOwn={ownsCustomer}
        />
      )}

      <CustomerFormModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <CustomerFormModal
        open={editing !== null}
        onClose={() => setEditing(null)}
        customer={editing}
        canChangeOwner={editing ? canChangeCustomerOwner(editing) : true}
      />
      <ConfirmModal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && void handleDelete(deleting)}
        title="Delete customer"
        body={`Delete customer "${deleting?.name ?? ""}"? Linked projects keep their tasks but lose the customer link.`}
        confirmLabel="Delete"
        confirmTone="danger"
        busy={deleteCustomer.isPending}
      />
    </div>
  );
}

// Weekly-update column: sorts None < Draft < Done. A NOT_STARTED row counts as
// "none" — nothing has been written for the week yet.
const WEEKLY_RANK = { none: 0, draft: 1, done: 2 } as const;

function weeklyKind(c: CustomerSummary): keyof typeof WEEKLY_RANK {
  const status = c.health?.weeklyUpdate?.status;
  if (status === "DONE") return "done";
  if (status === "DRAFT") return "draft";
  return "none";
}

function initialsOf(name: string) {
  return name.slice(0, 2).toUpperCase();
}

function CustomersTable({
  customers,
  canMutate,
  onEdit,
  onDelete,
  canOwn,
}: {
  customers: CustomerSummary[];
  canMutate: boolean;
  onEdit: (c: CustomerSummary) => void;
  onDelete: (c: CustomerSummary) => void;
  /** Owner-only actions (Delete) show only where this is true. */
  canOwn: (c: CustomerSummary) => boolean;
}) {
  const navigate = useNavigate();
  // The server returns rows by name; a header click re-sorts client-side.
  const [sorting, setSorting] = useState<SortingState>([]);

  const columns = useMemo<ColumnDef<CustomerSummary>[]>(() => {
    const cols: ColumnDef<CustomerSummary>[] = [
      {
        id: "name",
        accessorFn: (c) => c.name.toLowerCase(),
        header: ({ column }) => <DataGridColumnHeader column={column} title="Customer" />,
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden="true"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-sm bg-primary/10 font-display text-xs font-bold text-primary"
            >
              {initialsOf(row.original.name)}
            </span>
            {/* Heading kept so the customer name stays a named landmark
                (customer-visibility.spec.ts reads it as an h3). */}
            <h3 className="min-w-0 truncate font-display text-sm font-semibold text-on-surface">
              <Link
                to={`/customers/${row.original.id}`}
                onClick={(e) => e.stopPropagation()}
                className="hover:text-primary hover:underline"
              >
                {row.original.name}
              </Link>
            </h3>
          </div>
        ),
        meta: { skeleton: <Skeleton className="h-3.5 w-32" /> },
      },
      {
        id: "am",
        accessorFn: (c) => c.accountManager?.toLowerCase() || undefined,
        sortUndefined: "last",
        header: ({ column }) => <DataGridColumnHeader column={column} title="AM" />,
        cell: ({ row }) => (
          <span className="text-on-surface-variant">{row.original.accountManager || "—"}</span>
        ),
        meta: { skeleton: <Skeleton className="h-3.5 w-20" /> },
      },
      {
        id: "tam",
        accessorFn: (c) => c.tam?.username.toLowerCase(),
        sortUndefined: "last",
        header: ({ column }) => <DataGridColumnHeader column={column} title="TAM" />,
        cell: ({ row }) => (
          <span className="text-on-surface-variant">{row.original.tam?.username ?? "—"}</span>
        ),
        meta: { skeleton: <Skeleton className="h-3.5 w-20" /> },
      },
      {
        id: "projects",
        accessorFn: (c) => c._count.projects,
        header: ({ column }) => <DataGridColumnHeader column={column} title="Projects" />,
        cell: ({ row }) => (
          <Link
            to={`/projects?customerId=${row.original.id}`}
            onClick={(e) => e.stopPropagation()}
            title="View this customer's projects"
            className="tabular-nums text-on-surface-variant hover:text-primary hover:underline"
          >
            {row.original._count.projects}
          </Link>
        ),
        meta: { skeleton: <Skeleton className="h-3.5 w-6" /> },
      },
      {
        id: "overdue",
        accessorFn: (c) => c.health?.overdueCount ?? 0,
        header: ({ column }) => <DataGridColumnHeader column={column} title="Overdue" />,
        cell: ({ row }) => {
          const n = row.original.health?.overdueCount ?? 0;
          return (
            <span
              className={
                n > 0 ? "font-bold tabular-nums text-error" : "tabular-nums text-on-surface-variant"
              }
            >
              {n}
            </span>
          );
        },
        meta: { skeleton: <Skeleton className="h-3.5 w-6" /> },
      },
      {
        id: "risks",
        accessorFn: (c) => c.health?.openRiskCount ?? 0,
        header: ({ column }) => <DataGridColumnHeader column={column} title="Risks" />,
        cell: ({ row }) => {
          const n = row.original.health?.openRiskCount ?? 0;
          return (
            <span
              className={
                n > 0
                  ? "font-semibold tabular-nums text-on-surface"
                  : "tabular-nums text-on-surface-variant"
              }
            >
              {n}
            </span>
          );
        },
        meta: { skeleton: <Skeleton className="h-3.5 w-6" /> },
      },
      {
        id: "weekly",
        accessorFn: (c) => WEEKLY_RANK[weeklyKind(c)],
        header: ({ column }) => <DataGridColumnHeader column={column} title="Weekly update" />,
        cell: ({ row }) => {
          const kind = weeklyKind(row.original);
          if (kind === "done") return <Chip tone="emerald">{WEEKLY_STATUS_LABEL.DONE}</Chip>;
          if (kind === "draft") return <Chip tone="amber">{WEEKLY_STATUS_LABEL.DRAFT}</Chip>;
          return <Chip tone="gray">{WEEKLY_STATUS_LABEL.NOT_STARTED}</Chip>;
        },
        meta: { skeleton: <Skeleton className="h-4 w-20 rounded-full" /> },
      },
    ];
    if (canMutate) {
      cols.push({
        id: "actions",
        enableSorting: false,
        size: 48,
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          // The menu popup portals out of the row, but React events still
          // bubble through the component tree to the row's onClick.
          <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    aria-label={`Actions for ${row.original.name}`}
                    title="More customer actions"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-on-surface-variant outline-hidden transition-colors hover:bg-surface-container hover:text-on-surface focus-visible:ring-2 focus-visible:ring-primary/30"
                  >
                    <span className="material-symbols-outlined text-base" aria-hidden="true">
                      more_horiz
                    </span>
                  </button>
                }
              />
              {/* z-50 on the Positioner (frontend/CLAUDE.md "Popover z-index"). */}
              <DropdownMenuContent
                align="end"
                className="w-40 bg-surface-container-lowest shadow-overlay!"
                positionerClassName="z-50"
              >
                <DropdownMenuItem onClick={() => onEdit(row.original)} className="text-xs">
                  <span className="material-symbols-outlined text-base" aria-hidden="true">
                    edit
                  </span>
                  Edit
                </DropdownMenuItem>
                {canOwn(row.original) && (
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => onDelete(row.original)}
                    className="text-xs"
                  >
                    <span className="material-symbols-outlined text-base" aria-hidden="true">
                      delete
                    </span>
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
        meta: { skeleton: <Skeleton className="h-6 w-6" /> },
      });
    }
    return cols;
  }, [canMutate, onEdit, onDelete, canOwn]);

  const table = useReactTable({
    data: customers,
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
      recordCount={customers.length}
      onRowClick={(c) => navigate(`/customers/${c.id}`)}
      emptyMessage="No customers."
      tableLayout={{
        dense: true,
        rowBorder: true,
        headerBorder: true,
        headerBackground: false,
        width: "auto",
      }}
      tableClassNames={{ header: "bg-surface-container-low" }}
    >
      {/* Level-1 hairline on the container (same as the Tasks grid). */}
      <DataGridContainer className="rounded-sm border border-outline-variant bg-surface-container-lowest">
        <DataGridScrollArea>
          <DataGridTable />
        </DataGridScrollArea>
      </DataGridContainer>
    </DataGrid>
  );
}
