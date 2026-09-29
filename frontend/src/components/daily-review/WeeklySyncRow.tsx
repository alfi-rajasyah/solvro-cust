// Weekly sync row (docs/archive/plans/weekly-sync-tables.md §4 "Daily Review",
// T5): replaces the old single free-text WeeklyUpdateBlock with a compact
// status row plus two buttons that open the Mid-week and Reflection sync
// modals (MidweekSyncModal.tsx / ReflectionSyncModal.tsx). The row itself
// holds no draft state — each modal owns its own, initialised fresh from
// `customer.weeklyUpdate` every time it opens, since it's mounted only
// while open (`activeModal` below), never leaking text between weeks or
// between opens. The two buttons render only for `project:write` (as
// DailyReview.tsx already gates other write actions); without it the row
// is read-only status text.
import { useState } from "react";
import { Badge } from "@/components/reui/badge";
import { hasPermission, useAuth } from "@/lib/auth";
import { weekNumberLabel } from "@/lib/dailyReviewStats";
import { fmtDateTime } from "@/lib/formatDate";
import { WEEKLY_HEALTH_LABEL, WEEKLY_STATUS_LABEL } from "@/lib/labels";
import type { DailyReviewCustomer, WeeklyStatus } from "@/lib/queries";
import { MidweekSyncModal } from "./MidweekSyncModal";
import { ReflectionSyncModal } from "./ReflectionSyncModal";
import { HEALTH_CLASS, WEEKLY_STATUS_BADGE } from "./SyncField";

export interface WeeklySyncRowProps {
  customer: DailyReviewCustomer;
  week: { key: string; start: string; days: string[] };
}

export function WeeklySyncRow({ customer, week }: WeeklySyncRowProps) {
  const { user } = useAuth();
  const canWrite = hasPermission(user, "project:write");
  const [activeModal, setActiveModal] = useState<"midweek" | "reflection" | null>(null);

  const update = customer.weeklyUpdate;
  const status: WeeklyStatus = update?.status ?? "NOT_STARTED";
  const badge = WEEKLY_STATUS_BADGE[status];
  const health = update?.health ?? null;

  const midweekLine = update?.midweekSavedAt
    ? `Mid-week saved ${fmtDateTime(update.midweekSavedAt)}`
    : "Mid-week not filled";
  const statusLine = `${midweekLine} · Reflection: ${WEEKLY_STATUS_LABEL[status]}`;

  return (
    <section className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-sm border border-outline-variant bg-surface-container px-4 py-3">
      <h3 className="font-display text-sm font-semibold text-on-surface">Weekly sync</h3>
      <span className="text-label-caps uppercase text-on-surface-variant">
        Week {weekNumberLabel(week.key)} · {customer.name}
      </span>
      <Badge variant={badge.variant}>{badge.label}</Badge>
      {health && (
        <span className={`rounded-full px-2 py-0.5 text-meta font-semibold ${HEALTH_CLASS[health]}`}>
          {WEEKLY_HEALTH_LABEL[health]}
        </span>
      )}
      <span className="text-[13px] text-on-surface-variant">{statusLine}</span>

      {canWrite && (
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveModal("midweek")}
            className="rounded-sm border border-outline-variant px-3 py-1.5 font-display text-[12px] font-semibold text-on-surface-variant hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            Mid-week sync
          </button>
          <button
            type="button"
            onClick={() => setActiveModal("reflection")}
            className="rounded-sm bg-primary px-3 py-1.5 font-display text-[12px] font-semibold text-on-primary hover:bg-primary-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            Reflection sync
          </button>
        </div>
      )}

      {activeModal === "midweek" && (
        <MidweekSyncModal customer={customer} week={week} onClose={() => setActiveModal(null)} />
      )}
      {activeModal === "reflection" && (
        <ReflectionSyncModal customer={customer} week={week} onClose={() => setActiveModal(null)} />
      )}
    </section>
  );
}
