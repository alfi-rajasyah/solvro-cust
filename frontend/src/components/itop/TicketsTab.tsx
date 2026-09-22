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
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/reui/alert";
import {
  useCustomerTickets,
  useItopStatus,
  type ItopTicketClass,
  type ItopTicketScope,
} from "@/lib/queries";
import { SyncedAgo } from "./SyncedAgo";
import { TicketFilters } from "./TicketFilters";
import { TicketsTable } from "./TicketsTable";

export function TicketsTab({ customerId }: { customerId: number }) {
  const [scope, setScope] = useState<ItopTicketScope>("ongoing");
  const [cls, setCls] = useState<ItopTicketClass | undefined>(undefined);

  const status = useItopStatus();
  const { data, isLoading, isError, error } = useCustomerTickets(customerId, {
    scope,
    cls,
    // The tab is actually open — poll for fresh data (see queries.ts's
    // useCustomerTickets for why the gate call in CustomerDetail.tsx does
    // NOT pass this).
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
        <TicketFilters
          counts={data.counts}
          scope={scope}
          cls={cls}
          onScopeChange={setScope}
          onClsChange={setCls}
        />
        <SyncedAgo
          customerId={customerId}
          syncedAt={data.syncedAt}
          lastSyncOk={status.data?.lastSyncOk ?? null}
        />
      </div>

      <TicketsTable tickets={data.tickets} baseUrl={status.data?.baseUrl ?? null} scope={scope} />

      <p className="text-[11px] text-on-surface-variant">
        Tickets belong to the customer&apos;s iTop organisation. Solvro shows them; it does not own
        them.
      </p>
    </div>
  );
}
