// Pure helpers for the Workload tab (docs/archive/plans/workload-tab.md).
import type { StatItem } from "@/components/StatStrip";
import type { WorkloadScope, WorkloadTotals } from "@/lib/queries";

/** The one line under the strip that says whose numbers these are. */
export function scopeNote(scope: WorkloadScope): string {
  if (scope === "all") return "Everyone with assigned tasks, across all projects.";
  if (scope === "team") return "You and the people assigned on projects you own, plus those projects' unassigned tasks.";
  return "Your own tasks, in projects you can open.";
}

/** The summary strip's five stats from the table totals. */
export function workloadStats(totals: WorkloadTotals): StatItem[] {
  return [
    { key: "open", value: totals.open, label: "open tasks", testId: "workload-stat-open" },
    { key: "due", value: totals.dueThisWeek, label: "due in week", testId: "workload-stat-due" },
    {
      key: "overdue",
      value: totals.overdue,
      label: "overdue",
      tone: totals.overdue > 0 ? "bad" : "neutral",
      testId: "workload-stat-overdue",
    },
    { key: "active", value: totals.activeInWeek, label: "active in week", testId: "workload-stat-active" },
    { key: "points", value: totals.storyPoints, label: "open story points", testId: "workload-stat-points" },
  ];
}

/** Whether a task's due day (yyyy-MM-dd) is before the viewer's local today. */
export function isOverdueDay(dueDay: string | null, today: string): boolean {
  return dueDay !== null && dueDay < today;
}

/** Task page the row links to: the project's list view with the task panel open. */
export function taskHref(projectId: number, taskId: number): string {
  return `/projects/${projectId}/list?task=${taskId}`;
}
