import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AccountHeader, sumProjectHealth } from "@/components/customer/AccountHeader";
import { AccountOverview } from "@/components/customer/AccountOverview";
import { ConfirmModal } from "@/components/ConfirmModal";
import { CustomerFormModal } from "@/components/CustomerFormModal";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { TicketPanel } from "@/components/itop/TicketPanel";
import { TicketsTab, type TicketsTabView } from "@/components/itop/TicketsTab";
import { OutlineDocsTab } from "@/components/outline/OutlineDocsTab";
import { ServiceMappingList } from "@/components/services/ServiceMappingList";
import { Tabs } from "@/components/Tabs";
import { ApiError } from "@/lib/api";
import { hasPermission, useAuth } from "@/lib/auth";
import { canChangeCustomerOwner, canOwnCustomer, saveErrorMessage } from "@/lib/ownerAccess";
import {
  type CustomerDetail as CustomerDetailType,
  useCustomer,
  useCustomerTickets,
  useCustomerWeeklyUpdates,
  useDeleteCustomer,
  useItopStatus,
  useOutlineConfig,
  useUpdateCustomerServices,
} from "@/lib/queries";

type Tab = "overview" | "services" | "tickets" | "docs";


export function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const customerId = id ? Number(id) : null;
  const navigate = useNavigate();
  const { user } = useAuth();
  const canMutate = hasPermission(user, "project:write");
  const { data: outlineConfig } = useOutlineConfig();

  const { data: customer, isLoading, isError, error } = useCustomer(customerId);
  const deleteCustomer = useDeleteCustomer();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
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
  // The tickets endpoints require `project:read` (403 otherwise), so a user
  // without it never fires the gate query and never sees the tab.
  const canReadTickets = hasPermission(user, "project:read");
  const itopTicketsGate = useCustomerTickets(customerId ?? -1, {
    scope: "ongoing",
    enabled: itopConfigured && canReadTickets && customerId !== null,
    // This gate call runs on every customer page load (not just while the
    // Tickets tab is open) — no background polling here. TicketsTab.tsx's
    // own call opts into polling once the tab is actually visible.
    poll: false,
  });
  const ticketsAvailable = itopConfigured && canReadTickets && itopTicketsGate.data?.mapped === true;

  // Latest weekly update for the header's health line; AccountOverview reads
  // the same key (limit 1) until the reader expands the history.
  const latestUpdate = useCustomerWeeklyUpdates(customerId, 1);

  const TAB_ITEMS: ReadonlyArray<{ key: Tab; label: string }> = [
    { key: "overview", label: "Overview" },
    { key: "services", label: "Services" },
    ...(ticketsAvailable ? [{ key: "tickets" as const, label: "Tickets" }] : []),
    // Outline pages under the customer's link; only offered once an Outline address is set.
    ...(outlineConfig?.baseUrl ? [{ key: "docs" as const, label: "Docs" }] : []),
  ];

  const initialTab = (() => {
    const t = searchParams.get("tab");
    return TAB_ITEMS.some((x) => x.key === t) ? (t as Tab) : "overview";
  })();
  const [tab, setTab] = useState<Tab>(initialTab);

  // Honor ?tab= changes from external navigation — `ticketsAvailable` is in the dep list too, so a
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
  }, [searchParams, ticketsAvailable, outlineConfig?.baseUrl]);

  function handleTabChange(next: Tab) {
    setTab(next);
    if (next === "overview") {
      searchParams.delete("tab");
    } else {
      searchParams.set("tab", next);
    }
    setSearchParams(searchParams, { replace: true });
  }

  // Ticket panel is deep-linked via `?ticket=<id>` alongside `?tab=` (Task
  // 5.4, docs/archive/plans/itop-integration.md) — same functional-updater
  // pattern ProjectDetail.tsx uses for its own `?task=<id>` TaskPanel, which
  // avoids the shared-URLSearchParams-object race TicketsTab.tsx's own file
  // header warns about for its local scope/class state (that race is about
  // two components mutating the same object; the functional updater form
  // sidesteps it by always working off the latest params, not a captured one).
  // `replace: true` (fix round, phase review) matches ProjectDetail.tsx's own
  // `?task=` handling — opening/closing/re-targeting the panel is browsing
  // within the same tab, not a distinct navigation the Back button should
  // have to unwind one entry at a time.
  const ticketParam = searchParams.get("ticket");
  const parsedTicketId = ticketParam ? Number(ticketParam) : NaN;
  const openTicketId = Number.isInteger(parsedTicketId) && parsedTicketId > 0 ? parsedTicketId : null;

  function openTicketPanel(id: number) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("ticket", String(id));
        return next;
      },
      { replace: true },
    );
  }

  function closeTicketPanel() {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("ticket");
        return next;
      },
      { replace: true },
    );
  }

  // Board view (Task 6.1, docs/archive/plans/itop-integration.md): `?view=`
  // is a sibling of `?tab=`/`?ticket=` (the spec mockup's own URL is
  // `?tab=tickets&view=board`), so it lives here rather than as TicketsTab's
  // local scope/class state — same functional-updater form as
  // openTicketPanel/closeTicketPanel above, which is race-safe against a
  // concurrent `?tab=`/`?ticket=` write because it always reads the latest
  // committed params rather than a captured snapshot.
  const view: TicketsTabView = searchParams.get("view") === "board" ? "board" : "table";

  function handleViewChange(next: TicketsTabView) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === "table") params.delete("view");
        else params.set("view", next);
        return params;
      },
      { replace: true },
    );
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
          {error instanceof ApiError && error.status === 404
            ? "This customer doesn't exist or isn't shared with you."
            : `Could not load customer${error ? `: ${(error as Error).message}` : "."}`}
        </AlertDescription>
      </Alert>
    );
  }

  // Members reaching this customer through a project can edit its profile but
  // not delete it (server: 403 owner_only); only the owner, view-all, or
  // anyone on an unowned customer can change its owner.
  const canOwn = canOwnCustomer(
    user,
    customer,
    customer.projects.map((p) => p.tamId),
  );
  const canChangeOwner = canChangeCustomerOwner(customer);

  async function handleDelete() {
    if (!customer) return;
    setConfirmDeleteOpen(false);
    setActionError(null);
    try {
      await deleteCustomer.mutateAsync(customer.id);
      navigate("/customers");
    } catch (err) {
      setActionError(saveErrorMessage(err, "Delete failed."));
    }
  }

  const totals = sumProjectHealth(customer.projects);
  const itopOrgName =
    ticketsAvailable && itopTicketsGate.data?.mapped ? (itopTicketsGate.data.orgName ?? "—") : null;

  return (
    <div className="space-y-6">
      <AccountHeader
        customer={customer}
        itopOrgName={itopOrgName}
        totals={totals}
        lastUpdate={latestUpdate.data?.[0] ?? null}
        updatesLoaded={!latestUpdate.isLoading}
        canMutate={canMutate}
        canDelete={canOwn}
        onEdit={() => setEditOpen(true)}
        onDelete={() => setConfirmDeleteOpen(true)}
        deleting={deleteCustomer.isPending}
      />

      {actionError && (
        <Alert variant="destructive">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      <Tabs items={TAB_ITEMS} active={tab} onChange={handleTabChange} />

      <div>
        {tab === "overview" && (
          <AccountOverview
            customer={customer}
            canMutate={canMutate}
            onEdit={() => setEditOpen(true)}
          />
        )}
        {tab === "services" && <ServicesTab customer={customer} canMutate={canMutate} />}
        {tab === "docs" && (
          <OutlineDocsTab
            scope="customers"
            id={customer.id}
            outlineUrl={customer.outlineUrl}
            canWrite={canMutate}
          />
        )}
        {tab === "tickets" && ticketsAvailable && (
          <TicketsTab
            customerId={customer.id}
            view={view}
            onViewChange={handleViewChange}
            onOpenTicket={openTicketPanel}
          />
        )}
      </div>

      <CustomerFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        customer={customer}
        canChangeOwner={canChangeOwner}
      />

      <ConfirmModal
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={() => void handleDelete()}
        title="Delete customer"
        body={`Delete customer "${customer.name}"? Linked projects keep their tasks but lose the customer link.`}
        confirmLabel="Delete"
        confirmTone="danger"
        busy={deleteCustomer.isPending}
      />

      {tab === "tickets" && ticketsAvailable && openTicketId !== null && (
        <TicketPanel
          customerId={customer.id}
          ticketId={openTicketId}
          onClose={closeTicketPanel}
        />
      )}
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
