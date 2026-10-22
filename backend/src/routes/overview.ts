import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { requireAuth, type JwtPayload, requirePermission } from "../http/auth.js";
import { validate } from "../http/validate.js";
import { projectVisibilityFilter } from "../lib/visibility.js";
import { computePortfolioRows } from "../lib/portfolio.js";
import {
  isValidDayString,
  overdueBoundary,
  utcMidnightOfDayString,
} from "../lib/dateBoundary.js";
import { parseWeekKey, weekKeyOf } from "../lib/isoWeek.js";
import { resolveDailyReviewScope } from "../lib/dailyReviewScope.js";

export const overviewRouter = Router();

// Portfolio rows and sidebar counts are project data: `project:read` like the
// /projects router. The Overview page and the sidebar skip these calls for a
// user without the permission (frontend/src/pages/Overview.tsx, Sidebar.tsx).
overviewRouter.use(requireAuth, requirePermission("project:read"));

// Single source of truth for project scoping — permission-based, shared
// with the projects router (no role-name logic).
function projectScope(user: JwtPayload): Prisma.ProjectWhereInput {
  return projectVisibilityFilter(user);
}

const overviewQuerySchema = z.object({
  // Caller's local calendar day ("yyyy-MM-dd"), threaded into the
  // portfolio block's isOverdue/daysOverdue — see lib/dateBoundary.ts.
  // Falls back to the server's UTC day when absent.
  today: z
    .string()
    .refine(isValidDayString, { message: "today must be a valid yyyy-MM-dd date" })
    .optional(),
});

overviewRouter.get("/", validate("query", overviewQuerySchema), async (req, res) => {
  const { today } = req.query as unknown as z.infer<typeof overviewQuerySchema>;
  const user = req.user!;
  // Administrative containers (excludeFromPortfolio) are out of ALL Overview
  // roll-ups — KPI counts and recent-lists included, not just the portfolio
  // block — so they can't inflate the dashboard they were flagged to leave.
  // (computePortfolioRows applies the same filter internally.)
  const scope: Prisma.ProjectWhereInput = {
    AND: [projectScope(user), { excludeFromPortfolio: false }],
  };

  // Work-count window: overdue is before the caller's `today`; "due this
  // week" runs from `today` through the ISO week's Sunday, inclusive (the
  // exclusive upper bound is the following Monday's UTC midnight).
  const todayBoundary = overdueBoundary(today);
  const todayDay = todayBoundary.toISOString().slice(0, 10);
  const weekDays = parseWeekKey(weekKeyOf(todayDay))?.days;
  if (!weekDays) throw new Error(`unreachable: no ISO week for ${todayDay}`);
  const weekEnd = utcMidnightOfDayString(weekDays[6]!);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 1);

  // The Overview tiles link to lists, so each count uses the scope of the
  // list it opens: overdue/due-this-week open GET /tasks (top-level tasks,
  // every project the caller can see, administrative containers included —
  // same visibility path as routes/tasks.ts's buildVisibilityWhere); open
  // risks opens Daily Review (ACTIVE projects in its customer scope).
  const projectWhere = projectVisibilityFilter(user);
  const taskListScope: Prisma.TaskWhereInput =
    Object.keys(projectWhere).length === 0 ? {} : { project: projectWhere };
  const { projects: reviewProjects } = await resolveDailyReviewScope(user);

  const [projectCount, projectsByStatus, taskGroups, portfolio, overdue, dueThisWeek, openRisks] =
    await Promise.all([
      prisma.project.count({ where: scope }),
      prisma.project.groupBy({
        by: ["status"],
        where: scope,
        _count: { _all: true },
      }),
      prisma.task.groupBy({
        by: ["status"],
        where: { project: scope },
        _count: { _all: true },
      }),
      computePortfolioRows(scope, today),
      prisma.task.count({
        where: {
          ...taskListScope,
          parentTaskId: null,
          status: { not: "DONE" },
          dueDate: { lt: todayBoundary },
        },
      }),
      prisma.task.count({
        where: {
          ...taskListScope,
          parentTaskId: null,
          status: { not: "DONE" },
          dueDate: { gte: todayBoundary, lt: weekEnd },
        },
      }),
      prisma.risk.count({
        where: { projectId: { in: reviewProjects.map((p) => p.id) }, status: "OPEN" },
      }),
    ]);

  const taskCounts = { TODO: 0, IN_PROGRESS: 0, DONE: 0 };
  for (const g of taskGroups) taskCounts[g.status] = g._count._all;

  const projectStatusCounts = Object.fromEntries(
    projectsByStatus.map((g) => [g.status, g._count._all]),
  );

  res.json({
    projectCount,
    projectStatusCounts,
    taskCounts,
    portfolio,
    workCounts: { overdue, dueThisWeek, openRisks },
  });
});

const badgesQuerySchema = z.object({
  // Caller's local calendar day — "reviewed today" is judged against it.
  today: z.string().refine(isValidDayString, { message: "today must be a valid yyyy-MM-dd date" }),
});

// Light sidebar counts (no task rows loaded). `dailyReviewPending` = the
// caller's Daily Review customers (lib/dailyReviewScope.ts — the exact scope
// GET /daily-review renders) that still have at least one ACTIVE project
// without a ProjectReview row for the caller on `today`. Projects without a
// customer belong to no customer group and are not counted.
overviewRouter.get("/badges", validate("query", badgesQuerySchema), async (req, res) => {
  const { today } = req.query as unknown as z.infer<typeof badgesQuerySchema>;
  const user = req.user!;

  const { projects } = await resolveDailyReviewScope(user);
  const projectIds = projects.map((p) => p.id);
  const reviews =
    projectIds.length === 0
      ? []
      : await prisma.projectReview.findMany({
          where: {
            projectId: { in: projectIds },
            userId: user.sub,
            reviewDate: utcMidnightOfDayString(today),
          },
          select: { projectId: true },
        });
  const reviewed = new Set(reviews.map((r) => r.projectId));

  const pendingCustomers = new Set<number>();
  for (const p of projects) {
    if (p.customerId !== null && !reviewed.has(p.id)) pendingCustomers.add(p.customerId);
  }

  res.json({ dailyReviewPending: pendingCustomers.size });
});
