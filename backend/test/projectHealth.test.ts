import "./env.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { computeProjectHealth } from "../src/lib/projectHealth.js";
import { seedRoles, createUserWithRole } from "./testAuth.js";

// lib/projectHealth.ts + the `health` block on GET /projects, GET /projects/:id
// and the nested projects[] of GET /customers/:id. A TAM (not admin) is used
// throughout so the visibility filter scopes each response to this test's own
// projects, keeping the shared, never-truncated solvro_test DB out of the
// assertions.

const app = createApp();

let userId: number;
let token: string;

async function createProject(
  ownerId: number,
  extra: { customerId?: number; baselineLockedAt?: Date } = {},
): Promise<number> {
  const project = await prisma.project.create({
    data: {
      name: `Health ${Date.now()}-${Math.random()}`,
      tamId: ownerId,
      status: "ACTIVE",
      ...extra,
    },
  });
  return project.id;
}

async function createTask(
  projectId: number,
  o: {
    status?: "TODO" | "IN_PROGRESS" | "DONE";
    startDate?: Date | null;
    dueDate?: Date | null;
    baselineDueDate?: Date | null;
    parentTaskId?: number | null;
  } = {},
): Promise<number> {
  const task = await prisma.task.create({
    data: {
      projectId,
      title: "Task",
      status: o.status ?? "TODO",
      startDate: o.startDate ?? null,
      dueDate: o.dueDate ?? null,
      baselineDueDate: o.baselineDueDate ?? null,
      parentTaskId: o.parentTaskId ?? null,
    },
  });
  return task.id;
}

async function createRisk(projectId: number, status: "OPEN" | "MITIGATED" | "CLOSED") {
  await prisma.risk.create({
    data: { projectId, description: "Risk", probability: 3, impact: 3, status },
  });
}

interface HealthBody {
  progress: { done: number; total: number };
  overdueCount: number;
  openRiskCount: number;
  startDate: string | null;
  endDate: string | null;
  slipDays?: number | null;
}

async function healthOf(projectId: number, qs = ""): Promise<HealthBody> {
  const res = await request(app)
    .get(`/projects/${projectId}${qs}`)
    .set("Authorization", `Bearer ${token}`);
  expect(res.status).toBe(200);
  return (res.body as { health: HealthBody }).health;
}

beforeAll(async () => {
  await seedRoles();
});

beforeEach(async () => {
  const u = await createUserWithRole("TAM");
  userId = u.userId;
  token = u.token;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("computeProjectHealth — counts", () => {
  it("returns zeroed health for a project with no tasks or risks", async () => {
    const id = await createProject(userId);
    const map = await computeProjectHealth([id]);
    expect(map.get(id)).toEqual({
      progress: { done: 0, total: 0 },
      overdueCount: 0,
      openRiskCount: 0,
      startDate: null,
      endDate: null,
    });
  });

  it("returns an empty map for no ids without querying", async () => {
    expect((await computeProjectHealth([])).size).toBe(0);
  });

  it("progress counts every task, subtasks included", async () => {
    const id = await createProject(userId);
    const parent = await createTask(id, { status: "DONE" });
    await createTask(id, { status: "DONE", parentTaskId: parent });
    await createTask(id, { status: "TODO", parentTaskId: parent });
    await createTask(id, { status: "IN_PROGRESS" });
    const h = await healthOf(id);
    expect(h.progress).toEqual({ done: 2, total: 4 });
  });

  it("openRiskCount ignores MITIGATED and CLOSED risks", async () => {
    const id = await createProject(userId);
    await createRisk(id, "OPEN");
    await createRisk(id, "OPEN");
    await createRisk(id, "MITIGATED");
    await createRisk(id, "CLOSED");
    expect((await healthOf(id)).openRiskCount).toBe(2);
  });

  it("startDate is the min task startDate and endDate the max dueDate", async () => {
    const id = await createProject(userId);
    await createTask(id, {
      startDate: new Date("2026-03-10T00:00:00.000Z"),
      dueDate: new Date("2026-03-20T00:00:00.000Z"),
    });
    await createTask(id, {
      startDate: new Date("2026-02-01T00:00:00.000Z"),
      dueDate: new Date("2026-04-05T00:00:00.000Z"),
    });
    await createTask(id, { startDate: null, dueDate: null });
    const h = await healthOf(id);
    expect(h.startDate).toBe("2026-02-01");
    expect(h.endDate).toBe("2026-04-05");
  });

  it("start and end are null when no task is dated", async () => {
    const id = await createProject(userId);
    await createTask(id);
    const h = await healthOf(id);
    expect(h.startDate).toBeNull();
    expect(h.endDate).toBeNull();
  });

  it("keeps two projects' numbers separate in one call", async () => {
    const a = await createProject(userId);
    const b = await createProject(userId);
    await createTask(a, { status: "DONE" });
    await createTask(b);
    await createTask(b);
    await createRisk(b, "OPEN");
    const map = await computeProjectHealth([a, b]);
    expect(map.get(a)!.progress).toEqual({ done: 1, total: 1 });
    expect(map.get(a)!.openRiskCount).toBe(0);
    expect(map.get(b)!.progress).toEqual({ done: 0, total: 2 });
    expect(map.get(b)!.openRiskCount).toBe(1);
  });
});

describe("computeProjectHealth — overdue boundary", () => {
  // Fixed "now" within the JWT's lifetime (see tasksOverdue.test.ts).
  const FIXED_NOW = new Date("2026-08-02T15:30:00.000Z");

  for (const tz of ["UTC", "Asia/Jakarta", "America/Los_Angeles"]) {
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
        if (originalTz === undefined) delete process.env.TZ;
        else process.env.TZ = originalTz;
      });

      it("counts open tasks due before today's UTC midnight, not today's or later", async () => {
        const id = await createProject(userId);
        await createTask(id, { dueDate: new Date("2026-08-01T23:59:59.999Z") }); // overdue
        await createTask(id, { dueDate: new Date("2026-08-01T00:00:00.000Z") }); // overdue
        await createTask(id, { dueDate: new Date("2026-08-02T00:00:00.000Z") }); // today
        await createTask(id, { dueDate: new Date("2026-08-02T23:59:59.999Z") }); // today
        await createTask(id, { dueDate: null });
        expect((await healthOf(id)).overdueCount).toBe(2);
      });

      it("excludes DONE tasks", async () => {
        const id = await createProject(userId);
        await createTask(id, { status: "DONE", dueDate: new Date("2026-08-01T00:00:00.000Z") });
        await createTask(id, { status: "IN_PROGRESS", dueDate: new Date("2026-08-01T00:00:00.000Z") });
        expect((await healthOf(id)).overdueCount).toBe(1);
      });
    });
  }

  it("`today` moves the boundary to the caller's local day", async () => {
    const id = await createProject(userId);
    await createTask(id, { dueDate: new Date("2026-08-02T00:00:00.000Z") });
    expect((await healthOf(id, "?today=2026-08-02")).overdueCount).toBe(0);
    expect((await healthOf(id, "?today=2026-08-03")).overdueCount).toBe(1);
  });

  it("rejects an invalid `today` with 400", async () => {
    const id = await createProject(userId);
    const res = await request(app)
      .get(`/projects/${id}?today=2026-02-30`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
    const list = await request(app)
      .get("/projects?today=nope")
      .set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(400);
  });
});

describe("GET /projects — health", () => {
  it("attaches health to each visible project and only to those", async () => {
    const mine = await createProject(userId);
    await createTask(mine, { status: "DONE" });
    await createTask(mine);
    await createRisk(mine, "OPEN");

    const other = await createUserWithRole("TAM");
    const theirs = await createProject(other.userId);
    await createTask(theirs);

    const res = await request(app).get("/projects").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const rows = res.body as Array<{ id: number; health: HealthBody; _count: { tasks: number } }>;
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
    const row = rows.find((r) => r.id === mine)!;
    expect(row.health.progress).toEqual({ done: 1, total: 2 });
    expect(row.health.openRiskCount).toBe(1);
    // Existing fields stay intact (additive change).
    expect(row._count.tasks).toBe(2);
    expect(row.health).not.toHaveProperty("slipDays");
  });
});

describe("GET /projects/:id — health.slipDays", () => {
  it("is null without a baseline lock", async () => {
    const id = await createProject(userId);
    await createTask(id, { dueDate: new Date("2026-05-10T00:00:00.000Z") });
    expect((await healthOf(id)).slipDays).toBeNull();
  });

  it("is the whole-day gap between latest due and latest baseline due", async () => {
    const id = await createProject(userId, { baselineLockedAt: new Date("2026-05-01T00:00:00.000Z") });
    await createTask(id, {
      dueDate: new Date("2026-05-13T00:00:00.000Z"),
      baselineDueDate: new Date("2026-05-10T00:00:00.000Z"),
    });
    await createTask(id, {
      dueDate: new Date("2026-05-02T00:00:00.000Z"),
      baselineDueDate: new Date("2026-05-01T00:00:00.000Z"),
    });
    expect((await healthOf(id)).slipDays).toBe(3);
  });

  it("is null when the baseline is locked but no task carries a baseline due date", async () => {
    const id = await createProject(userId, { baselineLockedAt: new Date("2026-05-01T00:00:00.000Z") });
    await createTask(id, { dueDate: new Date("2026-05-13T00:00:00.000Z") });
    expect((await healthOf(id)).slipDays).toBeNull();
  });

  it("returns 404 for a project the caller cannot see", async () => {
    const other = await createUserWithRole("TAM");
    const theirs = await createProject(other.userId);
    const res = await request(app)
      .get(`/projects/${theirs}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe("GET /customers/:id — nested projects[] health", () => {
  it("attaches health to each nested project", async () => {
    const customer = await prisma.customer.create({
      data: { name: `Cust ${Date.now()}-${Math.random()}`, description: "d", tamId: userId },
    });
    const p1 = await createProject(userId, { customerId: customer.id });
    const p2 = await createProject(userId, { customerId: customer.id });
    await createTask(p1, { status: "DONE" });
    await createTask(p1);
    await createRisk(p2, "OPEN");

    const res = await request(app)
      .get(`/customers/${customer.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const projects = (res.body as { projects: Array<{ id: number; health: HealthBody }> }).projects;
    expect(projects).toHaveLength(2);
    expect(projects.find((p) => p.id === p1)!.health.progress).toEqual({ done: 1, total: 2 });
    expect(projects.find((p) => p.id === p2)!.health.openRiskCount).toBe(1);
  });
});
