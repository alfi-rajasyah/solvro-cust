// Stats bar (spec §6.3 pin 2): 5 tiles derived client-side from the page
// payload by `computeDailyReviewStats` (lib/dailyReviewStats.ts). Tone
// treatment mirrors the pre-v2 page's Stat tile (icon + mono value).
import type { DailyReviewStats } from "@/lib/dailyReviewStats";

type Tone = "primary" | "good" | "warn" | "bad" | "neutral";

const TONE_ICON: Record<Tone, string> = {
  primary: "text-primary",
  good: "text-chip-emerald-text",
  warn: "text-chip-amber-text",
  bad: "text-chip-rose-text",
  neutral: "text-on-surface-variant",
};

export function StatsBar({ stats }: { stats: DailyReviewStats }) {
  const weeklyDoneTone: Tone =
    stats.weeklyUpdatesDone.total > 0 && stats.weeklyUpdatesDone.count >= stats.weeklyUpdatesDone.total
      ? "good"
      : "neutral";
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      <Stat
        label="Customers reviewed"
        value={`${stats.reviewedToday.count} of ${stats.reviewedToday.total}`}
        icon="fact_check"
        tone={stats.reviewedToday.count > 0 ? "primary" : "neutral"}
        testId="stat-reviewed-today"
      />
      <Stat
        label="Notes this week"
        value={stats.notesThisWeek.total}
        icon="edit_note"
        tone={stats.notesThisWeek.total > 0 ? "primary" : "neutral"}
        testId="stat-notes-this-week"
      />
      <Stat
        label="Weekly updates"
        value={`${stats.weeklyUpdatesDone.count} of ${stats.weeklyUpdatesDone.total}`}
        icon="summarize"
        tone={weeklyDoneTone}
        testId="stat-weekly-updates"
      />
      <Stat
        label="Overdue tasks"
        value={stats.overdueTasks}
        icon="event_busy"
        tone={stats.overdueTasks > 0 ? "bad" : "good"}
        testId="stat-overdue-tasks"
      />
      <Stat
        label="Open risks"
        value={stats.openRisks}
        icon="warning"
        tone={stats.openRisks > 0 ? "warn" : "good"}
        testId="stat-open-risks"
      />
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
  tone,
  testId,
}: {
  label: string;
  value: string | number;
  icon: string;
  tone: Tone;
  /** e2e hook (daily-review-v2-spec.md §9): opt-in per tile — a stable, unambiguous
   * selector for the tile's numeric value is otherwise impossible (the label text
   * alone isn't queryable as a value, and the value text alone isn't unique). */
  testId?: string;
}) {
  return (
    <div className="rounded-sm border border-outline-variant bg-surface-container-lowest p-3">
      <div className="flex items-center justify-between">
        <span className="text-label-caps uppercase text-on-surface-variant">{label}</span>
        <span aria-hidden="true" className={`material-symbols-outlined text-base ${TONE_ICON[tone]}`}>{icon}</span>
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-on-surface" data-testid={testId}>
        {value}
      </div>
    </div>
  );
}
