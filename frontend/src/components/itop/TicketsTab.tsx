// Customer detail page's "Tickets" tab (Task 1.8): composes the filter
// chips, the ticket list, and the synced/refresh row. Rendered by
// CustomerDetail.tsx only once the customer is known to be iTop-configured
// and mapped (see that file's `ticketsAvailable` gate) — this component
// itself only handles the "mapped but the visibility gate raced ahead of
// this fetch" and error edges, not the "not configured" case.
//
// URL-state decision: scope/class stay in local component state, NOT the
// URL. CustomerDetail.tsx already owns `?tab=` via its own `useSearchParams`
// call; wiring `?scope=`/`&class=` here would mean two components mutating
// the same shared `URLSearchParams` object independently (CustomerDetail's
// tab-change handler mutates-then-replaces the same params object each
// render), which risks one write clobbering the other's concurrent change.
// Local state avoids that race entirely — cheap since scope/class are only
// ever set by clicking the chips right below.
//
// `view` (Task 6.1, docs/archive/plans/itop-integration.md) is the ONE
// exception: it's owned by CustomerDetail.tsx and passed down as a
// prop/callback, not local state here — the spec's mockup URL is literally
// `?tab=tickets&view=board`, a sibling of `?tab=`/`?ticket=`, both of which
// already live in CustomerDetail via the safe functional-updater form of
// `setSearchParams` (unlike `handleTabChange`'s own direct-mutate form, the
// functional form reads the latest committed params on each call, so it
// doesn't hit the same-object race scope/class avoid by staying local).
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/reui/alert";
import {
  useCustomerTickets,
  useItopStatus,
  useMyItopToken,
  type ItopTicketClass,
  type ItopTicketScope,
} from "@/lib/queries";
import { NewTicketSheet } from "./NewTicketSheet";
import { SyncedAgo } from "./SyncedAgo";
import { TicketBoard } from "./board/TicketBoard";
import { pillClass, TicketFilters } from "./TicketFilters";
import { TicketsTable } from "./TicketsTable";

export type TicketsTabView = "table" | "board";

export function TicketsTab({
  customerId,
  view,
  onViewChange,
  onOpenTicket,
}: {
  customerId: number;
  view: TicketsTabView;
  onViewChange: (view: TicketsTabView) => void;
  /** Deep-links `?ticket=<id>` on the customer page (CustomerDetail.tsx owns
   * `searchParams`, Task 5.4) — this component just forwards row/card clicks. */
  onOpenTicket: (id: number) => void;
}) {
  const [scope, setScope] = useState<ItopTicketScope>("ongoing");
  const [cls, setCls] = useState<ItopTicketClass | undefined>(undefined);
  const [newTicketOpen, setNewTicketOpen] = useState(false);

  const status = useItopStatus();
  const myToken = useMyItopToken();
  const canCreateTicket = (status.data?.actionsEnabled ?? false) && (myToken.data?.set ?? false);

  const { data, isLoading, isError, error } = useCustomerTickets(customerId, {
    scope,
    cls,
    // The tab is actually open — poll for fresh data (see queries.ts's
    // useCustomerTickets for why the gate call in CustomerDetail.tsx does
    // NOT pass this). Board mode fetches its own scopes directly
    // (TicketBoard.tsx) — this call still backs the Table view and the
    // filter chip counts either way.
    poll: true,
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-sm bg-surface-container-low" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Could not load tickets{error ? `: ${(error as Error).message}` : "."}
        </AlertDescription>
      </Alert>
    );
  }

  if (!data.mapped) {
    // CustomerDetail.tsx gates the tab itself on `mapped`, so this only
    // shows if that gate's own snapshot goes stale mid-session (e.g. an
    // admin unmaps the org while this tab is open).
    return (
      <Alert variant="destructive">
        <AlertDescription>
          This customer is no longer mapped to an iTop organisation.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <TicketFilters
            counts={data.counts}
            scope={scope}
            cls={cls}
            onScopeChange={setScope}
            onClsChange={setCls}
            showScope={view === "table"}
          />
          <ViewSwitch view={view} onChange={onViewChange} />
        </div>
        <div className="flex items-center gap-3">
          {canCreateTicket && (
            <button
              type="button"
              onClick={() => setNewTicketOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 font-display text-[12px] font-bold text-on-primary hover:bg-primary/90"
            >
              <span className="material-symbols-outlined text-base">add</span>
              New ticket
            </button>
          )}
          <SyncedAgo
            customerId={customerId}
            syncedAt={data.syncedAt}
            lastSyncOk={status.data?.lastSyncOk ?? null}
          />
        </div>
      </div>

      {view === "table" ? (
        <TicketsTable
          tickets={data.tickets}
          baseUrl={status.data?.baseUrl ?? null}
          scope={scope}
          onOpen={(t) => onOpenTicket(t.id)}
        />
      ) : (
        <TicketBoard customerId={customerId} cls={cls} onOpenTicket={onOpenTicket} />
      )}

      <p className="text-xs text-on-surface-variant">
        Tickets belong to the customer&apos;s iTop organisation. Solvro shows them; it does not own
        them.
      </p>

      {newTicketOpen && (
        <NewTicketSheet
          open
          onClose={() => setNewTicketOpen(false)}
          customerId={customerId}
          onCreated={(ticket) => onOpenTicket(ticket.id)}
        />
      )}
    </div>
  );
}

// Table | Board segmented switch (Task 6.1) — reuses `TicketFilters.tsx`'s
// exported `pillClass` (fix round, phase review item 5) instead of a
// duplicated copy of the same class string.
function ViewSwitch({
  view,
  onChange,
}: {
  view: TicketsTabView;
  onChange: (view: TicketsTabView) => void;
}) {
  function pill(target: TicketsTabView, label: string) {
    const active = view === target;
    return (
      <button
        type="button"
        aria-pressed={active}
        onClick={() => onChange(target)}
        className={pillClass(active)}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Ticket view">
      {pill("table", "Table")}
      {pill("board", "Board")}
    </div>
  );
}
