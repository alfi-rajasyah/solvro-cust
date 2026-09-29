import { prisma } from "../prisma.js";
import { overdueBoundary } from "./dateBoundary.js";

// Per-project health numbers shared by GET /projects, GET /projects/:id and
// the nested projects[] of GET /customers/:id. Four queries in one
// Promise.all no matter how many projects are requested — never N+1
// (backend NFR: sub-200ms). Callers pass ids they already scoped through
// projectVisibilityFilter; this helper does no scoping of its own.

export interface ProjectHealth {
  /** All tasks, subtasks included (matches the project Overview's "7 of 17"). */
  progress: { done: number; total: number };
  /** status != DONE and dueDate < overdueBoundary(today). */
  overdueCount: number;
  /** Risk.status = OPEN. */
  openRiskCount: number;
  /** Min Task.startDate as yyyy-MM-dd, or null when no task is dated. */
  startDate: string | null;
  /** Max Task.dueDate as yyyy-MM-dd, or null when no task is dated. */
  endDate: string | null;
}

function emptyHealth(): ProjectHealth {
  return {
    progress: { done: 0, total: 0 },
    overdueCount: 0,
    openRiskCount: 0,
    startDate: null,
    endDate: null,
  };
}

/** "yyyy-MM-dd" of a task date's UTC calendar day. */
function dayOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function computeProjectHealth(
  projectIds: number[],
  today?: string,
): Promise<Map<number, ProjectHealth>> {
  const result = new Map<number, ProjectHealth>();
  for (const id of projectIds) result.set(id, emptyHealth());
  if (projectIds.length === 0) return result;

  const boundary = overdueBoundary(today);
  const inScope = { projectId: { in: projectIds } };

  const [statusCounts, overdueCounts, riskCounts, dateRanges] = await Promise.all([
    prisma.task.groupBy({
      by: ["projectId", "status"],
      where: inScope,
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ["projectId"],
      where: { ...inScope, status: { not: "DONE" }, dueDate: { lt: boundary } },
      _count: { _all: true },
    }),
    prisma.risk.groupBy({
      by: ["projectId"],
      where: { ...inScope, status: "OPEN" },
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ["projectId"],
      where: inScope,
      _min: { startDate: true },
      _max: { dueDate: true },
    }),
  ]);

  for (const row of statusCounts) {
    const h = result.get(row.projectId);
    if (!h) continue;
    h.progress.total += row._count._all;
    if (row.status === "DONE") h.progress.done += row._count._all;
  }
  for (const row of overdueCounts) {
    const h = result.get(row.projectId);
    if (h) h.overdueCount = row._count._all;
  }
  for (const row of riskCounts) {
    const h = result.get(row.projectId);
    if (h) h.openRiskCount = row._count._all;
  }
  for (const row of dateRanges) {
    const h = result.get(row.projectId);
    if (!h) continue;
    h.startDate = row._min.startDate ? dayOf(row._min.startDate) : null;
    h.endDate = row._max.dueDate ? dayOf(row._max.dueDate) : null;
  }
  return result;
}

// --- Ports of frontend/src/pages/DailyReview.tsx's currentPhase() /
// scheduleSignal(), computed server-side so payloads ship the finished value
// instead of raw task lists. Shared by Daily Review and the project detail.

export interface PhaseTask {
  status: string;
  section: { id: number; name: string; position: number } | null;
}

// Earliest section (by position) that still has a non-DONE task. Mirrors
// currentPhase() in the frontend exactly, including the two terminal
// strings ("All phases complete" when every section is done, "—" when the
// project has no sections at all).
export function currentPhase(tasks: PhaseTask[]): string {
  const bySection = new Map<
    number,
    { name: string; pos: number; total: number; done: number }
  >();
  for (const t of tasks) {
    if (!t.section) continue;
    const e =
      bySection.get(t.section.id) ??
      { name: t.section.name, pos: t.section.position, total: 0, done: 0 };
    e.total++;
    if (t.status === "DONE") e.done++;
    bySection.set(t.section.id, e);
  }
  const ordered = [...bySection.values()].sort((a, b) => a.pos - b.pos);
  const cur = ordered.find((s) => s.done < s.total);
  if (cur) return cur.name;
  return ordered.length > 0 ? "All phases complete" : "—";
}

export interface SlipTask {
  dueDate: Date | null;
  baselineDueDate: Date | null;
}

// Mirrors scheduleSignal()'s slip math, minus the label/tone — the frontend
// derives its own chip from this number. null whenever there is no baseline
// lock, or either side of the comparison has no dated tasks.
export function computeSlipDays(
  baselineLockedAt: Date | null,
  tasks: SlipTask[],
): number | null {
  if (!baselineLockedAt) return null;
  let maxDue: number | null = null;
  let maxBaselineDue: number | null = null;
  for (const t of tasks) {
    if (t.dueDate) {
      const ms = t.dueDate.getTime();
      if (maxDue === null || ms > maxDue) maxDue = ms;
    }
    if (t.baselineDueDate) {
      const ms = t.baselineDueDate.getTime();
      if (maxBaselineDue === null || ms > maxBaselineDue) maxBaselineDue = ms;
    }
  }
  if (maxDue === null || maxBaselineDue === null) return null;
  return Math.round((maxDue - maxBaselineDue) / 86_400_000);
}
