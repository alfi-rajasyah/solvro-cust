// Stats bar (spec §6.3 pin 2): five summary numbers derived client-side from
// the page payload by `computeDailyReviewStats` (lib/dailyReviewStats.ts),
// shown as the shared StatStrip. Labels are short ("reviewed", "updates") to
// fit five cells; the group label gives the context. The test ids stay on the cells; each number
// carries `<testId>-value` (e2e reads it).
import { StatStrip, type StatItem } from "@/components/StatStrip";
import type { DailyReviewStats } from "@/lib/dailyReviewStats";

export function StatsBar({ stats }: { stats: DailyReviewStats }) {
  const items: StatItem[] = [
    {
      key: "reviewed-today",
      value: stats.reviewedToday.count,
      of: `of ${stats.reviewedToday.total}`,
      label: "reviewed",
      testId: "stat-reviewed-today",
    },
    {
      key: "notes-this-week",
      value: stats.notesThisWeek.total,
      label: "notes this week",
      testId: "stat-notes-this-week",
    },
    {
      key: "weekly-updates",
      value: stats.weeklyUpdatesDone.count,
      of: `of ${stats.weeklyUpdatesDone.total}`,
      label: "updates",
      testId: "stat-weekly-updates",
    },
    {
      key: "overdue-tasks",
      value: stats.overdueTasks,
      label: "overdue tasks",
      tone: stats.overdueTasks > 0 ? "bad" : "neutral",
      testId: "stat-overdue-tasks",
    },
    {
      key: "open-risks",
      value: stats.openRisks,
      label: "open risks",
      tone: stats.openRisks > 0 ? "warn" : "neutral",
      testId: "stat-open-risks",
    },
  ];
  return <StatStrip items={items} label="Daily review summary: customers reviewed, notes, weekly updates, overdue tasks, open risks" />;
}
