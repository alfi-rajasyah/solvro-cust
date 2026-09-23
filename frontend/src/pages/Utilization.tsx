import { useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { EmptyState } from "@/components/EmptyState";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { UtilizationTable } from "@/components/utilization/UtilizationTable";
import { UtilizationTiles } from "@/components/utilization/UtilizationTiles";
import { ApiError } from "@/lib/api";
import { hasPermission, useAuth } from "@/lib/auth";
import { weekNumberLabel } from "@/lib/dailyReviewStats";
import { dateToDay } from "@/lib/dateField";
import { formatWeekRange, parseWeekKey, shiftWeek, weekKeyOf } from "@/lib/isoWeek";
import { type UtilizationScope, useRequestItopRefresh, useUtilization } from "@/lib/queries";

const SCOPE_TABS: { scope: UtilizationScope; label: string }[] = [
  { scope: "me", label: "Me" },
  { scope: "tam", label: "By TAM" },
  { scope: "customer", label: "By customer" },
];

function currentWeek(): string {
  return weekKeyOf(dateToDay(new Date())!);
}

function formatSyncedAt(iso: string | null): string {
  if (!iso) return "Not synced yet";
  return `Synced ${new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

// Utilization (Task 3.3, docs/archive/plans/itop-integration.md — "Work Logs
// becomes Utilization" in docs/archive/plans/itop-integration-spec.md): hours
// per TAM per customer for an ISO week, sourced from iTop's Time Tracking
// extension. `?week=`/`?scope=` in the URL mirror WeeklySync.tsx's own
// `?week=`/`?tab=` pattern — missing/invalid values resolve to a default for
// rendering, and the URL is normalized (replace, no spurious history entry)
// to match. `scope` additionally clamps to "me" for a caller without
// `report:executive` even if the URL asks for `tam`/`customer` — the backend
// would 403 those, but the tabs themselves aren't rendered for that user
// either, so a clamp (not an error state) is the right degrade for a stale
// bookmarked link.
//
// `authResolved` gates that clamp: AuthGuard only waits for `status !==
// "loading"`, and `status` flips to "authenticated" as soon as a token
// exists — before `/auth/me` has confirmed the user's actual permissions
// (auth.tsx's rehydrate effect), and even before a freshly-logged-in
// session's `user` has been flushed to localStorage for a subsequent full
// navigation to read back. In that gap `user` is still null, so
// `hasPermission(null, …)` reads false for everyone. Without this gate, a
// direct deep link like `/utilization?scope=customer` from an executive
// would get permanently clamped to `?scope=me` (via the `replace` below)
// before the real permission was known. Instead: don't clamp, don't rewrite
// the URL, and don't fire the query until `user` is actually loaded — the
// skeleton renders in that gap.
export function Utilization() {
  const { user } = useAuth();
  const authResolved = user != null;
  const canSeeOtherScopes = authResolved && hasPermission(user, "report:executive");
  const isAdmin = authResolved && hasPermission(user, "*");
  const [searchParams, setSearchParams] = useSearchParams();

  const weekParam = searchParams.get("week");
  const week = weekParam && parseWeekKey(weekParam) ? weekParam : currentWeek();

  const scopeParam = searchParams.get("scope");
  const requestedScope: UtilizationScope =
    scopeParam === "tam" || scopeParam === "customer" ? scopeParam : "me";
  const scope: UtilizationScope =
    !authResolved || requestedScope === "me" || canSeeOtherScopes ? requestedScope : "me";

  useEffect(() => {
    // Auth not resolved yet — the `scope` above is still just an unclamped
    // echo of the URL, not a real decision. Don't write it back.
    if (!authResolved) return;
    const next = new URLSearchParams(searchParams);
    let changed = false;
    if (weekParam !== week) {
      next.set("week", week);
      changed = true;
    }
    if (scopeParam !== scope) {
      next.set("scope", scope);
      changed = true;
    }
    if (changed) setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authResolved, week, scope, weekParam, scopeParam]);

  const { data, isLoading, isError, error } = useUtilization(week, scope, { enabled: authResolved });
  const refresh = useRequestItopRefresh();

  function goToWeek(next: string) {
    const params = new URLSearchParams(searchParams);
    params.set("week", next);
    setSearchParams(params);
  }

  function goToScope(next: UtilizationScope) {
    const params = new URLSearchParams(searchParams);
    params.set("scope", next);
    setSearchParams(params);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-on-surface">Utilization</h1>
          <p className="text-sm text-on-surface-variant">
            Hours per customer per day, from iTop's Time Tracking extension.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => goToWeek(shiftWeek(week, -1))}
            aria-label="Previous week"
            className="flex h-8 w-8 items-center justify-center rounded-sm border border-outline-variant text-on-surface-variant hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <span className="material-symbols-outlined text-lg">chevron_left</span>
          </button>
          <div className="text-center">
            <div className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              Week {weekNumberLabel(week)}
            </div>
            <div className="font-mono text-xs tabular-nums text-on-surface">{formatWeekRange(week)}</div>
          </div>
          <button
            type="button"
            onClick={() => goToWeek(shiftWeek(week, 1))}
            aria-label="Next week"
            className="flex h-8 w-8 items-center justify-center rounded-sm border border-outline-variant text-on-surface-variant hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <span className="material-symbols-outlined text-lg">chevron_right</span>
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-6 border-b border-outline-variant" aria-label="Utilization scope">
          {SCOPE_TABS.filter((t) => t.scope === "me" || canSeeOtherScopes).map((t) => (
            <button
              key={t.scope}
              type="button"
              data-testid={`utilization-tab-${t.scope}`}
              onClick={() => goToScope(t.scope)}
              className={[
                "-mb-px border-b-2 px-1 pb-3 font-display text-sm transition-colors",
                scope === t.scope
                  ? "border-primary text-primary"
                  : "border-transparent text-on-surface-variant hover:text-on-surface",
              ].join(" ")}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2 text-[12px] text-on-surface-variant">
          <span>Source · iTop Time Tracking</span>
          <span>· {formatSyncedAt(data?.syncedAt ?? null)}</span>
          <button
            type="button"
            onClick={() => refresh.mutate({})}
            disabled={refresh.isPending}
            title="Refresh from iTop"
            aria-label="Refresh from iTop"
            className="inline-flex items-center justify-center rounded-sm p-1 text-on-surface-variant hover:bg-surface-container hover:text-on-surface disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <span className="material-symbols-outlined text-[17px]">refresh</span>
          </button>
        </div>
      </div>

      {(!authResolved || isLoading) && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-sm" />
          ))}
        </div>
      )}

      {authResolved && isError && (
        <Alert variant="destructive">
          <AlertDescription>
            Could not load utilization{error instanceof ApiError ? `: ${error.message}` : "."}
          </AlertDescription>
        </Alert>
      )}

      {data && !data.configured && (
        <EmptyState
          icon="link_off"
          title="iTop is not connected"
          message={
            isAdmin ? (
              <>
                An admin connects it under Admin › iTop —{" "}
                <Link to="/admin" className="text-primary hover:underline">
                  go to Admin
                </Link>
                .
              </>
            ) : (
              "An admin connects it under Admin › iTop."
            )
          }
        />
      )}

      {data && data.configured && (
        <>
          <UtilizationTiles tiles={data.tiles} scope={scope} />
          <UtilizationTable data={data} scope={scope} />
          <p className="text-[13px] text-on-surface-variant">
            Hours come from iTop TimeSpent entries. To change a number, edit the entry in iTop.
          </p>
        </>
      )}
    </div>
  );
}
