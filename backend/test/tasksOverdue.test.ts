import "./env.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { seedRoles, createUserWithRole } from "./testAuth.js";

// GET /tasks?overdue=true (routes/tasks.ts). Real contract (2026-08-02 user
// ruling): overdue = due before the CALLER's calendar day (`?today=`,
// a "yyyy-MM-dd" day string), falling back to the server's UTC day when
// `today` is absent — see lib/dateBoundary.ts. DONE is always excluded, and
// an explicit `?status` filter narrows by intersection rather than being
// silently overwritten.
//
// The first describe block below exercises the UTC-fallback path (no
// `today`) under more than one process TZ to prove that fallback doesn't
// shift with the server's local timezone — the full TZ matrix (three zones)
// lives in portfolioOverdue.test.ts, so this file only needs enough
// coverage to confirm the route delegates to the shared helper. The blocks
// after it exercise the `today` override itself and the status
// intersection, both TZ-independent by construction (no local getters
// anywhere in the boundary code), so those run once under the host's
// ambient TZ.

const app = createApp();

let token: string;
let projectId: number;

// A TAM (not admin) scopes the visibility filter to `tamId === this user`,
// so GET /tasks (cross-project, no projectId filter) only ever returns this
// test's own project's tasks — avoiding the shared, never-truncated
// solvro_test DB's take-200 accumulation rot an admin token (project:
// view-all wildcard, sees every project ever created by every test file)
// would otherwise be exposed to. This also exercises the visibility path
// itself, not just the date boundary.
async function createProject(ownerUserId: number): Promise<number> {
  const project = await prisma.project.create({
    data: {
      name: `Project ${Date.now()}-${Math.random()}`,
      saId: ownerUserId,
      tamId: ownerUserId,
      status: "ACTIVE",
    },
  });
  return project.id;
}

async function createTask(overrides: {
  status?: "TODO" | "IN_PROGRESS" | "DONE";
  dueDate?: Date | null;
}): Promise<number> {
  const task = await prisma.task.create({
    data: {
      projectId,
      title: "Task",
      status: overrides.status ?? "TODO",
      dueDate: overrides.dueDate ?? null,
    },
  });
  return task.id;
}

async function listOverdueTaskIds(extraQs = ""): Promise<number[]> {
  const res = await request(app)
    .get(`/tasks?overdue=true${extraQs}`)
    .set("Authorization", `Bearer ${token}`);
  expect(res.status).toBe(200);
  return (res.body as Array<{ id: number }>).map((t) => t.id);
}

beforeAll(async () => {
  await seedRoles();
});

beforeEach(async () => {
  const { userId, token: t } = await createUserWithRole("TAM");
  token = t;
  projectId = await createProject(userId);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("/tasks?overdue=true — UTC-calendar-day boundary", () => {
  // Fixed "now": mid-day UTC on 2026-08-02, matching the real calendar date
  // this suite was authored on. Must stay within the JWT's expiry of real
  // "now" — the token above is signed under the real clock (before fake
  // timers activate below), so pinning FIXED_NOW far from the actual test
  // run date risks the request being rejected as using an already-expired
  // (or not-yet-valid) token.
  const FIXED_NOW = new Date("2026-08-02T15:30:00.000Z");

  // UTC plus one east-of-UTC zone (UTC+14, the most extreme real-world
  // offset) is enough here to prove the route delegates to the shared
  // utcStartOfToday() helper rather than a local getter; the full
  // west-and-east matrix is portfolioOverdue.test.ts's job.
  for (const tz of ["UTC", "Pacific/Kiritimati"]) {
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
        const id = await createTask({ dueDate: new Date("2026-08-02T00:00:00.000Z") });
        expect(await listOverdueTaskIds()).not.toContain(id);
      });

      it("a task due later today (23:59:59.999Z) is NOT overdue", async () => {
        const id = await createTask({ dueDate: new Date("2026-08-02T23:59:59.999Z") });
        expect(await listOverdueTaskIds()).not.toContain(id);
      });

      it("a task due yesterday, 1ms before today's UTC midnight, IS overdue", async () => {
        const id = await createTask({ dueDate: new Date("2026-08-01T23:59:59.999Z") });
        expect(await listOverdueTaskIds()).toContain(id);
      });

      it("a task due at yesterday's UTC midnight IS overdue", async () => {
        const id = await createTask({ dueDate: new Date("2026-08-01T00:00:00.000Z") });
        expect(await listOverdueTaskIds()).toContain(id);
      });

      it("a task with no dueDate is never overdue", async () => {
        const id = await createTask({ dueDate: null });
        expect(await listOverdueTaskIds()).not.toContain(id);
      });

      it("a DONE task due yesterday is excluded despite being past the boundary", async () => {
        const id = await createTask({
          status: "DONE",
          dueDate: new Date("2026-08-01T00:00:00.000Z"),
        });
        expect(await listOverdueTaskIds()).not.toContain(id);
      });
    });
  }
});

describe("/tasks?overdue=true&today= — client-day override", () => {
  // Same FIXED_NOW as the UTC-fallback describe block above (same
  // JWT-expiry constraint applies — see that block's comment). The `today`
  // override is exercised via an explicit query param below, not by moving
  // the clock near a real midnight, so any instant on 2026-08-02 works: a
  // TAM in Jakarta whose LOCAL day is already Aug 3 sends `today=2026-08-03`
  // regardless of what UTC hour the server's clock reads.
  const FIXED_NOW = new Date("2026-08-02T15:30:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIXED_NOW);
  });

  it("a supplied `today` one day ahead of the UTC fallback moves the boundary forward", async () => {
    // Due at noon UTC on Aug 2 — NOT overdue against the UTC fallback
    // (boundary = Aug-2T00:00Z, and noon is after midnight), but IS overdue
    // against the client's Aug-3 day (boundary = Aug-3T00:00Z).
    const id = await createTask({ dueDate: new Date("2026-08-02T12:00:00.000Z") });
    expect(await listOverdueTaskIds()).not.toContain(id); // no `today` -> UTC fallback
    expect(await listOverdueTaskIds("&today=2026-08-03")).toContain(id);
  });

  it("absent `today` still falls back to the server's UTC day", async () => {
    const id = await createTask({ dueDate: new Date("2026-08-01T23:59:59.999Z") });
    expect(await listOverdueTaskIds()).toContain(id);
  });

  it("rejects a malformed `today` (not yyyy-MM-dd) with 400", async () => {
    const res = await request(app)
      .get("/tasks?overdue=true&today=banana")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("rejects a calendrically invalid `today` (month 13) with 400", async () => {
    const res = await request(app)
      .get("/tasks?overdue=true&today=2026-13-01")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("rejects a calendrically invalid `today` (Feb 30 — parses but doesn't round-trip) with 400", async () => {
    // "2026-02-30" is the input class isValidDayString's round-trip check
    // exists for: new Date("2026-02-30T00:00:00.000Z") doesn't produce an
    // Invalid Date — JS silently rolls it over to March 2 — so a bare
    // Number.isNaN check would have let this slip through as "valid".
    const res = await request(app)
      .get("/tasks?overdue=true&today=2026-02-30")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});

describe("/tasks?overdue=true&status= — intersection, not overwrite", () => {
  const FIXED_NOW = new Date("2026-08-02T15:30:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIXED_NOW);
  });

  it("status=TODO&overdue=true returns an overdue TODO (the chip is no longer discarded)", async () => {
    const id = await createTask({
      status: "TODO",
      dueDate: new Date("2026-08-01T00:00:00.000Z"),
    });
    expect(await listOverdueTaskIds("&status=TODO")).toContain(id);
  });

  it("status=DONE&overdue=true is a contradiction and returns nothing, by construction", async () => {
    const id = await createTask({
      status: "DONE",
      dueDate: new Date("2026-08-01T00:00:00.000Z"),
    });
    expect(await listOverdueTaskIds("&status=DONE")).not.toContain(id);
  });

  it("status=IN_PROGRESS&overdue=true excludes an overdue TODO", async () => {
    const id = await createTask({
      status: "TODO",
      dueDate: new Date("2026-08-01T00:00:00.000Z"),
    });
    expect(await listOverdueTaskIds("&status=IN_PROGRESS")).not.toContain(id);
  });

  it("status=TODO alone (no overdue=true) still filters — locks the else-if(status) branch", async () => {
    // Moving the status assignment into `overdue ? ... : else if (status)`
    // must not silently drop plain status filtering when overdue isn't
    // requested at all — this has nothing to do with dueDate/overdue.
    const todoId = await createTask({ status: "TODO", dueDate: null });
    const doneId = await createTask({ status: "DONE", dueDate: null });
    const res = await request(app)
      .get("/tasks?status=TODO")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: number }>).map((t) => t.id);
    expect(ids).toContain(todoId);
    expect(ids).not.toContain(doneId);
  });
});
