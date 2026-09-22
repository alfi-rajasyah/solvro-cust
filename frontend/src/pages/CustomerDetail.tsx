import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { CustomerFormModal } from "@/components/CustomerFormModal";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { Badge } from "@/components/reui/badge";
import { DataGrid, DataGridContainer } from "@/components/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";
import { EmptyState } from "@/components/EmptyState";
import { TicketsTab } from "@/components/itop/TicketsTab";
import { ServiceMappingList } from "@/components/services/ServiceMappingList";
import { Chip, ProjectStatusChip } from "@/components/StatusChip";
import { Tabs } from "@/components/Tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import { hasPermission, useAuth } from "@/lib/auth";
import { dayFromIso } from "@/lib/dateField";
import { formatWeekRange, weekKeyOf } from "@/lib/isoWeek";
import {
  type CustomerDetail as CustomerDetailType,
  type ProjectStatus,
  type ProjectSummary,
  type WeeklyHealth,
  type WeeklyStatus,
  type WeeklyUpdate,
  useCustomer,
  useCustomerTickets,
  useCustomerWeeklyUpdates,
  useDeleteCustomer,
  useItopStatus,
  useUpdateCustomerServices,
} from "@/lib/queries";
import { personNameSortingFn } from "@/lib/tableSort";

type Tab = "overview" | "services" | "tickets" | "topology" | "documents" | "org";

export function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const customerId = id ? Number(id) : null;
  const navigate = useNavigate();
  const { user } = useAuth();
  const canMutate = hasPermission(user, "project:write");

  const { data: customer, isLoading, isError, error } = useCustomer(customerId);
  const deleteCustomer = useDeleteCustomer();
  const [editOpen, setEditOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // iTop Tickets tab gating (Task 1.8): the tab only exists when iTop is
  // configured AND this customer is mapped to an iTop organisation. GET
  // /customers/:id doesn't expose itopOrgId/itopOrgName (see routes/
  // customers.ts's select), so "mapped" is derived from the tickets
  // endpoint's own `mapped` flag instead of a second backend change — this
  // gate query (scope "ongoing") also doubles as the data the Tickets tab
  // itself first renders with, since react-query dedupes the identical key.
  // Both hooks below run unconditionally (hook-order rule); `enabled` does
  // the gating so a not-yet-loaded customerId or unconfigured iTop just
  // skips the fetch rather than skipping the hook call.
  const itopStatus = useItopStatus();
  const itopConfigured = itopStatus.data?.configured ?? false;
  const itopTicketsGate = useCustomerTickets(customerId ?? -1, {
    scope: "ongoing",
    enabled: itopConfigured && customerId !== null,
    // This gate call runs on every customer page load (not just while the
    // Tickets tab is open) — no background polling here. TicketsTab.tsx's
    // own call opts into polling once the tab is actually visible.
    poll: false,
  });
  const ticketsAvailable = itopConfigured && itopTicketsGate.data?.mapped === true;

  const TAB_ITEMS: ReadonlyArray<{ key: Tab; label: string }> = [
    { key: "overview", label: "Overview" },
    { key: "services", label: "Services" },
    ...(ticketsAvailable ? [{ key: "tickets" as const, label: "Tickets" }] : []),
    { key: "topology", label: "Topology" },
    { key: "org", label: "Organization Structure" },
    { key: "documents", label: "Documents" },
  ];

  const initialTab = (() => {
    const t = searchParams.get("tab");
    return TAB_ITEMS.some((x) => x.key === t) ? (t as Tab) : "overview";
  })();
  const [tab, setTab] = useState<Tab>(initialTab);

  // Honor ?tab= changes from external navigation (e.g. project sidebar
  // Documents link) — `ticketsAvailable` is in the dep list too, so a
  // `?tab=tickets` URL that arrived before the gate query resolved (tab
  // falls back to "overview" on that first render, see `initialTab` above)
  // is recovered once `ticketsAvailable` flips true, instead of staying
  // stuck on the fallback for the rest of the session.
  useEffect(() => {
    const t = searchParams.get("tab");
    if (t && TAB_ITEMS.some((x) => x.key === t) && t !== tab) {
      setTab(t as Tab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, ticketsAvailable]);

  function handleTabChange(next: Tab) {
    setTab(next);
    if (next === "overview") {
      searchParams.delete("tab");
    } else {
      searchParams.set("tab", next);
    }
    setSearchParams(searchParams, { replace: true });
  }

  if (isLoading) {
    return (
      <div className="m-6 h-64 animate-pulse rounded-sm border border-outline-variant bg-surface-container-low" />
    );
  }
  if (isError || !customer) {
    return (
      <Alert variant="destructive" className="m-6">
        <AlertDescription>
          Could not load customer{error ? `: ${(error as Error).message}` : "."}
        </AlertDescription>
      </Alert>
    );
  }

  async function handleDelete() {
    if (!customer) return;
    if (
      !confirm(
        `Delete customer "${customer.name}"? Linked projects keep their tasks but lose the customer link.`,
      )
    )
      return;
    setActionError(null);
    try {
      await deleteCustomer.mutateAsync(customer.id);
      navigate("/customers");
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Delete failed.");
    }
  }

  const avatarBg = avatarColor(customer.name);
  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/customers"
          className="inline-flex items-center gap-1 font-display text-[12px] font-bold uppercase tracking-wider text-on-surface-variant hover:text-primary"
        >
          <span className="material-symbols-outlined text-[17px]">chevron_left</span>
          Customers
        </Link>
        <div className="mt-2 grid gap-4 md:grid-cols-3">
          {/* Identity card */}
          <div className="rounded-sm border border-outline-variant bg-surface-container-lowest p-4 md:col-span-1">
            <div className="mb-3 flex items-center gap-3">
              <div
                className="grid h-12 w-12 shrink-0 place-items-center rounded-sm font-display text-lg font-bold text-white"
                style={{ background: avatarBg }}
              >
                {customer.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <h1 className="truncate font-display text-base font-bold text-on-surface">
                  {customer.name}
                </h1>
                <p className="text-[11px] uppercase tracking-wider text-on-surface-variant">
                  {customer._count.projects} project{customer._count.projects === 1 ? "" : "s"}
                </p>
              </div>
            </div>
            <div className="space-y-1 text-[12px] text-on-surface-variant">
              {customer.accountManager && (
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-base">person</span>
                  <span>AM: {customer.accountManager}</span>
                </div>
              )}
              {customer.solutionArchitect && (
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-base">engineering</span>
                  <span>SA: {customer.solutionArchitect}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-base">support_agent</span>
                <span>TAM: {customer.tam ? customer.tam.username : "—"}</span>
              </div>
              {ticketsAvailable && itopTicketsGate.data?.mapped && (
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-base">sync_alt</span>
                  <span>iTop org · {itopTicketsGate.data.orgName ?? "—"}</span>
                </div>
              )}
            </div>
            {canMutate && (
              <div className="mt-3 flex items-center gap-1 border-t border-outline-variant pt-2">
                <button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  className="inline-flex items-center gap-1 rounded-sm border border-outline-variant px-2.5 py-1 font-display text-label-caps uppercase tracking-wider text-on-surface hover:border-primary hover:text-primary"
                >
                  <span className="material-symbols-outlined text-base">edit</span>
                  Edit
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleteCustomer.isPending}
                  className="inline-flex items-center gap-1 rounded-sm border border-outline-variant px-2.5 py-1 font-display text-label-caps uppercase tracking-wider text-on-surface-variant hover:border-error hover:text-error disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-base">delete</span>
                  Delete
                </button>
              </div>
            )}
          </div>

          {/* KPI tiles */}
          <CustomerKpi
            label="Active projects"
            value={customer._count.projects}
            hint="Linked to this customer"
            icon="folder_open"
            tone="primary"
          />
          <CustomerKpi
            label="Services subscribed"
            value={customer.services.length}
            hint={
              customer.services.length === 0
                ? "None mapped yet"
                : `Across ${customer.services.reduce((acc, a) => acc + a.tools.length, 0)} tools`
            }
            icon="category"
            tone="emerald"
          />
        </div>

        {customer.description && (
          <p className="mt-3 max-w-3xl whitespace-pre-line wrap-break-word text-sm text-on-surface-variant">
            {customer.description}
          </p>
        )}
      </div>

      {actionError && (
        <Alert variant="destructive">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      <Tabs items={TAB_ITEMS} active={tab} onChange={handleTabChange} />

      <div>
        {tab === "overview" && (
          <OverviewTab
            customer={customer}
            canMutate={canMutate}
            onEdit={() => setEditOpen(true)}
          />
        )}
        {tab === "services" && (
          <ServicesTab customer={customer} canMutate={canMutate} />
        )}
        {tab === "tickets" && ticketsAvailable && <TicketsTab customerId={customer.id} />}
        {tab === "topology" && (
          <EmptyState
            icon="hub"
            title="Topology"
            message="Network topology view will live here once we wire it up."
          />
        )}
        {tab === "documents" && (
          <EmptyState
            icon="description"
            title="Documents"
            message="Document attachments will live here once uploads are implemented."
          />
        )}
        {tab === "org" && (
          <EmptyState
            icon="account_tree"
            title="Organization Structure"
            message="Customer org chart will live here once roles + reports are modelled."
          />
        )}
      </div>

      <CustomerFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        customer={customer}
      />
    </div>
  );
}

function OverviewTab({
  customer,
  canMutate,
  onEdit,
}: {
  customer: CustomerDetailType;
  canMutate: boolean;
  onEdit: () => void;
}) {
  return (
    <div className="space-y-6">
      <ProfileCompletionCard
        customer={customer}
        canMutate={canMutate}
        onEdit={onEdit}
      />

      <ResourceSection icon="category" title="Services">
        {customer.services.length === 0 ? (
          <p className="text-[13px] text-on-surface-variant">
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
                    <p className="text-[12px] text-on-surface-variant">
                      {a.service.description}
                    </p>
                  )}
                </div>
                <div className="flex max-w-[60%] shrink-0 flex-wrap justify-end gap-1">
                  {a.tools.length === 0 ? (
                    <span className="text-[12px] italic text-on-surface-variant">
                      No tools listed
                    </span>
                  ) : (
                    a.tools.map((t, i) => (
                      <span
                        key={`${t}-${i}`}
                        className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[12px] text-primary"
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
      </ResourceSection>

      <ResourceSection icon="hub" title="Topology" soon>
        <p className="text-[13px] text-on-surface-variant">
          No network topology configured. The Topology tab will host the diagram once
          this feature is built.
        </p>
      </ResourceSection>

      <ResourceSection icon="account_tree" title="Organization Structure" soon>
        <p className="text-[13px] text-on-surface-variant">
          Customer org chart not yet captured. The Organization Structure tab will show
          roles and reporting lines once the model is in place.
        </p>
      </ResourceSection>

      <ResourceSection icon="calendar_month" title="Weekly updates">
        <WeeklyUpdatesList customerId={customer.id} />
      </ResourceSection>

      <div>
        <h2 className="mb-2 font-display text-[13px] font-bold uppercase tracking-wider text-on-surface-variant">
          Projects
        </h2>
        {customer.projects.length === 0 ? (
          <EmptyState
            icon="assignment"
            title="No projects yet"
            message="When projects are linked to this customer, they'll appear here."
          />
        ) : (
          <ProjectsDataGrid projects={customer.projects} />
        )}
      </div>
    </div>
  );
}

const PROJECT_STATUSES: ProjectStatus[] = [
  "PLANNING",
  "ACTIVE",
  "ON_HOLD",
  "COMPLETED",
  "CANCELLED",
];

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
        id: "tam",
        accessorFn: (row) => row.tam.username,
        header: ({ column }) => <DataGridColumnHeader column={column} title="TAM" />,
        sortingFn: personNameSortingFn,
        cell: ({ row }) => (
          <span className="text-on-surface-variant">{row.original.tam.username}</span>
        ),
        meta: { skeleton: <Skeleton className="h-3.5 w-20" /> },
      },
      {
        id: "tasks",
        accessorFn: (row) => row._count.tasks,
        header: ({ column }) => <DataGridColumnHeader column={column} title="Tasks" />,
        cell: ({ row }) => (
          <span className="font-mono text-[13px] text-on-surface-variant">
            {row.original._count.tasks}
          </span>
        ),
        meta: {
          headerClassName: "text-right",
          cellClassName: "text-right",
          skeleton: <Skeleton className="ml-auto h-3.5 w-6" />,
        },
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

function CustomerKpi({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  icon: string;
  tone: "primary" | "emerald" | "amber" | "neutral";
}) {
  const iconColor =
    tone === "primary"
      ? "text-primary"
      : tone === "emerald"
        ? "text-emerald-600"
        : tone === "amber"
          ? "text-amber-600"
          : "text-on-surface-variant";
  return (
    <div className="rounded-sm border border-outline-variant bg-surface-container-lowest p-4">
      <div className="flex items-center justify-between">
        <span className="text-label-caps uppercase tracking-wider text-on-surface-variant">{label}</span>
        <span className={`material-symbols-outlined text-base ${iconColor}`}>{icon}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-mono text-3xl font-bold tabular-nums text-on-surface">{value}</span>
        {hint && <span className="text-[11px] text-on-surface-variant">{hint}</span>}
      </div>
    </div>
  );
}

const AVATAR_PALETTE = ["#0d9488", "#7c3aed", "#dc2626", "#0ea5e9", "#9333ea", "#a78bfa", "#f59e0b", "#10b981", "#0058be"];
function avatarColor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

function ResourceSection({
  icon,
  title,
  soon,
  children,
}: {
  icon: string;
  title: string;
  soon?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-sm border border-outline-variant bg-surface-container-lowest p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[21px] text-primary">
            {icon}
          </span>
          <h3 className="font-display text-[13px] font-bold uppercase tracking-wider text-on-surface">
            {title}
          </h3>
        </div>
        {soon && (
          <span className="rounded-sm bg-surface-container px-1.5 py-0.5 font-display text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
            Soon
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function WeeklyUpdatesList({ customerId }: { customerId: number }) {
  // Explicit 52 (the backend's max — a year of weeks): the hook's default of
  // 12 silently truncated this list to the last ~3 months (phase review
  // finding N8).
  const { data: updates, isLoading, isError, error } = useCustomerWeeklyUpdates(
    customerId,
    52,
  );

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-sm bg-surface-container-low"
          />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Could not load weekly updates{error ? `: ${(error as Error).message}` : "."}
        </AlertDescription>
      </Alert>
    );
  }

  if (!updates || updates.length === 0) {
    return <p className="text-[13px] text-on-surface-variant">No weekly updates yet.</p>;
  }

  return (
    <>
      <ul className="divide-y divide-outline-variant/60">
        {updates.map((update) => (
          <WeeklyUpdateRow key={update.id} update={update} />
        ))}
      </ul>
      {updates.length === 52 && (
        <p className="mt-2 text-[11px] text-on-surface-variant">
          Showing the last 52 weeks.
        </p>
      )}
    </>
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
          <span className="font-display text-[12px] font-bold uppercase tracking-wider text-on-surface">
            {weekKey}
          </span>
          <span className="text-[12px] text-on-surface-variant">
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
        <p className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
          Achievements · {update.achievements.length}
        </p>
        {update.achievements.length === 0 ? (
          <p className="text-[13px] text-on-surface-variant">No achievements.</p>
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
                  <p className="whitespace-pre-wrap wrap-break-word text-[13px] text-on-surface-variant">
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
            className="mt-2 text-[12px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            {midweekOpen ? "Hide mid-week" : "Show mid-week"}
          </button>

          {midweekOpen && (
            <div id={midweekFieldsId} className="mt-2 flex flex-col gap-2.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
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
                      <p className="whitespace-pre-wrap wrap-break-word text-[13px] text-on-surface-variant">
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

      <p className="mt-1.5 text-[11px] text-on-surface-variant">
        by {update.author.username} · updated{" "}
        {new Date(update.updatedAt).toLocaleDateString()}
        {update.doneAt && ` · done ${new Date(update.doneAt).toLocaleString()}`}
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
          "text-[11px] font-bold uppercase tracking-wider",
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
  if (health === "GREEN") return <Chip tone="emerald">Green</Chip>;
  if (health === "AMBER") return <Chip tone="amber">Amber</Chip>;
  if (health === "RED") return <Chip tone="rose">Red</Chip>;
  return <Chip tone="gray">No health</Chip>;
}

function statusBadge(status: WeeklyStatus) {
  if (status === "DONE") return <Badge variant="success-light">Done</Badge>;
  if (status === "DRAFT") return <Badge variant="warning-light">Draft</Badge>;
  return <Badge variant="outline">Not started</Badge>;
}

function ProfileCompletionCard({
  customer,
  canMutate,
  onEdit,
}: {
  customer: CustomerDetailType;
  canMutate: boolean;
  onEdit: () => void;
}) {
  const items: Array<{
    label: string;
    done: boolean;
    hint: string;
    actionLabel?: string;
    onAction?: () => void;
  }> = [
    {
      label: "Description",
      done: customer.description.trim().length > 0,
      hint: "A short summary of the customer's business and engagement.",
      actionLabel: "Edit",
      onAction: onEdit,
    },
    {
      label: "Account Manager",
      done: Boolean(customer.accountManager),
      hint: "Name the AM responsible for this customer relationship.",
      actionLabel: "Edit",
      onAction: onEdit,
    },
    {
      label: "Solution Architect",
      done: Boolean(customer.solutionArchitect),
      hint: "Name the SA who designs solutions for this customer.",
      actionLabel: "Edit",
      onAction: onEdit,
    },
    {
      label: "Services",
      done: customer.services.length > 0,
      hint: "Map at least one service from the catalogue to this customer.",
    },
    {
      label: "Projects",
      done: customer.projects.length > 0,
      hint: "Linked projects will appear in the Overview table.",
    },
  ];
  const doneCount = items.filter((i) => i.done).length;
  const total = items.length;
  const pct = Math.round((doneCount / total) * 100);

  if (doneCount === total) {
    return (
      <div className="rounded-sm border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        <span className="material-symbols-outlined mr-1 align-middle text-[19px]">
          check_circle
        </span>
        Profile complete — all sections filled in.
      </div>
    );
  }

  return (
    <div className="rounded-sm border border-outline-variant bg-surface-container-lowest p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-[13px] font-bold uppercase tracking-wider text-on-surface">
            Customer profile completion
          </h2>
          <p className="text-[12px] text-on-surface-variant">
            Fill these sections to give TAMs and stakeholders a complete picture.
          </p>
        </div>
        <span className="font-mono text-xs text-on-surface-variant">
          {doneCount}/{total} · {pct}%
        </span>
      </div>
      <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-container">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li
            key={item.label}
            className="flex items-center justify-between gap-3 rounded-sm px-2 py-1.5 hover:bg-surface-container-low"
          >
            <div className="flex min-w-0 items-start gap-2">
              <span
                className={[
                  "material-symbols-outlined mt-0.5 text-[19px]",
                  item.done ? "text-emerald-600" : "text-on-surface-variant",
                ].join(" ")}
              >
                {item.done ? "check_circle" : "radio_button_unchecked"}
              </span>
              <div className="min-w-0">
                <p
                  className={[
                    "text-sm font-medium",
                    item.done ? "text-on-surface-variant line-through" : "text-on-surface",
                  ].join(" ")}
                >
                  {item.label}
                </p>
                {!item.done && (
                  <p className="text-[12px] text-on-surface-variant">{item.hint}</p>
                )}
              </div>
            </div>
            {!item.done && canMutate && item.actionLabel && item.onAction && (
              <button
                type="button"
                onClick={item.onAction}
                className="shrink-0 rounded-sm border border-outline-variant px-2 py-1 font-display text-label-caps uppercase tracking-wider text-on-surface-variant hover:border-primary hover:text-primary"
              >
                {item.actionLabel}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ServicesTab({
  customer,
  canMutate,
}: {
  customer: CustomerDetailType;
  canMutate: boolean;
}) {
  const update = useUpdateCustomerServices(customer.id);

  return (
    <ServiceMappingList
      assignments={customer.services}
      onSave={(assignments) => update.mutateAsync(assignments)}
      canMutate={canMutate}
      saving={update.isPending}
      title="Service Catalogue Mapping"
      description={
        'Select the services this customer subscribes to and list the tools used for each — e.g. "Backup & Restore" → Acronis, Veeam.'
      }
    />
  );
}
