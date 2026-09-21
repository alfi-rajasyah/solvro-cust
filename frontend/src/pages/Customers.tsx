import { useState } from "react";
import { Link } from "react-router-dom";
import { CustomerFormModal } from "@/components/CustomerFormModal";
import { EmptyState } from "@/components/EmptyState";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { Frame } from "@/components/reui/frame";
import { ApiError } from "@/lib/api";
import { hasPermission, useAuth } from "@/lib/auth";
import {
  type CustomerSummary,
  useCustomers,
  useDeleteCustomer,
} from "@/lib/queries";

export function Customers() {
  const { user } = useAuth();
  const { data: customers, isLoading, isError, error } = useCustomers();
  const deleteCustomer = useDeleteCustomer();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const canMutate = hasPermission(user, "project:write");
  const viewAll = hasPermission(user, "project:view-all");

  async function handleDelete(c: CustomerSummary) {
    if (!confirm(`Delete customer "${c.name}"? Linked projects keep their tasks but lose the customer link.`)) return;
    setDeleteError(null);
    try {
      await deleteCustomer.mutateAsync(c.id);
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "Delete failed.");
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
            className="inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 font-display text-label-caps uppercase tracking-wider text-on-primary transition-colors hover:bg-primary-container"
          >
            <span className="material-symbols-outlined text-base">add</span>
            New customer
          </button>
        )}
      </div>

      {deleteError && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{deleteError}</AlertDescription>
        </Alert>
      )}

      {isLoading && <SkeletonGrid />}

      {isError && (
        <Alert variant="destructive">
          <AlertDescription>Could not load customers: {(error as Error).message}</AlertDescription>
        </Alert>
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
                <span className="material-symbols-outlined text-base">add</span>
                Add your first customer
              </button>
            ) : null
          }
        />
      )}

      {customers && customers.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {customers.map((c) => (
            <CustomerCard
              key={c.id}
              customer={c}
              canMutate={canMutate}
              onEdit={() => setEditing(c)}
              onDelete={() => handleDelete(c)}
            />
          ))}
        </div>
      )}

      <CustomerFormModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <CustomerFormModal
        open={editing !== null}
        onClose={() => setEditing(null)}
        customer={editing}
      />
    </div>
  );
}

function CustomerCard({
  customer,
  canMutate,
  onEdit,
  onDelete,
}: {
  customer: CustomerSummary;
  canMutate: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const init = customer.name.slice(0, 2).toUpperCase();
  return (
    <Link to={`/customers/${customer.id}`} className="group flex flex-col">
      {/* SOLVRO PATCH (reui-data-grid.md Wave 3, rescoped) — card shell runs
          on the vendored Frame (reui/frame.tsx) instead of the hand-rolled
          bordered div, mirroring EmptyState.tsx's bare-Frame usage (no
          FramePanel — this card has no nested-panel structure, same
          reasoning as EmptyState). `grow` lets Frame fill the Link's
          grid-stretched height so the metric grid's `mt-auto` below still
          pushes the footer to the card's bottom edge, exactly as it did
          when Link itself was the flex-col container. `--frame-gap` is
          zeroed because the card's vertical rhythm is driven by each
          child's own `mb-3`/`mt-auto`/`mt-3`, not Frame's own gap; `--frame-px`/
          `--frame-py` reproduce the old `p-4`; `--frame-radius` reproduces
          `rounded-sm` (same override EmptyState uses). Border/bg colors and
          the hover state are plain utility classes that win over Frame's
          CSS-var defaults by Tailwind source order (see frame.tsx's
          FramePanel comment). */}
      <Frame className="grow [--frame-radius:var(--radius-sm)] [--frame-gap:0px] [--frame-px:--spacing(4)] [--frame-py:--spacing(4)] border-outline-variant bg-surface-container-lowest transition-colors hover:border-primary">
        <div className="mb-3 flex items-center gap-3">
          <div
            className="grid h-10 w-10 shrink-0 place-items-center rounded-sm font-display text-base font-bold text-white"
            style={{ background: avatarColor(customer.name) }}
          >
            {init}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-display text-sm font-bold leading-tight text-on-surface group-hover:text-primary">
              {customer.name}
            </h3>
            {customer.accountManager && (
              <p className="truncate text-[11px] text-on-surface-variant">
                AM: {customer.accountManager}
              </p>
            )}
            {customer.tam && (
              <p className="truncate text-[11px] text-on-surface-variant">
                TAM: {customer.tam.username}
              </p>
            )}
          </div>
        </div>

        {customer.description && (
          <p className="mb-3 line-clamp-2 text-[12px] leading-snug text-on-surface-variant">
            {customer.description}
          </p>
        )}

        {/* Metric grid */}
        <div className="mt-auto grid grid-cols-2 gap-y-1 text-[12px]">
          <span className="text-on-surface-variant">Projects</span>
          <span className="text-right font-mono tabular-nums">{customer._count.projects}</span>
          {customer.solutionArchitect && (
            <>
              <span className="text-on-surface-variant">SA lead</span>
              <span className="truncate text-right font-mono text-[11px]" title={customer.solutionArchitect}>
                {customer.solutionArchitect}
              </span>
            </>
          )}
        </div>

        {/* Actions */}
        <div className="mt-3 flex items-center justify-between border-t border-outline-variant pt-2">
          <Link
            to={`/projects?customerId=${customer.id}`}
            onClick={(e) => e.stopPropagation()}
            className="text-[11px] text-on-surface-variant hover:text-primary"
          >
            View projects →
          </Link>
          {canMutate && (
            <div
              className="flex items-center gap-1"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  onEdit();
                }}
                className="rounded-sm px-2 py-1 font-display text-label-caps uppercase tracking-wider text-on-surface-variant hover:bg-surface-container hover:text-primary"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  onDelete();
                }}
                className="rounded-sm px-2 py-1 font-display text-label-caps uppercase tracking-wider text-on-surface-variant hover:bg-error-container hover:text-on-error-container"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </Frame>
    </Link>
  );
}

const AVATAR_PALETTE = ["#0d9488", "#7c3aed", "#dc2626", "#0ea5e9", "#9333ea", "#a78bfa", "#f59e0b", "#10b981", "#0058be"];
function avatarColor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

function SkeletonGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="h-40 animate-pulse rounded-sm border border-outline-variant bg-surface-container-low"
        />
      ))}
    </div>
  );
}
