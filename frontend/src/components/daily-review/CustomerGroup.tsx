// Customer group (spec §6.3 pin 3, Decision 15): a chevron toggle button
// at the start of the header row (aria-expanded, expand_more/expand_less
// icon) collapses/expands the group's body (project cards, one operations
// card, one weekly-sync row, inside a left-bordered indent). The
// customer name is a link to /customers/:id, so the toggle is the icon
// button alone rather than the whole row — a link can't sit inside a
// button. The header row itself is always the same summary content —
// name, project count, TAM, "reviewed x/y", weekly-status badge, health
// chip — whether collapsed or expanded, so it reads correctly for any
// group, not just a "done" one.
//
// Default: expanded, EXCEPT a group whose projects are all reviewed today
// AND whose weekly update is DONE (`isGroupCollapsible`,
// lib/dailyReviewStats.ts) starts collapsed. A manual toggle always wins
// over that default from then on. A day-strip focus request force-expands
// the group holding the first project regardless of manual state, via the
// same dismissed-token bookkeeping as before (a fresh click always carries
// a new token, so it can force the group open again even after the user
// dismissed a previous force-expand).
import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/reui/badge";
import { isGroupCollapsible } from "@/lib/dailyReviewStats";
import { dayFromIso } from "@/lib/dateField";
import type { DailyReviewCustomer, WeeklyStatus } from "@/lib/queries";
import { OperationsCard } from "./OperationsCard";
import { ProjectCard } from "./ProjectCard";
import { HEALTH_CLASS, WEEKLY_STATUS_BADGE } from "./SyncField";
import { WeeklySyncRow } from "./WeeklySyncRow";

export interface CustomerGroupProps {
  customer: DailyReviewCustomer;
  week: { key: string; start: string; days: string[] };
  today: string;
  currentUserId: number;
  canDeleteAny: boolean;
  firstProjectId: number | null;
  focusRequest: { day: string; token: number } | null;
}

export function CustomerGroup({
  customer,
  week,
  today,
  currentUserId,
  canDeleteAny,
  firstProjectId,
  focusRequest,
}: CustomerGroupProps) {
  const autoCollapse = isGroupCollapsible(customer, today);
  // null = no manual choice yet — follow the auto-collapse default, which
  // stays live (e.g. flips true the moment the last project is reviewed and
  // the weekly update is marked done). Once the user toggles, their choice
  // wins from then on ("manual toggle wins in both directions").
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  // The most recent focus-request token the user explicitly collapsed back
  // past — without this, `forceExpand` below would stay true forever after
  // the FIRST day-strip click ever fired (focusRequest never goes back to
  // null), permanently disabling manual collapse on this group. A new click
  // always carries a fresh token (Date.now(), see DailyReview.tsx), so it
  // forces the group open again even if the previous token was dismissed.
  const [dismissedFocusToken, setDismissedFocusToken] = useState<number | null>(null);

  // A day-strip click targeting the first card must be able to reach it
  // even if its group is currently collapsed — force it open for that click
  // without disturbing the user's own collapse/expand choice otherwise.
  const containsFirstProject = customer.projects.some((p) => p.id === firstProjectId);
  const forceExpand =
    containsFirstProject && focusRequest !== null && focusRequest.token !== dismissedFocusToken;
  const expanded = forceExpand || (manualExpanded ?? !autoCollapse);

  const projectCount = customer.projects.length;
  const tamLabel = customer.tam?.username ?? "Unassigned";
  const reviewedCount = customer.projects.filter((p) =>
    p.reviews.some((r) => dayFromIso(r.reviewDate) === today),
  ).length;
  const weeklyStatus: WeeklyStatus = customer.weeklyUpdate?.status ?? "NOT_STARTED";
  const weeklyBadge = WEEKLY_STATUS_BADGE[weeklyStatus];
  const health = customer.weeklyUpdate?.health ?? null;
  const bodyId = `customer-body-${customer.id}`;

  function handleToggle() {
    const next = !expanded;
    setManualExpanded(next);
    // Collapsing while a day-strip force-expand is in effect must dismiss
    // that token, or `forceExpand` would immediately re-open the group.
    if (!next && focusRequest) setDismissedFocusToken(focusRequest.token);
  }

  return (
    <section className="space-y-3">
      <h2 className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={handleToggle}
          aria-expanded={expanded}
          aria-controls={bodyId}
          aria-label={expanded ? "Collapse customer" : "Expand customer"}
          className="flex h-6 w-6 items-center justify-center rounded-sm text-on-surface-variant hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          <span className="material-symbols-outlined text-lg" aria-hidden="true">
            {expanded ? "expand_less" : "expand_more"}
          </span>
        </button>
        <Link
          to={`/customers/${customer.id}`}
          className="font-display text-base font-semibold text-on-surface hover:text-primary"
        >
          {customer.name}
        </Link>
        <span className="text-xs text-on-surface-variant">
          {projectCount} active project{projectCount === 1 ? "" : "s"}
        </span>
        <span className="text-xs text-on-surface-variant">TAM: {tamLabel}</span>
        <span className="text-xs font-semibold text-on-surface-variant">
          {reviewedCount} / {projectCount} reviewed
        </span>
        <Badge variant={weeklyBadge.variant}>{weeklyBadge.label}</Badge>
        {health && (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${HEALTH_CLASS[health]}`}>
            {health}
          </span>
        )}
      </h2>

      {expanded && (
        <div id={bodyId} className="space-y-3 border-l-2 border-outline-variant pl-4">
          {customer.projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              today={today}
              days={week.days}
              currentUserId={currentUserId}
              canDeleteAny={canDeleteAny}
              isFirstCard={project.id === firstProjectId}
              focusRequest={focusRequest}
            />
          ))}
          <OperationsCard
            customer={customer}
            today={today}
            days={week.days}
            currentUserId={currentUserId}
            canDeleteAny={canDeleteAny}
          />
          <WeeklySyncRow customer={customer} week={week} />
        </div>
      )}
    </section>
  );
}
