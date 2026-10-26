import { Prisma, ProjectStatus } from "@prisma/client";
import { prisma } from "../prisma.js";
import { overdueBoundary, utcMidnightOf } from "./dateBoundary.js";

export interface PortfolioProjectRow {
  id: number;
  name: string;
  status: ProjectStatus;
  tamName: string;
  customerId: number | null;
  customerName: string | null;
  start: string | null;
  end: string | null;
  totalTasks: number;
  doneTasks: number;
  progressPct: number;
  isOverdue: boolean;
  daysOverdue: number;
  updatedAt: string;
  sections: { id: number; name: string; color: string }[];
}

export async function computePortfolioRows(
  where: Prisma.ProjectWhereInput,
  // Caller's local calendar day ("yyyy-MM-dd"), already validated by the
  // calling route's Zod schema — see lib/dateBoundary.ts for the contract.
  // Falls back to the server's UTC day when absent.
  today?: string,
): Promise<PortfolioProjectRow[]> {
  const projects = await prisma.project.findMany({
    // Administrative containers (excludeFromPortfolio) never appear in
    // roll-ups regardless of what filter the caller passes — this is the
    // single choke point for both GET /overview and GET /reports/executive.
    where: { AND: [where, { excludeFromPortfolio: false }] },
    select: {
      id: true,
      name: true,
      status: true,
      updatedAt: true,
      tam: { select: { username: true } },
      customer: { select: { id: true, name: true } },
      sections: {
        orderBy: { position: "asc" },
        select: { id: true, name: true, color: true },
      },
    },
  });

  // Task facts come from grouped aggregates in the database, never from
  // loading every task row of every project.
  const projectIds = projects.map((p) => p.id);
  const [statusCounts, dateRanges] =
    projectIds.length === 0
      ? [[], []]
      : await Promise.all([
          prisma.task.groupBy({
            by: ["projectId", "status"],
            where: { projectId: { in: projectIds } },
            _count: { _all: true },
          }),
          prisma.task.groupBy({
            by: ["projectId"],
            where: { projectId: { in: projectIds } },
            _min: { startDate: true },
            _max: { dueDate: true },
          }),
        ]);
  const totals = new Map<number, { total: number; done: number }>();
  for (const row of statusCounts) {
    const t = totals.get(row.projectId) ?? { total: 0, done: 0 };
    t.total += row._count._all;
    if (row.status === "DONE") t.done += row._count._all;
    totals.set(row.projectId, t);
  }
  const ranges = new Map(dateRanges.map((r) => [r.projectId, r]));

  // See lib/dateBoundary.ts for the full contract this boundary follows
  // (shared with routes/tasks.ts's /tasks?overdue=true).
  const startOfToday = overdueBoundary(today);

  const rows: PortfolioProjectRow[] = projects.map((project) => {
    const counts = totals.get(project.id) ?? { total: 0, done: 0 };
    const range = ranges.get(project.id);
    const startMs = range?._min.startDate?.getTime() ?? null;
    const endMs = range?._max.dueDate?.getTime() ?? null;
    const doneTasks = counts.done;

    const start = startMs !== null ? new Date(startMs).toISOString() : null;
    const end = endMs !== null ? new Date(endMs).toISOString() : null;

    const totalTasks = counts.total;
    const progressPct = totalTasks === 0 ? 0 : Math.round((doneTasks / totalTasks) * 100);

    const isOverdue =
      endMs !== null &&
      endMs < startOfToday.getTime() &&
      project.status !== ProjectStatus.COMPLETED &&
      project.status !== ProjectStatus.CANCELLED;

    // Floor endMs to its own UTC calendar day first: a non-midnight stored
    // instant (e.g. a task due at ...T17:00:00.000Z yesterday) must still
    // count as 1 full day overdue, not 0 — the calendar day is what's
    // overdue, not the exact millisecond.
    const daysOverdue = isOverdue
      ? Math.max(
          0,
          Math.floor(
            (startOfToday.getTime() - utcMidnightOf(endMs as number).getTime()) / 86_400_000,
          ),
        )
      : 0;

    return {
      id: project.id,
      name: project.name,
      status: project.status,
      tamName: project.tam.username,
      customerId: project.customer?.id ?? null,
      customerName: project.customer?.name ?? null,
      start,
      end,
      totalTasks,
      doneTasks,
      progressPct,
      isOverdue,
      daysOverdue,
      updatedAt: project.updatedAt.toISOString(),
      sections: project.sections,
    };
  });

  return rows;
}
