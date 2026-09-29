import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth } from "../http/auth.js";
import { validate } from "../http/validate.js";
import { resolveDailyReviewScope } from "../lib/dailyReviewScope.js";
import {
  isValidDayString,
  overdueBoundary,
  utcMidnightOfDayString,
} from "../lib/dateBoundary.js";
import { parseWeekKey } from "../lib/isoWeek.js";
import { computeSlipDays, currentPhase } from "../lib/projectHealth.js";

// One-request payload for the Daily Review page (spec §5.1). Every
// sub-collection is fetched with a single batched `findMany` keyed by an
// `in` list of ids computed from the in-scope project/customer set — never
// a per-project or per-customer query — so the request stays O(1) queries
// regardless of how many active projects/customers are in scope (backend
// NFR: sub-200ms).

const WEEK_KEY_FORMAT = /^\d{4}-W\d{2}$/;

const dailyReviewQuerySchema = z.object({
  week: z
    .string()
    .refine((w) => WEEK_KEY_FORMAT.test(w), { message: "invalid_week" })
    .refine((w) => parseWeekKey(w) !== null, { message: "invalid_week" }),
  today: z.string().refine(isValidDayString, { message: "invalid_today" }),
});

function groupBy<T, K>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }
  return map;
}

/** "yyyy-MM-dd" of a `@db.Date` column's UTC-midnight instant. */
function dayOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const dailyReviewRouter = Router();

dailyReviewRouter.use(requireAuth);

dailyReviewRouter.get(
  "/",
  validate("query", dailyReviewQuerySchema),
  async (req, res) => {
    const { week: weekKey, today } = req.query as unknown as z.infer<
      typeof dailyReviewQuerySchema
    >;
    // Already validated non-null by the query schema's second refine.
    const week = parseWeekKey(weekKey)!;
    const user = req.user!;

    const weekStartDate = utcMidnightOfDayString(week.start);
    const weekEndDate = utcMidnightOfDayString(week.days[6]);
    const overdueBoundaryDate = overdueBoundary(today);
    // D9 (Mid-week carry-over): the Monday exactly 7 days before this
    // week's, computed on weekStartDate's own UTC-midnight instant (never
    // local-time arithmetic) so it stays a valid @db.Date value.
    const previousWeekStartDate = new Date(
      Date.UTC(
        weekStartDate.getUTCFullYear(),
        weekStartDate.getUTCMonth(),
        weekStartDate.getUTCDate() - 7,
      ),
    );

    // Customer-first scope (Decisions 8-10) — shared with GET /overview/badges;
    // see lib/dailyReviewScope.ts.
    const { customers, projects } = await resolveDailyReviewScope(user);
    const projectIds = projects.map((p) => p.id);
    const customerIds = customers.map((c) => c.id);

    const [tasks, risks, projectNotes, reviews] = await Promise.all([
      prisma.task.findMany({
        where: { projectId: { in: projectIds } },
        select: {
          id: true,
          projectId: true,
          title: true,
          status: true,
          dueDate: true,
          baselineDueDate: true,
          section: { select: { id: true, name: true, position: true } },
        },
      }),
      prisma.risk.findMany({
        where: { projectId: { in: projectIds }, status: "OPEN" },
        select: {
          id: true,
          projectId: true,
          description: true,
          probability: true,
          impact: true,
          status: true,
        },
      }),
      prisma.projectNote.findMany({
        where: {
          projectId: { in: projectIds },
          noteDate: { gte: weekStartDate, lte: weekEndDate },
        },
        orderBy: [{ noteDate: "asc" }, { id: "asc" }],
        select: {
          id: true,
          projectId: true,
          noteDate: true,
          body: true,
          updatedAt: true,
          author: { select: { id: true, username: true } },
        },
      }),
      prisma.projectReview.findMany({
        where: {
          projectId: { in: projectIds },
          userId: user.sub,
          reviewDate: { gte: weekStartDate, lte: weekEndDate },
        },
        select: { projectId: true, reviewDate: true, createdAt: true },
      }),
    ]);

    const [customerNotes, weeklyUpdates, previousWeeklyUpdates] = await Promise.all([
      prisma.customerNote.findMany({
        where: {
          customerId: { in: customerIds },
          noteDate: { gte: weekStartDate, lte: weekEndDate },
        },
        orderBy: [{ noteDate: "asc" }, { id: "asc" }],
        select: {
          id: true,
          customerId: true,
          noteDate: true,
          body: true,
          title: true,
          updatedAt: true,
          author: { select: { id: true, username: true } },
        },
      }),
      // Mid-week highlights: a relation `select` on this same batched
      // findMany costs one extra query for the whole page (Prisma issues a
      // second `SELECT ... WHERE weekly_update_id IN (...)`), not one per
      // row — the per-request call count stays fixed regardless of page size.
      prisma.weeklyUpdate.findMany({
        where: { customerId: { in: customerIds }, weekStart: weekStartDate },
        select: {
          id: true,
          customerId: true,
          weekStart: true,
          health: true,
          status: true,
          doneAt: true,
          category: true,
          highlights: {
            orderBy: { position: "asc" },
            select: { id: true, position: true, title: true, detail: true, risk: true, action: true },
          },
          // Reflection achievements: another relation `select` on this same
          // batched findMany — one extra query for the whole page (same
          // amortised-cost note as `highlights` above), not one per row.
          achievements: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              position: true,
              title: true,
              detail: true,
              outstandingIssue: true,
              lessonLearned: true,
              nextWeekFocus: true,
              managerDecision: true,
            },
          },
          midweekSavedAt: true,
          updatedAt: true,
          author: { select: { id: true, username: true } },
        },
      }),
      // D9/D11: last Friday's carry-over achievements for the Mid-week
      // modal's "From last Friday" panel — one extra batched findMany over
      // the same customerIds, keeping the per-request query count fixed
      // regardless of page size.
      prisma.weeklyUpdate.findMany({
        where: { customerId: { in: customerIds }, weekStart: previousWeekStartDate },
        select: {
          customerId: true,
          weekStart: true,
          achievements: {
            orderBy: { position: "asc" },
            select: {
              title: true,
              outstandingIssue: true,
              nextWeekFocus: true,
              managerDecision: true,
            },
          },
        },
      }),
    ]);

    // --- Assemble per-project DTOs, then bucket them under their customer
    // (or unassignedProjects) and fold in the week's coverage counts.

    const tasksByProject = groupBy(tasks, (t) => t.projectId);
    const risksByProject = groupBy(risks, (r) => r.projectId);
    const notesByProject = groupBy(projectNotes, (n) => n.projectId);
    const reviewsByProject = groupBy(reviews, (r) => r.projectId);

    const projectDtos = projects.map((p) => {
      const projectTasks = tasksByProject.get(p.id) ?? [];
      const projectRisks = risksByProject.get(p.id) ?? [];
      const projectNotesForProject = notesByProject.get(p.id) ?? [];
      const projectReviews = reviewsByProject.get(p.id) ?? [];
      const total = projectTasks.length;
      const done = projectTasks.filter((t) => t.status === "DONE").length;

      return {
        id: p.id,
        name: p.name,
        status: p.status,
        customerId: p.customerId,
        baselineLockedAt: p.baselineLockedAt,
        phase: currentPhase(projectTasks),
        progress: { done, total },
        slipDays: computeSlipDays(p.baselineLockedAt, projectTasks),
        overdueTasks: projectTasks
          .filter(
            (t) =>
              t.status !== "DONE" &&
              t.dueDate !== null &&
              t.dueDate.getTime() < overdueBoundaryDate.getTime(),
          )
          .map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate, status: t.status })),
        openRisks: projectRisks.map((r) => ({
          id: r.id,
          description: r.description,
          probability: r.probability,
          impact: r.impact,
          status: r.status,
        })),
        notes: projectNotesForProject.map((n) => ({
          id: n.id,
          noteDate: n.noteDate,
          body: n.body,
          author: n.author,
          updatedAt: n.updatedAt,
        })),
        reviews: projectReviews.map((r) => ({
          reviewDate: r.reviewDate,
          createdAt: r.createdAt,
        })),
      };
    });

    const projectsByCustomerId = groupBy(
      projectDtos.filter((p) => p.customerId !== null),
      (p) => p.customerId as number,
    );
    const unassignedProjects = projectDtos.filter((p) => p.customerId === null);

    const customerNotesByCustomer = groupBy(customerNotes, (n) => n.customerId);
    const weeklyUpdateByCustomer = new Map(weeklyUpdates.map((wu) => [wu.customerId, wu]));
    const previousWeeklyUpdateByCustomer = new Map(
      previousWeeklyUpdates.map((wu) => [wu.customerId, wu]),
    );

    const customerDtos = customers.map((c) => {
      const weeklyUpdate = weeklyUpdateByCustomer.get(c.id);
      const previousWeeklyUpdate = previousWeeklyUpdateByCustomer.get(c.id);
      return {
        id: c.id,
        name: c.name,
        tam: c.tam,
        projects: projectsByCustomerId.get(c.id) ?? [],
        operationsNotes: (customerNotesByCustomer.get(c.id) ?? []).map((n) => ({
          id: n.id,
          noteDate: n.noteDate,
          body: n.body,
          title: n.title,
          author: n.author,
          updatedAt: n.updatedAt,
        })),
        weeklyUpdate: weeklyUpdate
          ? {
              id: weeklyUpdate.id,
              weekStart: weeklyUpdate.weekStart,
              health: weeklyUpdate.health,
              status: weeklyUpdate.status,
              doneAt: weeklyUpdate.doneAt,
              category: weeklyUpdate.category,
              highlights: weeklyUpdate.highlights,
              achievements: weeklyUpdate.achievements,
              midweekSavedAt: weeklyUpdate.midweekSavedAt,
              author: weeklyUpdate.author,
              updatedAt: weeklyUpdate.updatedAt,
            }
          : null,
        // D9/D11: last Friday's carry-over for the Mid-week modal's "From
        // last Friday" panel — only the achievement rows that still carry an
        // open item (an outstanding issue, a next-week focus, or a decision)
        // are worth showing; a row with none of the three (e.g. only a
        // lesson learned) is filtered out here rather than on the client.
        previousWeeklyUpdate: previousWeeklyUpdate
          ? {
              weekStart: previousWeeklyUpdate.weekStart,
              achievements: previousWeeklyUpdate.achievements.filter(
                (a) =>
                  a.outstandingIssue !== null ||
                  a.nextWeekFocus !== null ||
                  a.managerDecision !== null,
              ),
            }
          : null,
      };
    });

    // Decision 20: coverage counts customers, not projects. total = number
    // of customers on the page (customerDtos.length) — the "No customer"
    // group is excluded, since it has no customer entity to count. Built
    // from customerDtos (not projectNotes/customerNotes directly) so only a
    // customer's own projects — already scoped to that customer via
    // projectsByCustomerId — are checked; an unassigned project's note
    // never counts. A customer with two projects both noted the same day
    // still counts once (Set, not a sum).
    const coverage: Record<string, { withNote: number; total: number }> = {};
    for (const day of week.days) coverage[day] = { withNote: 0, total: customerDtos.length };
    for (const c of customerDtos) {
      const daysWithNote = new Set<string>();
      for (const p of c.projects) {
        for (const n of p.notes) daysWithNote.add(dayOf(n.noteDate));
      }
      for (const n of c.operationsNotes) daysWithNote.add(dayOf(n.noteDate));
      for (const day of daysWithNote) {
        if (coverage[day]) coverage[day].withNote++;
      }
    }

    res.json({
      week,
      today,
      coverage,
      customers: customerDtos,
      unassignedProjects,
    });
  },
);
