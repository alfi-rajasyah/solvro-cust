import { useEffect } from "react";
import { Link, useSearchParams } from "react-router";
import { EmptyState } from "@/components/EmptyState";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { TableSkeleton } from "@/components/skeletons";
import { UtilizationTable } from "@/components/utilization/UtilizationTable";
import { UtilizationTiles } from "@/components/utilization/UtilizationTiles";
import { WorkloadTab } from "@/components/utilization/WorkloadTab";
import { ApiError } from "@/lib/api";
import { hasPermission, useAuth } from "@/lib/auth";
import { weekNumberLabel } from "@/lib/dailyReviewStats";
import { dateToDay } from "@/lib/dateField";
import { fmtTime } from "@/lib/formatDate";
import { formatWeekRange, parseWeekKey, shiftWeek, weekKeyOf } from "@/lib/isoWeek";
import { type UtilizationScope, useItopStatus, useRequestItopRefresh, useUtilization } from "@/lib/queries";

// "workload" is the Solvro-task tab (components/utilization/WorkloadTab.tsx);
// the others are the iTop hours scopes.
type PageTab = UtilizationScope | "workload";

const SCOPE_TABS: { scope: PageTab; label: string }[] = [
  { scope: "me", label: "Me" },
  { scope: "tam", label: "By TAM" },
  { scope: "customer", label: "By customer" },
  { scope: "workload", label: "Workload" },
];

function currentWeek(): string {
  return weekKeyOf(dateToDay(new Date())!);
}

function formatSyncedAt(iso: string | null): string {
  if (!iso) return "Not synced yet";
  return `Synced ${fmtTime(iso)}`;
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
// (auth.tsx's rehydrate effect). In that gap `user` is only the
// localStorage copy, which can be missing (null) or stale (permissions
// changed since). Without this gate, a direct deep link like
// `/utilization?scope=customer` from an executive whose cached copy lacks
// `report:executive` would get permanently clamped to `?scope=me` (via the
// `replace` below) before the real permission was known. So auth counts as
// resolved only once `useAuth().userVerified` is true — or earlier, when the
// cached user already allows the requested scope (no clamp can happen, so
// there is nothing to wait for). Until then: don't clamp, don't rewrite the
// URL, and don't fire the query — the skeleton renders in that gap.
//
// Workload (docs/archive/plans/workload-tab.md) works without iTop and is open
// to everyone who reaches the page (the server decides whose rows they see).
// The page learns whether iTop is connected from `useItopStatus`; without it
// the iTop tabs and the Refresh strip are not rendered and Workload is the
// only tab, and also the default one when `?scope=` is absent. Once iTop is
// known to be connected the default stays `me`.
export function Utilization() {
  const { user, userVerified } = useAuth();
  const itopStatus = useItopStatus();
  const itopKnown = !itopStatus.isLoading;
  const itopConfigured = itopStatus.data?.configured === true;
  const [searchParams, setSearchParams] = useSearchParams();

  const weekParam = searchParams.get("week");
  const week = weekParam && parseWeekKey(weekParam) ? weekParam : currentWeek();

  const scopeParam = searchParams.get("scope");
  const requestedScope: PageTab =
    scopeParam === "tam" || scopeParam === "customer" || scopeParam === "me" || scopeParam === "workload"
      ? scopeParam
      : itopConfigured
        ? "me"
        : "workload";
  const restricted = requestedScope === "tam" || requestedScope === "customer";

  const authResolved =
    user != null && (userVerified || !restricted || hasPermission(user, "report:executive"));
  const canSeeOtherScopes = authResolved && hasPermission(user, "report:executive");
  const isAdmin = authResolved && hasPermission(user, "*");
  // Nothing is decided (clamped, written to the URL, fetched) until both the
  // viewer's permissions and iTop's connection are known.
  const ready = authResolved && itopKnown;
  const scope: PageTab = !ready
    ? requestedScope
    : !itopConfigured
      ? "workload"
      : restricted && !canSeeOtherScopes
        ? "me"
        : requestedScope;
  const hoursScope: UtilizationScope = scope === "workload" ? "me" : scope;
  const hoursEnabled = ready && itopConfigured && scope !== "workload";

  useEffect(() => {
    // Auth or iTop status not resolved yet — the `scope` above is still just
    // an unclamped echo of the URL, not a real decision. Don't write it back.
    if (!ready) return;
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
  }, [ready, week, scope, weekParam, scopeParam]);

  const { data, isLoading, isError, error } = useUtilization(week, hoursScope, { enabled: hoursEnabled });
  const refresh = useRequestItopRefresh();

  function goToWeek(next: string) {
    const params = new URLSearchParams(searchParams);
    params.set("week", next);
    setSearchParams(params);
  }

  function goToScope(next: PageTab) {
    const params = new URLSearchParams(searchParams);
    params.set("scope", next);
    setSearchParams(params);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-h1 text-on-surface">Utilization</h1>
          <p className="text-sm text-on-surface-variant">
            {scope === "workload"
              ? "Open tasks per person, from Solvro."
              : "Hours per customer per day, from iTop's Time Tracking extension."}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => goToWeek(shiftWeek(week, -1))}
            aria-label="Previous week"
            className="tap-target flex h-8 w-8 items-center justify-center rounded-sm border border-outline-variant text-on-surface-variant hover:bg-surface-container focus-visible:outline-hidden focus-visible:ring-2 focus-visible:border-primary focus-visible:ring-primary/30"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-lg">chevron_left</span>
          </button>
          <div className="text-center">
            <div className="text-label-caps uppercase text-on-surface-variant">
              Week {weekNumberLabel(week)}
            </div>
            <div className="text-xs tabular-nums text-on-surface">{formatWeekRange(week)}</div>
          </div>
          <button
            type="button"
            onClick={() => goToWeek(shiftWeek(week, 1))}
            aria-label="Next week"
            className="tap-target flex h-8 w-8 items-center justify-center rounded-sm border border-outline-variant text-on-surface-variant hover:bg-surface-container focus-visible:outline-hidden focus-visible:ring-2 focus-visible:border-primary focus-visible:ring-primary/30"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-lg">chevron_right</span>
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-4 border-b border-outline-variant md:gap-6" aria-label="Utilization scope">
          {SCOPE_TABS.filter((t) =>
            t.scope === "workload"
              ? true
              : itopConfigured && (t.scope === "me" || canSeeOtherScopes),
          ).map((t) => (
            <button
              key={t.scope}
              type="button"
              data-testid={`utilization-tab-${t.scope}`}
              onClick={() => goToScope(t.scope)}
              className={[
                "tap-target -mb-px border-b-2 px-1 pb-3 font-display text-sm transition-colors",
                scope === t.scope
                  ? "border-primary text-primary"
                  : "border-transparent text-on-surface-variant hover:text-on-surface",
              ].join(" ")}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {scope !== "workload" && (
          <div className="flex items-center gap-2 text-meta text-on-surface-variant">
            <span>Source · iTop Time Tracking</span>
            <span>· {formatSyncedAt(data?.syncedAt ?? null)}</span>
            <button
              type="button"
              onClick={() => refresh.mutate({})}
              disabled={refresh.isPending}
              title="Refresh from iTop"
              aria-label="Refresh from iTop"
              className="tap-target inline-flex items-center justify-center rounded-sm p-1 text-on-surface-variant hover:bg-surface-container hover:text-on-surface disabled:opacity-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[17px]">refresh</span>
            </button>
          </div>
        )}
      </div>

      {scope !== "workload" && refresh.isError && (
        <Alert variant="destructive" data-testid="utilization-refresh-error">
          <AlertDescription>
            {refresh.error instanceof ApiError
              ? refresh.error.message
              : "Could not reach the server to refresh. Check your connection and try again."}
          </AlertDescription>
        </Alert>
      )}

      {scope === "workload" && ready && <WorkloadTab week={week} />}

      {(!ready || (scope !== "workload" && isLoading)) && <TableSkeleton rows={4} columns={6} />}

      {hoursEnabled && isError && (
        <Alert variant="destructive">
          <AlertDescription>
            Could not load utilization{error instanceof ApiError ? `: ${error.message}` : "."}
          </AlertDescription>
        </Alert>
      )}

      {scope !== "workload" && data && !data.configured && (
        <EmptyState
          icon="link_off"
          title="iTop is not connected"
          message={
            isAdmin ? (
              <>
                An admin connects it under Admin › iTop.{" "}
                <Link to="/admin" className="text-primary hover:underline">
                  Go to Admin
                </Link>
                .
              </>
            ) : (
              "An admin connects it under Admin › iTop."
            )
          }
        />
      )}

      {scope !== "workload" && data && data.configured && (
        <>
          <UtilizationTiles tiles={data.tiles} scope={hoursScope} />
          <UtilizationTable data={data} scope={hoursScope} />
          <p className="text-xs text-on-surface-variant">
            Hours come from iTop TimeSpent entries. To change a number, edit the entry in iTop.
          </p>
        </>
      )}
    </div>
  );
}
