import "./env.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { seedRoles, createAdminAndToken } from "./testAuth.js";

// routes/overview.ts and routes/reports.ts's executive report both thread an
// optional `?today=` (the caller's client calendar day) into
// lib/portfolio.ts's computePortfolioRows — see lib/dateBoundary.ts for the
// full contract. The isOverdue/daysOverdue arithmetic for the override
// itself is already covered directly (no HTTP) in portfolioOverdue.test.ts;
// this file only proves the two ROUTES wire `today` through to that
// function and reject a garbage `today` with 400, same as
// tasksOverdue.test.ts does for /tasks?overdue=true.

const app = createApp();

let token: string;
let ownerId: number;

async function createProjectWithDueTask(dueDate: Date): Promise<number> {
  const project = await prisma.project.create({
    data: {
      name: `Portfolio route ${Date.now()}-${Math.random()}`,
      saId: ownerId,
      tamId: ownerId,
      status: "ACTIVE",
    },
  });
  await prisma.task.create({
    data: { projectId: project.id, title: "Task", status: "TODO", dueDate },
  });
  return project.id;
}

// Both routes' portfolio rows live under a different response key
// (`portfolio` for /overview, `projects` for /reports/executive) — this
// normalizes them for the shared assertions below.
function portfolioRows(body: unknown): Array<{ id: number; isOverdue: boolean }> {
  const b = body as { portfolio?: unknown; projects?: unknown };
  return (b.portfolio ?? b.projects) as Array<{ id: number; isOverdue: boolean }>;
}

beforeAll(async () => {
  await seedRoles();
});

beforeEach(async () => {
  // Admin: /reports/executive requires report:executive, which only the
  // seeded "*" wildcard satisfies. Neither route paginates its portfolio
  // block (no `take` on computePortfolioRows' query), so — unlike
  // /tasks?overdue=true — an org-wide token here carries no accumulation
  // risk; the fixture project is simply looked up by id in the response.
  const { userId, token: t } = await createAdminAndToken();
  ownerId = userId;
  token = t;
});

afterEach(() => {
  vi.useRealTimers();
});

// Same fixture instant used throughout this phase's date-boundary suites.
// Must stay within the JWT's expiry of real "now" — the token is signed
// under the real clock (before fake timers activate below); the `today`
// override itself is exercised via an explicit query param, not by moving
// the clock near a real midnight, so any instant on 2026-08-02 proves it.
const FIXED_NOW = new Date("2026-08-02T15:30:00.000Z");

describe.each([
  ["GET /overview", "/overview"],
  ["GET /reports/executive", "/reports/executive"],
])("%s — client-day ?today= wiring", (_label, path) => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIXED_NOW);
  });

  it("a supplied `today` one day ahead of the UTC fallback moves isOverdue", async () => {
    // Due at noon UTC on Aug 2 — NOT overdue against the UTC fallback
    // (boundary = Aug-2T00:00Z), but IS overdue against a client's Aug-3
    // day (boundary = Aug-3T00:00Z).
    const projectId = await createProjectWithDueTask(new Date("2026-08-02T12:00:00.000Z"));

    const without = await request(app).get(path).set("Authorization", `Bearer ${token}`);
    expect(without.status).toBe(200);
    expect(portfolioRows(without.body).find((r) => r.id === projectId)?.isOverdue).toBe(false);

    const withToday = await request(app)
      .get(`${path}?today=2026-08-03`)
      .set("Authorization", `Bearer ${token}`);
    expect(withToday.status).toBe(200);
    expect(portfolioRows(withToday.body).find((r) => r.id === projectId)?.isOverdue).toBe(true);
  });

  it("rejects a malformed `today` with 400", async () => {
    const res = await request(app)
      .get(`${path}?today=not-a-date`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("rejects a calendrically invalid `today` (month 13) with 400", async () => {
    const res = await request(app)
      .get(`${path}?today=2026-13-01`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("rejects a calendrically invalid `today` (Feb 30 — parses but doesn't round-trip) with 400", async () => {
    // See isValidDayString's doc comment (lib/dateBoundary.ts): a bare
    // Number.isNaN check on `new Date("2026-02-30T...")` would have let
    // this slip through, since JS silently rolls Feb 30 over to March 2
    // instead of producing an Invalid Date.
    const res = await request(app)
      .get(`${path}?today=2026-02-30`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});
