import "./env.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectStatus, TaskStatus } from "@prisma/client";
import { prisma } from "../src/prisma.js";
import { computePortfolioRows } from "../src/lib/portfolio.js";
import { utcStartOfToday } from "../src/lib/dateBoundary.js";
import { seedRoles, createAdminAndToken } from "./testAuth.js";

// lib/portfolio.ts's isOverdue/daysOverdue. Real contract (2026-08-02 user
// ruling): overdue = due before the CALLER's calendar day (an optional
// `today` "yyyy-MM-dd" day string, threaded in by routes/overview.ts and
// routes/reports.ts's executive report from their own `?today=` query
// param), falling back to the server's UTC day when `today` is absent —
// see lib/dateBoundary.ts. Both routes and this function are sourced from
// the single dateBoundary.ts helper (overdueBoundary/utcStartOfToday/
// utcMidnightOf) rather than a duplicated derivation, so the UTC-fallback
// path is exercised under the full TZ matrix here (this file is the
// discriminating one — tasksOverdue.test.ts only needs enough TZ coverage
// to confirm the route delegates to the same helper). The `today`-override
// path is TZ-independent by construction (no local getters anywhere in the
// boundary code), so it's exercised once, under the host's ambient TZ, in
// its own describe block below. `today`'s shape validation (yyyy-MM-dd,
// calendrically valid) is the calling route's Zod schema's job, not this
// function's — see tasksOverdue.test.ts and portfolioRouteToday.test.ts for
// the 400-on-garbage coverage.

let ownerId: number;

async function createProjectWithDueTask(
  dueDate: Date | null,
  taskStatus: TaskStatus = "TODO",
  projectStatus: ProjectStatus = "ACTIVE",
): Promise<number> {
  const project = await prisma.project.create({
    data: {
      name: `Portfolio ${Date.now()}-${Math.random()}`,
      tamId: ownerId,
      status: projectStatus,
    },
  });
  await prisma.task.create({
    data: {
      projectId: project.id,
      title: "Task",
      status: taskStatus,
      dueDate,
    },
  });
  return project.id;
}

beforeAll(async () => {
  await seedRoles();
});

beforeEach(async () => {
  // Only the userId is used (to satisfy Project.tamId) — this suite
  // never makes an HTTP request, so the token itself (and its expiry) is
  // irrelevant here, unlike tasksOverdue.test.ts.
  const { userId } = await createAdminAndToken();
  ownerId = userId;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("computePortfolioRows — UTC-calendar-day isOverdue/daysOverdue boundary", () => {
  // Fixed "now": mid-day UTC on 2026-08-02 — the same fixture instant used
  // in tasksOverdue.test.ts so the two suites are directly comparable. Kept
  // close to the real authoring date only for readability; no HTTP/JWT
  // interaction happens in this file (computePortfolioRows is called
  // directly), so unlike tasksOverdue.test.ts there's no token-expiry
  // constraint on this value.
  const FIXED_NOW = new Date("2026-08-02T15:30:00.000Z");

  for (const tz of ["UTC", "Pacific/Kiritimati", "Etc/GMT+12"]) {
    describe(`under TZ=${tz}`, () => {
      let originalTz: string | undefined;

      beforeEach(() => {
        originalTz = process.env.TZ;
        process.env.TZ = tz;
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(FIXED_NOW);
      });

      afterEach(() => {
        vi.useRealTimers();
        if (originalTz === undefined) {
          delete process.env.TZ;
        } else {
          process.env.TZ = originalTz;
        }
      });

      it("a task due exactly at today's UTC midnight is NOT overdue", async () => {
        const projectId = await createProjectWithDueTask(new Date("2026-08-02T00:00:00.000Z"));
        const rows = await computePortfolioRows({ id: projectId });
        expect(rows).toHaveLength(1);
        expect(rows[0].isOverdue).toBe(false);
        expect(rows[0].daysOverdue).toBe(0);
      });

      it("a task due at yesterday's UTC midnight IS overdue with daysOverdue === 1", async () => {
        const projectId = await createProjectWithDueTask(new Date("2026-08-01T00:00:00.000Z"));
        const rows = await computePortfolioRows({ id: projectId });
        expect(rows[0].isOverdue).toBe(true);
        expect(rows[0].daysOverdue).toBe(1);
      });

      it("a task due 3 days ago yields daysOverdue === 3", async () => {
        const projectId = await createProjectWithDueTask(new Date("2026-07-30T00:00:00.000Z"));
        const rows = await computePortfolioRows({ id: projectId });
        expect(rows[0].isOverdue).toBe(true);
        expect(rows[0].daysOverdue).toBe(3);
      });

      it("a non-midnight due instant counts a full day overdue (due at 17:00Z yesterday -> daysOverdue === 1)", async () => {
        // Regression fixture: before the fix, daysOverdue floored
        // (startOfToday - endMs) directly, so a due instant only 7 hours
        // before today's UTC midnight (17:00Z yesterday -> 00:00Z today)
        // rounded DOWN to 0 days overdue even though the task's calendar day
        // (yesterday, per the frontend's UTC-date-part contract) is fully in
        // the past. endMs must be floored to its own UTC midnight first.
        const projectId = await createProjectWithDueTask(new Date("2026-08-01T17:00:00.000Z"));
        const rows = await computePortfolioRows({ id: projectId });
        expect(rows[0].isOverdue).toBe(true);
        expect(rows[0].daysOverdue).toBe(1);
      });

      it("a COMPLETED project's overdue-dated task never sets isOverdue", async () => {
        const projectId = await createProjectWithDueTask(
          new Date("2026-08-01T00:00:00.000Z"),
          "TODO",
          "COMPLETED",
        );
        const rows = await computePortfolioRows({ id: projectId });
        expect(rows[0].isOverdue).toBe(false);
      });

      it("uses the same utcStartOfToday() the route calls, structurally — 1ms either side of its boundary", async () => {
        // Imports and calls the exact function routes/tasks.ts's overdue
        // filter uses (lib/dateBoundary.ts), rather than re-deriving a
        // boundary from a hardcoded literal — so this test would catch a
        // future change to only one of the two call sites, not just a
        // change to the shared helper itself.
        const boundary = utcStartOfToday();
        const overdueProject = await createProjectWithDueTask(new Date(boundary.getTime() - 1));
        const notOverdueProject = await createProjectWithDueTask(boundary);
        const rows = await computePortfolioRows({
          id: { in: [overdueProject, notOverdueProject] },
        });
        const byId = new Map(rows.map((r) => [r.id, r]));
        expect(byId.get(overdueProject)?.isOverdue).toBe(true);
        expect(byId.get(notOverdueProject)?.isOverdue).toBe(false);
      });
    });
  }
});

describe("computePortfolioRows(where, today) — client-day override", () => {
  // Same UTC-day-boundary-adjacent instant as tasksOverdue.test.ts's
  // client-day describe block, so the two suites are directly comparable.
  const FIXED_NOW = new Date("2026-08-02T23:30:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIXED_NOW);
  });

  it("a supplied `today` one day ahead of the UTC fallback moves isOverdue", async () => {
    const projectId = await createProjectWithDueTask(new Date("2026-08-02T12:00:00.000Z"));

    const withoutToday = await computePortfolioRows({ id: projectId });
    expect(withoutToday[0].isOverdue).toBe(false); // UTC fallback: boundary Aug-2T00:00Z

    const withToday = await computePortfolioRows({ id: projectId }, "2026-08-03");
    expect(withToday[0].isOverdue).toBe(true); // client day: boundary Aug-3T00:00Z
    expect(withToday[0].daysOverdue).toBe(1);
  });

  it("absent `today` still falls back to the server's UTC day", async () => {
    const projectId = await createProjectWithDueTask(new Date("2026-08-01T23:59:59.999Z"));
    const rows = await computePortfolioRows({ id: projectId });
    expect(rows[0].isOverdue).toBe(true);
  });
});
