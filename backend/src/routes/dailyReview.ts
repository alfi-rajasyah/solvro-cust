import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { hasPermission, requireAuth } from "../http/auth.js";
import { validate } from "../http/validate.js";
import { customerVisibilityFilter, projectVisibilityFilter } from "../lib/visibility.js";
import {
  isValidDayString,
  overdueBoundary,
  utcMidnightOfDayString,
} from "../lib/dateBoundary.js";
import { parseWeekKey } from "../lib/isoWeek.js";

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

// --- Ports of frontend/src/pages/DailyReview.tsx's currentPhase() /
// scheduleSignal() (lines 254-292 as of the v1 page), computed server-side
// so the payload ships the finished value instead of raw task lists.

interface PhaseTask {
  status: string;
  section: { id: number; name: string; position: number } | null;
}

// Earliest section (by position) that still has a non-DONE task. Mirrors
// currentPhase() in the frontend exactly, including the two terminal
// strings ("All phases complete" when every section is done, "—" when the
// project has no sections at all).
function currentPhase(tasks: PhaseTask[]): string {
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

interface SlipTask {
  dueDate: Date | null;
  baselineDueDate: Date | null;
}

// Mirrors scheduleSignal()'s slip math, minus the label/tone — the frontend
// derives its own chip from this number. null whenever there is no baseline
// lock, or either side of the comparison has no dated tasks.
function computeSlipDays(baselineLockedAt: Date | null, tasks: SlipTask[]): number | null {
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
    // hasPermission treats "*" as satisfying every permission check, so this
    // single predicate also covers wildcard (ADMIN) users — see
    // lib/visibility.ts's projectVisibilityFilter, which the same check
    // gates internally.
    const viewAll = hasPermission(user, "project:view-all");

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

    // Decisions 8-9 (customer-visibility-spec.md §5.3): customer-first
    // scope, replacing the old project-first Decisions 13/14. First resolve
    // the customers on the page — a TAM's owned customers (tamId = me;
    // view-all: every customer with a TAM set) plus any customer with at
    // least one ACTIVE project visible to the caller (the "attached" tier,
    // via projectVisibilityFilter so a project TAM on someone else's
    // customer still reaches it) — then split them into owned vs. attached
    // so the project query below can apply Decision 9's two-tier rule.
    // AND-composed (not object-spread) so customerVisibilityFilter's own
    // keys can never collide with or be silently overwritten by a sibling
    // condition — same pattern as projectWhere below.
    const customerWhere: Prisma.CustomerWhereInput = {
      AND: [
        customerVisibilityFilter(user),
        {
          OR: [
            viewAll ? { tamId: { not: null } } : { tamId: user.sub },
            {
              projects: {
                some: { AND: [{ status: "ACTIVE" }, projectVisibilityFilter(user)] },
              },
            },
          ],
        },
      ],
    };

    const candidateCustomers = await prisma.customer.findMany({
      where: customerWhere,
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        tam: { select: { id: true, username: true } },
      },
    });
    const candidateCustomerIds = candidateCustomers.map((c) => c.id);

    // Decision 9: split into owned (tamId = me; view-all: every customer
    // resolved above) vs. attached (visible only through a project) — the
    // project query below treats the two tiers differently, and the
    // post-projects prune further down uses ownedIdSet to decide which
    // attached customers actually survive onto the page.
    const ownedIds = viewAll
      ? candidateCustomerIds
      : candidateCustomers.filter((c) => c.tam?.id === user.sub).map((c) => c.id);
    const ownedIdSet = new Set(ownedIds);
    const attachedIds = candidateCustomerIds.filter((id) => !ownedIdSet.has(id));

    // Decision 9: ACTIVE projects in scope. Owned customer → every ACTIVE
    // project of that customer, whoever the project TAM is. Attached
    // customer → only the caller's own ACTIVE projects (the old Decision 13
    // rule). Decision 10: the "No customer" group is unchanged — ACTIVE
    // projects with customerId: null and Project.tamId = me. AND-composed
    // (not object-spread) so a sibling condition can never collide with or
    // silently overwrite another — same pattern as routes/overview.ts's
    // `scope`.
    const projectWhere: Prisma.ProjectWhereInput = viewAll
      ? { status: "ACTIVE" }
      : {
          AND: [
            { status: "ACTIVE" },
            {
              OR: [
                { customerId: { in: ownedIds } },
                { tamId: user.sub, customerId: { in: attachedIds } },
                { tamId: user.sub, customerId: null },
              ],
            },
          ],
        };

    const projects = await prisma.project.findMany({
      where: projectWhere,
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        status: true,
        customerId: true,
        baselineLockedAt: true,
      },
    });
    const projectIds = projects.map((p) => p.id);

    // Decision 9 (fix): an ATTACHED customer surfaces only when it actually
    // has a project in the result above — the customer query's "attached"
    // OR arm admits a customer via ANY project matching
    // projectVisibilityFilter, while the project query above only pulls the
    // caller's own (tamId) projects for an attached customer. Without this
    // prune, a customer the caller can't actually see any project of would
    // render as an empty group and inflate coverage.total. Owned customers
    // always stay, even with zero active projects — they still carry
    // operations notes and the weekly update (Decision 8).
    const projectCustomerIds = new Set(
      projects.map((p) => p.customerId).filter((id): id is number => id !== null),
    );
    const customers = candidateCustomers.filter(
      (c) => ownedIdSet.has(c.id) || projectCustomerIds.has(c.id),
    );
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
