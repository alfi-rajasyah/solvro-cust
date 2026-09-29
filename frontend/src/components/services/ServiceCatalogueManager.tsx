import { useState, type FormEvent } from "react";
import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ConfirmModal } from "@/components/ConfirmModal";
import { ApiError } from "@/lib/api";
import {
  type Service,
  useCreateService,
  useDeleteService,
  useServices,
  useUpdateService,
} from "@/lib/queries";
import { DataGrid, DataGridContainer } from "@/components/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";
import { Skeleton } from "@/components/ui/skeleton";

// Stable empty-array reference for `data:` while useServices is loading —
// same rationale as Tasks.tsx's EMPTY_TASKS: avoids a fresh `[]` literal
// (and therefore a new TanStack row model) on every render that a
// `services ?? []` inline fallback would produce.
const EMPTY_SERVICES: Service[] = [];

/**
 * Shared service-catalogue curation UI: add / rename / describe / activate
 * toggle / delete for the global `Service` catalogue.
 *
 * Lives in Settings now (not Admin) — catalogue writes are gated by the
 * `project:write` permission, not admin-only, so any TAM with that
 * permission can curate names, descriptions, and availability here, in
 * addition to adding services inline from a customer's or project's
 * Services tab.
 */
export function ServiceCatalogueManager() {
  const { data: services, isLoading, isError } = useServices();
  const create = useCreateService();
  const update = useUpdateService();
  const remove = useDeleteService();
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Service | null>(null);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  // TanStack sorting state for the DataGrid migration below — no default
  // sort (mirrors the pre-DataGrid table, which rendered rows in
  // useServices' own order), same "no default sort" call as Admin.tsx's
  // UsersTab.
  const [sorting, setSorting] = useState<SortingState>([]);

  const rows = services ?? EMPTY_SERVICES;

  // Column defs close over editingId/editName/editDesc and the mutation
  // handlers below (function declarations, hoisted within this component
  // body — see handleAdd/startEdit/saveEdit/toggleActive/handleDelete
  // further down). A plain per-render array, not useMemo, same call as
  // Admin.tsx's UsersTab columns: this table has no resizing/pinning/
  // visibility state for a stale/fresh identity to disturb, so memoizing
  // would only add complexity for zero benefit at catalogue-list size.
  const columns: ColumnDef<Service>[] = [
    {
      id: "name",
      accessorKey: "name",
      header: ({ column }) => <DataGridColumnHeader column={column} title="Name" />,
      // Service names are catalog-item names, not person names — natural
      // number ordering (TanStack's "alphanumeric") is the more useful
      // choice, same reasoning as Admin.tsx's Role-name column and
      // Tasks.tsx's Project-name column (decision 7, reui-data-grid.md
      // Checkpoint B).
      sortingFn: "alphanumeric",
      cell: ({ row }) => {
        const s = row.original;
        return editingId === s.id ? (
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            maxLength={100}
            className="w-full rounded-sm border border-outline-variant bg-surface px-2 py-1 text-sm focus:border-primary focus:outline-hidden"
          />
        ) : (
          <span className={["font-medium text-on-surface", s.active ? "" : "opacity-60"].join(" ")}>
            {s.name}
          </span>
        );
      },
      meta: { skeleton: <Skeleton className="h-3.5 w-32" /> },
    },
    {
      id: "description",
      accessorKey: "description",
      header: ({ column }) => <DataGridColumnHeader column={column} title="Description" />,
      // Free-text field — no natural sort a user would reach for (long
      // prose, often duplicate/empty values); left unsortable rather than
      // declaring a sortingFn nobody would use.
      enableSorting: false,
      cell: ({ row }) => {
        const s = row.original;
        return editingId === s.id ? (
          <input
            type="text"
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            maxLength={1000}
            className="w-full rounded-sm border border-outline-variant bg-surface px-2 py-1 text-sm focus:border-primary focus:outline-hidden"
          />
        ) : (
          <span className={["text-on-surface-variant", s.active ? "" : "opacity-60"].join(" ")}>
            {s.description || "—"}
          </span>
        );
      },
      meta: { skeleton: <Skeleton className="h-3.5 w-48" /> },
    },
    {
      id: "status",
      accessorFn: (row) => (row.active ? 1 : 0),
      header: ({ column }) => <DataGridColumnHeader column={column} title="Status" />,
      cell: ({ row }) => {
        const s = row.original;
        return (
          <span className={s.active ? undefined : "opacity-60"}>
            <button
              type="button"
              onClick={() => toggleActive(s)}
              className={[
                "rounded-full px-2 py-0.5 font-display text-sm font-semibold",
                s.active
                  ? "bg-chip-emerald-bg text-chip-emerald-text"
                  : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest",
              ].join(" ")}
              title="Click to toggle"
            >
              {s.active ? "Active" : "Inactive"}
            </button>
          </span>
        );
      },
      meta: { skeleton: <Skeleton className="h-4 w-16 rounded-full" /> },
    },
    {
      id: "actions",
      header: ({ column }) => <DataGridColumnHeader column={column} title="Actions" />,
      enableSorting: false,
      cell: ({ row }) => {
        const s = row.original;
        const isEditing = editingId === s.id;
        return (
          <div className={["flex items-center justify-end gap-1", s.active ? "" : "opacity-60"].join(" ")}>
            {isEditing ? (
              <>
                <button
                  type="button"
                  onClick={saveEdit}
                  disabled={update.isPending || !editName.trim()}
                  className="rounded-sm bg-primary px-2 py-1 font-display text-sm text-on-primary hover:bg-primary-container disabled:opacity-50 font-semibold"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  disabled={update.isPending}
                  className="rounded-sm px-2 py-1 font-display text-sm text-on-surface-variant hover:bg-surface-container font-semibold"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => startEdit(s)}
                  className="rounded-sm px-2 py-1 font-display text-sm text-on-surface-variant hover:bg-surface-container hover:text-on-surface font-semibold"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setDeleting(s)}
                  className="rounded-sm px-2 py-1 font-display text-sm text-on-surface-variant hover:bg-error-container hover:text-on-error-container font-semibold"
                >
                  Delete
                </button>
              </>
            )}
          </div>
        );
      },
      meta: { headerClassName: "text-right", skeleton: <Skeleton className="ml-auto h-6 w-32" /> },
    },
  ];

  const table = useReactTable({
    data: rows,
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

  if (isLoading) return <p className="text-on-surface-variant">Loading services…</p>;
  if (isError || !services)
    return <p className="text-error">Failed to load services.</p>;

  async function handleAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!newName.trim()) return;
    try {
      await create.mutateAsync({
        name: newName.trim(),
        description: newDesc.trim() || undefined,
      });
      setNewName("");
      setNewDesc("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create service.");
    }
  }

  function startEdit(s: Service) {
    setEditingId(s.id);
    setEditName(s.name);
    setEditDesc(s.description ?? "");
    setError(null);
  }

  async function saveEdit() {
    if (editingId === null) return;
    setError(null);
    try {
      await update.mutateAsync({
        id: editingId,
        patch: { name: editName.trim(), description: editDesc.trim() || undefined },
      });
      setEditingId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save service.");
    }
  }

  async function toggleActive(s: Service) {
    setError(null);
    try {
      await update.mutateAsync({ id: s.id, patch: { active: !s.active } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not toggle status.");
    }
  }

  async function handleDelete(s: Service) {
    setDeleting(null);
    setError(null);
    try {
      await remove.mutateAsync(s.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete service.");
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-on-surface-variant">
        Shared service catalogue. Any TAM can add services inline from a
        customer's or project's Services tab; curate names, descriptions, and
        availability here.
      </p>

      {error && (
        <div className="rounded-sm border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">
          {error}
        </div>
      )}

      <form
        onSubmit={handleAdd}
        className="flex flex-wrap items-end gap-2 rounded-sm border border-outline-variant bg-surface-container-lowest p-3"
      >
        <label className="w-full md:flex-1 md:min-w-[160px]">
          <span className="mb-1 block font-display text-label-caps uppercase text-on-surface-variant">
            Name
          </span>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={100}
            placeholder="e.g. Penetration Testing"
            className="w-full rounded-sm border border-outline-variant bg-surface px-2 py-1.5 text-sm focus:border-primary focus:outline-hidden"
          />
        </label>
        <label className="w-full md:flex-2 md:min-w-[240px]">
          <span className="mb-1 block font-display text-label-caps uppercase text-on-surface-variant">
            Description
          </span>
          <input
            type="text"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            maxLength={1000}
            placeholder="Short blurb shown in the catalogue"
            className="w-full rounded-sm border border-outline-variant bg-surface px-2 py-1.5 text-sm focus:border-primary focus:outline-hidden"
          />
        </label>
        <button
          type="submit"
          disabled={create.isPending || !newName.trim()}
          className="w-full rounded-sm bg-primary px-4 py-1.5 font-display text-xs font-bold text-on-primary hover:bg-primary-container disabled:opacity-60 md:w-auto"
        >
          {create.isPending ? "Adding…" : "Add service"}
        </button>
      </form>

      <DataGrid
        table={table}
        recordCount={rows.length}
        emptyMessage="No services yet — add the first one above."
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

      <ConfirmModal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && void handleDelete(deleting)}
        title="Delete service"
        body={`Delete service "${deleting?.name ?? ""}"? It will be removed from every customer and project that has it assigned.`}
        confirmLabel="Delete"
        confirmTone="danger"
        busy={remove.isPending}
      />
    </div>
  );
}
