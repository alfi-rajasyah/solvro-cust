import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ProjectFormModal } from "@/components/ProjectFormModal";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { Chip, ProjectStatusChip } from "@/components/StatusChip";
import {
  createFilter,
  Filters,
  type Filter,
  type FilterFieldConfig,
} from "@/components/reui/filters";
import { useNewParam } from "@/hooks/useNewParam";
import { hasPermission, useAuth } from "@/lib/auth";
import { fmtRange } from "@/lib/formatDate";
import { type ProjectSummary, useCustomers, useProjects } from "@/lib/queries";

const CUSTOMER_FILTER_FIELD = "customerId";

export function Projects() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const customerIdParam = searchParams.get("customerId");
  const customerFilter = customerIdParam ? Number(customerIdParam) : undefined;

  // GET /customers needs project:read; without it the filter just stays empty.
  const { data: customers } = useCustomers(hasPermission(user, "project:read"));
  const { data: projects, isLoading, isError, error } = useProjects(
    customerFilter ? { customerId: customerFilter } : {},
  );
  const [createOpen, setCreateOpen] = useState(false);

  const canCreate = hasPermission(user, "project:write");
  useNewParam("1", canCreate, () => setCreateOpen(true));

  function setCustomerFilter(id: number | "") {
    const next = new URLSearchParams(searchParams);
    if (id === "") next.delete("customerId");
    else next.set("customerId", String(id));
    setSearchParams(next, { replace: true });
  }

  // Clean URL param if customer no longer exists.
  useEffect(() => {
    if (!customerFilter || !customers) return;
    if (!customers.some((c) => c.id === customerFilter)) {
      setCustomerFilter("");
    }
  }, [customerFilter, customers]);

  const activeCustomer = customers?.find((c) => c.id === customerFilter);

  // Single-field Filters config: "Customer" mapped onto the existing
  // ?customerId= URL contract. Only the affirmative "is" operator is
  // offered — the URL contract only ever expresses "filtered to this one
  // customer" or "no filter", so "is not"/"empty"/"not empty" (the other
  // defaults the vendored select-type field would otherwise expose) have no
  // corresponding URL state and are dropped to avoid a chip that can be set
  // into a meaningless combination.
  const customerFields: FilterFieldConfig<number>[] = useMemo(
    () => [
      {
        key: CUSTOMER_FILTER_FIELD,
        label: "Customer",
        type: "select",
        operators: [{ value: "is", label: "is" }],
        options: (customers ?? []).map((c) => ({ value: c.id, label: c.name })),
      },
    ],
    [customers],
  );

  // Filters state is derived FROM the URL param (not an independent
  // useState) so the param stays the single source of truth.
  const activeFilters: Filter<number>[] = useMemo(
    () =>
      customerFilter === undefined
        ? []
        : [createFilter<number>(CUSTOMER_FILTER_FIELD, "is", [customerFilter])],
    [customerFilter],
  );

  // Every chip interaction (add, change value, remove) funnels back through
  // the existing setCustomerFilter — same set/remove + { replace: true }
  // behavior as the plain <select> this replaces. Deliberately a plain
  // function (like setCustomerFilter above): it closes over the current
  // searchParams and must stay fresh each render.
  function handleCustomerFiltersChange(next: Filter<number>[]) {
    const entry = next.find((f) => f.field === CUSTOMER_FILTER_FIELD);
    const value = entry?.values[0];
    setCustomerFilter(value ?? "");
  }

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-on-surface">Projects</h1>
          <p className="text-sm text-on-surface-variant">
            {activeCustomer
              ? `Filtered by customer: ${activeCustomer.name}`
              : "All projects where you're the TAM, plus those for customers you own."}
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 font-display text-sm text-on-primary transition-colors hover:bg-primary-container font-semibold"
          >
            <span className="material-symbols-outlined text-base">add</span>
            New project
          </button>
        )}
      </div>

      {/* Filter row */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Filters
          filters={activeFilters}
          fields={customerFields}
          onChange={handleCustomerFiltersChange}
          size="sm"
          allowMultiple={false}
        />
        {projects && projects.length > 0 && (
          <span className="ml-auto font-mono text-[12px] text-on-surface-variant">
            {projects.length} {projects.length === 1 ? "project" : "projects"}
          </span>
        )}
      </div>

      {isLoading && <SkeletonGrid />}

      {isError && (
        <Alert variant="destructive">
          <AlertDescription>Could not load projects: {(error as Error).message}</AlertDescription>
        </Alert>
      )}

      {projects && projects.length === 0 && (
        <EmptyState onCreate={canCreate ? () => setCreateOpen(true) : undefined} />
      )}

      {projects && projects.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}

      <ProjectFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  );
}

function ProjectCard({ project }: { project: ProjectSummary }) {
  const tamInit = project.tam.username.slice(0, 2).toUpperCase();
  const idBadge = `P-${String(project.id).padStart(3, "0")}`;
  const health = project.health;
  const done = health?.progress.done ?? 0;
  const total = health?.progress.total ?? project._count.tasks;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const overdue = health?.overdueCount ?? 0;
  const openRisks = health?.openRiskCount ?? 0;
  const hasDates = health !== undefined && (health.startDate !== null || health.endDate !== null);

  return (
    <Link
      to={`/projects/${project.id}`}
      className="group flex flex-col rounded-sm border border-outline-variant bg-surface-container-lowest p-4 transition-colors hover:border-primary"
    >
      {/* ID + status row */}
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <span className="font-mono text-meta text-on-surface-variant">{idBadge}</span>
        <ProjectStatusChip status={project.status} />
      </div>

      {/* Title */}
      <h3 className="mb-1 truncate font-display text-sm font-bold leading-tight text-on-surface group-hover:text-primary">
        {project.name}
      </h3>

      {/* Description */}
      <p className="mb-3 line-clamp-2 min-h-[2.4rem] text-[12px] leading-snug text-on-surface-variant">
        {project.description ?? "No description."}
      </p>

      {/* Bottom row: customer + avatar stack + task count */}
      <div className="mt-auto flex items-center justify-between gap-2 text-meta text-on-surface-variant">
        <span className="min-w-0 flex-1 truncate">
          {project.customer?.name ?? <em className="opacity-70">No customer</em>}
        </span>
        <div className="flex -space-x-1.5">
          <span
            title={`TAM: ${project.tam.username}`}
            className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-surface-container-lowest bg-primary text-meta font-bold text-on-primary"
          >
            {tamInit}
          </span>
        </div>
      </div>

      {/* Progress + health footer */}
      <div className="mt-3 border-t border-outline-variant pt-2 text-meta text-on-surface-variant">
        {total > 0 ? (
          <div className="flex items-center gap-2">
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              aria-label="Project progress"
              className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-container-high"
            >
              <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
            <span className="shrink-0 whitespace-nowrap tabular-nums">
              {pct}% · {done} of {total}
            </span>
          </div>
        ) : (
          <span>No tasks yet</span>
        )}

        {(hasDates || overdue > 0 || openRisks > 0 || project.baselineLockedAt) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {overdue > 0 && <Chip tone="rose">{overdue} overdue</Chip>}
            {openRisks > 0 && (
              <Chip tone="amber">
                {openRisks} open {openRisks === 1 ? "risk" : "risks"}
              </Chip>
            )}
            {project.baselineLockedAt && (
              <span className="flex items-center gap-1" title="Baseline locked">
                <span className="material-symbols-outlined text-[14px] text-primary">bookmark</span>
                Baseline locked
              </span>
            )}
            {hasDates && (
              <span className="ml-auto whitespace-nowrap tabular-nums">
                {fmtRange(health.startDate, health.endDate)}
              </span>
            )}
          </div>
        )}
      </div>
    </Link>
  );
}

function EmptyState({ onCreate }: { onCreate?: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest p-12 text-center">
      <span className="material-symbols-outlined mb-2 text-4xl text-on-surface-variant">
        folder_open
      </span>
      <p className="mb-4 text-sm text-on-surface-variant">No projects yet.</p>
      {onCreate && (
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-display text-xs font-bold text-on-primary hover:bg-primary-container"
        >
          <span className="material-symbols-outlined text-base">add</span>
          Create your first project
        </button>
      )}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="h-40 animate-pulse rounded-xl bg-surface-container-low"
        />
      ))}
    </div>
  );
}
