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
import { groupCustomerIds, resolveDailyReviewScope } from "../lib/dailyReviewScope.js";

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
  // Person filters (docs/archive/plans/overview-person-filters.md). Both are
  // AND-composed with the caller's visibility scope: an id outside it simply
  // yields zeros, never a wider result.
  tamId: z.coerce.number().int().positive().max(2147483647).optional(),
  assigneeId: z.coerce.number().int().positive().max(2147483647).optional(),
});

overviewRouter.get("/", validate("query", overviewQuerySchema), async (req, res) => {
  const { today, tamId, assigneeId } = req.query as unknown as z.infer<typeof overviewQuerySchema>;
  const user = req.user!;
  // Administrative containers (excludeFromPortfolio) are out of ALL Overview
  // roll-ups — KPI counts and recent-lists included, not just the portfolio
  // block — so they can't inflate the dashboard they were flagged to leave.
  // (computePortfolioRows applies the same filter internally.)
  const baseScope: Prisma.ProjectWhereInput = {
    AND: [projectScope(user), { excludeFromPortfolio: false }],
  };
  // Person filters narrow projects: the TAM's own projects, and projects where
  // the assignee has an open task (top-level or subtask).
  const personClauses: Prisma.ProjectWhereInput[] = [];
  if (tamId !== undefined) personClauses.push({ tamId });
  if (assigneeId !== undefined) {
    personClauses.push({ tasks: { some: { assignedToId: assigneeId, status: { not: "DONE" } } } });
  }
  const scope: Prisma.ProjectWhereInput =
    personClauses.length === 0 ? baseScope : { AND: [baseScope, ...personClauses] };

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
  // Task tiles use only the TAM clause on the project (the assignee narrows
  // the tasks themselves, below). Visibility stays AND-composed, never spread.
  const projectWhere = projectVisibilityFilter(user);
  const taskProjectClauses: Prisma.ProjectWhereInput[] = [];
  if (Object.keys(projectWhere).length > 0) taskProjectClauses.push(projectWhere);
  if (tamId !== undefined) taskProjectClauses.push({ tamId });
  const taskListScope: Prisma.TaskWhereInput =
    taskProjectClauses.length === 0 ? {} : { project: { AND: taskProjectClauses } };
  // With an assignee filter the tiles count that person's tasks AND subtasks
  // (the /tasks list the tile opens includes subtasks then); otherwise
  // top-level tasks only, as before.
  const taskPersonWhere: Prisma.TaskWhereInput =
    assigneeId !== undefined ? { assignedToId: assigneeId } : { parentTaskId: null };
  const { projects: reviewProjects } = await resolveDailyReviewScope(user);

  const [
      projectCount,
      projectsByStatus,
      taskGroups,
      portfolio,
      overdue,
      dueThisWeek,
      openRisks,
      tamRows,
      assigneeRows,
    ] =
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
          ...taskPersonWhere,
          status: { not: "DONE" },
          dueDate: { lt: todayBoundary },
        },
      }),
      prisma.task.count({
        where: {
          ...taskListScope,
          ...taskPersonWhere,
          status: { not: "DONE" },
          dueDate: { gte: todayBoundary, lt: weekEnd },
        },
      }),
      prisma.risk.count({
        where: {
          status: "OPEN",
          project:
            personClauses.length === 0
              ? { id: { in: reviewProjects.map((p) => p.id) } }
              : { AND: [{ id: { in: reviewProjects.map((p) => p.id) } }, ...personClauses] },
        },
      }),
      // Picker options: TAMs and open-task assignees inside the caller's
      // visible scope (the same project scope the task tiles count, so anyone
      // counted can be picked). Never narrowed by the filters themselves.
      prisma.user.findMany({
        where: { projectsAsTAM: { some: projectWhere } },
        select: { id: true, username: true },
        orderBy: { username: "asc" },
      }),
      prisma.user.findMany({
        where: {
          assignedTasks: { some: { status: { not: "DONE" }, project: projectWhere } },
        },
        select: { id: true, username: true },
        orderBy: { username: "asc" },
      }),
    ]);
  const people = { tams: tamRows, assignees: assigneeRows };

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
    people,
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

  const { customers, projects, ownedCustomerIds } = await resolveDailyReviewScope(user);
  const inScope = new Set(customers.map((c) => c.id));
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
    if (reviewed.has(p.id)) continue;
    // A shared project is pending under EVERY in-scope customer it is linked to.
    for (const cid of groupCustomerIds(p, inScope, ownedCustomerIds)) pendingCustomers.add(cid);
  }

  res.json({ dailyReviewPending: pendingCustomers.size });
});
