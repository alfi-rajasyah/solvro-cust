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
      tasks: {
        select: { status: true, startDate: true, dueDate: true },
      },
    },
  });

  // See lib/dateBoundary.ts for the full contract this boundary follows
  // (shared with routes/tasks.ts's /tasks?overdue=true).
  const startOfToday = overdueBoundary(today);

  const rows: PortfolioProjectRow[] = projects.map((project) => {
    const { tasks } = project;

    let startMs: number | null = null;
    let endMs: number | null = null;
    let doneTasks = 0;

    for (const task of tasks) {
      if (task.startDate !== null) {
        const ms = task.startDate.getTime();
        if (startMs === null || ms < startMs) startMs = ms;
      }
      if (task.dueDate !== null) {
        const ms = task.dueDate.getTime();
        if (endMs === null || ms > endMs) endMs = ms;
      }
      if (task.status === "DONE") doneTasks += 1;
    }

    const start = startMs !== null ? new Date(startMs).toISOString() : null;
    const end = endMs !== null ? new Date(endMs).toISOString() : null;

    const totalTasks = tasks.length;
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
