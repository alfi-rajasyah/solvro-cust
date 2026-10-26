import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CustomerGroup } from "@/components/daily-review/CustomerGroup";
import { StatsBar } from "@/components/daily-review/StatsBar";
import { UnassignedGroup } from "@/components/daily-review/UnassignedGroup";
import { WeekStrip } from "@/components/daily-review/WeekStrip";
import { QueryErrorAlert } from "@/components/QueryErrorAlert";
import { Skeleton } from "@/components/ui/skeleton";
import { hasPermission, useAuth } from "@/lib/auth";
import { computeDailyReviewStats, firstProjectId as firstProjectIdOf, weekNumberLabel } from "@/lib/dailyReviewStats";
import { dateToDay } from "@/lib/dateField";
import { fmtDayLong } from "@/lib/formatDate";
import { formatWeekRange, parseWeekKey, shiftWeek, weekKeyOf } from "@/lib/isoWeek";
import { type DailyItopCustomer, useDailyReview, useItopDaily } from "@/lib/queries";

interface FocusRequest {
  day: string;
  token: number;
}

// Daily Review v2 (docs/plans/daily-review-v2-spec.md): a weekly, per-
// customer surface — daily notes per project, operations notes per
// customer, an explicit "Mark reviewed" action, actionable overdue-task/
// open-risk lists, and a weekly update drafted from the week's notes. The
// page itself only owns layout, URL week-state, and the "scroll to the
// first card" focus request; everything stateful per project/customer
// lives in CustomerGroup's subtree (frontend/src/components/daily-review/).
export function DailyReview() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const weekParam = searchParams.get("week");
  const week = weekParam && parseWeekKey(weekParam) ? weekParam : weekKeyOf(dateToDay(new Date())!);

  // A missing/invalid `?week=` resolves to the current week above for
  // rendering, but the URL itself is normalized to that resolved value too
  // (replace, not push, so it doesn't add a spurious history entry) — so
  // Prev/Next and a shared link always have a concrete week to work from.
  useEffect(() => {
    if (weekParam !== week) {
      const next = new URLSearchParams(searchParams);
      next.set("week", week);
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week, weekParam]);

  const { data, isLoading, isError, error, refetch } = useDailyReview(week);

  // Daily Review's iTop strip (Task 2.2): one fetch for the whole page, keyed
  // by the resolved "today" (not the viewed week — the strip always shows
  // today's operations picture regardless of which week is on screen), then
  // sliced per customer below. `enabled: Boolean(data)` avoids firing before
  // `data.today` is known; the fallback date only matters for the disabled
  // query's key shape. A 404/error here (iTop not configured, or the dev
  // backend not caught up yet) just leaves `itopDaily` undefined — no strip
  // renders, nothing else on the page is affected. GET /itop/daily requires
  // `project:read` (403 otherwise), so a user without it skips the fetch and
  // the strip entirely.
  const { data: itopDaily } = useItopDaily(data?.today ?? dateToDay(new Date())!, {
    enabled: Boolean(data) && hasPermission(user, "project:read"),
  });
  const itopByCustomer = useMemo(() => {
    const map = new Map<number, DailyItopCustomer>();
    itopDaily?.customers.forEach((c) => map.set(c.customerId, c));
    return map;
  }, [itopDaily]);

  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);

  const stats = useMemo(() => (data ? computeDailyReviewStats(data) : null), [data]);
  const firstProjectId = useMemo(() => (data ? firstProjectIdOf(data) : null), [data]);

  const canDeleteAny = hasPermission(user, "*");
  const currentUserId = user?.id ?? -1;

  function goToWeek(next: string) {
    const params = new URLSearchParams(searchParams);
    params.set("week", next);
    setSearchParams(params);
  }

  const isEmpty = data ? data.customers.length === 0 && data.unassignedProjects.length === 0 : false;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-on-surface">Daily Review</h1>
          <p className="text-sm text-on-surface-variant">
            {fmtDayLong(dateToDay(new Date()))}
            {user?.username ? ` — ${user.username}` : ""}. Your customers, their active projects, and each
            customer's weekly update.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => goToWeek(shiftWeek(week, -1))}
            aria-label="Previous week"
            className="flex h-8 w-8 items-center justify-center rounded-sm border border-outline-variant text-on-surface-variant hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
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
            className="flex h-8 w-8 items-center justify-center rounded-sm border border-outline-variant text-on-surface-variant hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-lg">chevron_right</span>
          </button>
        </div>
      </div>

      {data && (
        <WeekStrip
          days={data.week.days}
          today={data.today}
          coverage={data.coverage}
          onDayClick={(day) => setFocusRequest({ day, token: Date.now() })}
        />
      )}

      {stats && <StatsBar stats={stats} />}

      {isLoading && <DailyReviewSkeleton />}

      {isError && (
        <QueryErrorAlert title="Could not load the daily review" error={error} onRetry={refetch} />
      )}

      {data && isEmpty && (
        <div className="rounded-sm border border-outline-variant bg-surface-container px-6 py-10 text-center text-sm text-on-surface-variant">
          No active projects or customers to review this week.
        </div>
      )}

      {data && !isEmpty && (
        <div className="space-y-6">
          {data.customers.map((customer) => (
            <CustomerGroup
              key={customer.id}
              customer={customer}
              week={data.week}
              today={data.today}
              currentUserId={currentUserId}
              canDeleteAny={canDeleteAny}
              firstProjectId={firstProjectId}
              focusRequest={focusRequest}
              itop={itopByCustomer.get(customer.id)}
            />
          ))}

          {data.unassignedProjects.length > 0 && (
            <UnassignedGroup
              projects={data.unassignedProjects}
              today={data.today}
              days={data.week.days}
              currentUserId={currentUserId}
              canDeleteAny={canDeleteAny}
              firstProjectId={firstProjectId}
              focusRequest={focusRequest}
            />
          )}
        </div>
      )}
    </div>
  );
}

function DailyReviewSkeleton() {
  return (
    <div className="space-y-4">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-52 w-full rounded-sm" />
      ))}
    </div>
  );
}
