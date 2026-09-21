import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { requireAuth, type JwtPayload } from "../http/auth.js";
import { validate } from "../http/validate.js";
import { projectVisibilityFilter } from "../lib/visibility.js";
import { computePortfolioRows } from "../lib/portfolio.js";
import { isValidDayString } from "../lib/dateBoundary.js";

export const overviewRouter = Router();

overviewRouter.use(requireAuth);

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

  const [projectCount, projectsByStatus, taskGroups, portfolio] =
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
  });
});
