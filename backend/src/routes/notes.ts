import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth, requirePermission } from "../http/auth.js";
import { validate } from "../http/validate.js";
import { customerVisibilityFilter, projectVisibilityFilter } from "../lib/visibility.js";
import { isValidDayString, utcMidnightOfDayString, utcStartOfToday } from "../lib/dateBoundary.js";

// Cross-customer "Recent notes" feed for the Overview page: the newest daily
// notes — project notes and operations (customer) notes — across everything
// the caller can see, over the last RECENT_NOTES_DAYS calendar days ending
// on the caller's `today`. Read-only and in-app only: the INTERNAL-notes
// guardrail (INTERNAL notes never reach an export or customer-facing
// output) is untouched — this feed has the same audience as the Daily
// Review that writes the notes.
//
// Scope reuses lib/visibility.ts's two filters verbatim (never re-derived):
// project notes where the project is visible, operations notes where the
// customer is visible — and nothing narrower. In particular, projects
// flagged excludeFromPortfolio are NOT filtered out here: that flag is a
// metrics rule for the portfolio roll-ups (lib/portfolio.ts), while this is
// a content feed, and the Daily Review lets you write a note on any ACTIVE
// project you can see, containers included — a note written there must
// show up here.

const RECENT_NOTES_DAYS = 7;
const RECENT_NOTES_LIMIT = 20;

const recentNotesQuerySchema = z.object({
  // Caller's local calendar day ("yyyy-MM-dd") — the last day of the window.
  // Optional, like every other `today`-taking route (see lib/dateBoundary.ts):
  // a caller that omits it gets the server's UTC day.
  today: z
    .string()
    .refine(isValidDayString, { message: "today must be a valid yyyy-MM-dd date" })
    .optional(),
});

/** "yyyy-MM-dd" of a `@db.Date` column's UTC-midnight instant. */
function dayOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const notesRouter = Router();

// `project:read` gate (2026-10 security hardening): the feed aggregates notes
// a caller could not read one by one — a PENDING account (no permissions)
// used to read operations notes on unowned customers here while
// GET /customers/:id/notes refused it. Same gate as the direct routes.
notesRouter.use(requireAuth, requirePermission("project:read"));

notesRouter.get(
  "/recent",
  validate("query", recentNotesQuerySchema),
  async (req, res) => {
    const { today } = req.query as unknown as z.infer<typeof recentNotesQuerySchema>;
    const user = req.user!;

    const to = today ? utcMidnightOfDayString(today) : utcStartOfToday();
    const from = new Date(to.getTime() - (RECENT_NOTES_DAYS - 1) * 86_400_000);
    const noteDate = { gte: from, lte: to };

    // Each side is capped at the feed limit on its own; the merge below
    // re-sorts and re-caps, so the result is exactly the newest N across
    // both tables (never N project notes + N operations notes).
    const [projectNotes, customerNotes] = await Promise.all([
      prisma.projectNote.findMany({
        where: { noteDate, project: projectVisibilityFilter(user) },
        // `id` tiebreaker (as in every other note query) keeps the `take`
        // boundary deterministic when a batch write shares noteDate + updatedAt.
        orderBy: [{ noteDate: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
        take: RECENT_NOTES_LIMIT,
        select: {
          id: true,
          noteDate: true,
          body: true,
          updatedAt: true,
          author: { select: { id: true, username: true } },
          project: {
            select: { id: true, name: true, customer: { select: { id: true, name: true } } },
          },
        },
      }),
      prisma.customerNote.findMany({
        where: { noteDate, customer: customerVisibilityFilter(user) },
        orderBy: [{ noteDate: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
        take: RECENT_NOTES_LIMIT,
        select: {
          id: true,
          noteDate: true,
          body: true,
          title: true,
          updatedAt: true,
          author: { select: { id: true, username: true } },
          customer: { select: { id: true, name: true } },
        },
      }),
    ]);

    const notes = [
      ...projectNotes.map((n) => ({
        kind: "project" as const,
        id: n.id,
        noteDate: n.noteDate,
        body: n.body,
        title: null,
        author: n.author,
        project: { id: n.project.id, name: n.project.name },
        customer: n.project.customer,
        updatedAt: n.updatedAt,
      })),
      ...customerNotes.map((n) => ({
        kind: "operations" as const,
        id: n.id,
        noteDate: n.noteDate,
        body: n.body,
        title: n.title,
        author: n.author,
        project: null,
        customer: n.customer,
        updatedAt: n.updatedAt,
      })),
    ]
      .sort(
        (a, b) =>
          b.noteDate.getTime() - a.noteDate.getTime() ||
          b.updatedAt.getTime() - a.updatedAt.getTime() ||
          b.id - a.id,
      )
      .slice(0, RECENT_NOTES_LIMIT);

    res.json({ from: dayOf(from), to: dayOf(to), notes });
  },
);
