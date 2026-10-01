// "Synced <relative>" line + manual Refresh button for the Customer
// Tickets tab (Task 1.8). The actual re-fetch is handled by
// `useRequestItopRefresh`'s onSuccess (queries.ts) — this component just
// triggers the mutation; the invalidation-after-3s and the
// `useCustomerTickets` refetchInterval fallback both live there.
import { useState } from "react";
import { ApiError } from "@/lib/api";
import { fmtAgo } from "@/lib/formatDate";
import { useRequestItopRefresh } from "@/lib/queries";

export function SyncedAgo({
  customerId,
  syncedAt,
  lastSyncOk,
}: {
  customerId: number;
  syncedAt: string | null;
  lastSyncOk: boolean | null;
}) {
  const refresh = useRequestItopRefresh();
  const [error, setError] = useState<string | null>(null);

  async function handleRefresh() {
    setError(null);
    try {
      await refresh.mutateAsync({ customerId });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Refresh failed.");
    }
  }

  return (
    <div className="flex items-center gap-2 text-[12px] text-on-surface-variant">
      <span>{syncedAt ? `Synced ${fmtAgo(syncedAt)}` : "Not synced yet"}</span>
      {lastSyncOk === false && (
        // The raw iTop error text is admin-only (GET /itop/status doesn't
        // return `lastSyncError` to non-admins) — point at Admin › iTop
        // instead of surfacing anything from the API here.
        <span className="text-error" title="Ask an admin — details are on Admin › iTop">
          · Last sync failed
        </span>
      )}
      {error && <span className="text-error">· {error}</span>}
      <button
        type="button"
        onClick={() => void handleRefresh()}
        disabled={refresh.isPending}
        title="Refresh from iTop"
        aria-label="Refresh from iTop"
        className="inline-flex items-center justify-center rounded-sm p-1 text-on-surface-variant hover:bg-surface-container hover:text-on-surface disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        <span className="material-symbols-outlined text-[17px]">refresh</span>
      </button>
    </div>
  );
}
