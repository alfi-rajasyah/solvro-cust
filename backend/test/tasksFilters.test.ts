import "./env.js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { seedRoles, createUserWithRole } from "./testAuth.js";

// GET /tasks filters added for the work views: open, dueFrom/dueTo (inclusive
// day range), sort=due and the X-Total-Count header. A TAM token scopes the
// list to this test's own project, so the shared test DB's other rows never
// leak in (same approach as tasksOverdue.test.ts).

const app = createApp();

let token: string;
let projectId: number;

async function createTask(overrides: {
  title?: string;
  status?: "TODO" | "IN_PROGRESS" | "DONE";
  dueDate?: Date | null;
}): Promise<number> {
  const task = await prisma.task.create({
    data: {
      projectId,
      title: overrides.title ?? "Task",
      status: overrides.status ?? "TODO",
      dueDate: overrides.dueDate ?? null,
    },
  });
  return task.id;
}

async function get(qs: string) {
  return request(app).get(`/tasks${qs}`).set("Authorization", `Bearer ${token}`);
}

async function ids(qs: string): Promise<number[]> {
  const res = await get(qs);
  expect(res.status).toBe(200);
  return (res.body as Array<{ id: number }>).map((t) => t.id);
}

const d = (iso: string) => new Date(iso);

beforeAll(async () => {
  await seedRoles();
});

beforeEach(async () => {
  const { userId, token: t } = await createUserWithRole("TAM");
  token = t;
  const project = await prisma.project.create({
    data: { name: `Filters ${Date.now()}-${Math.random()}`, tamId: userId, status: "ACTIVE" },
  });
  projectId = project.id;
});

describe("GET /tasks?open", () => {
  it("open=true drops DONE tasks, open=false is a no-op", async () => {
    const todo = await createTask({ status: "TODO" });
    const doing = await createTask({ status: "IN_PROGRESS" });
    const done = await createTask({ status: "DONE" });

    expect((await ids("?open=true")).sort()).toEqual([todo, doing].sort());
    expect((await ids("?open=false")).sort()).toEqual([todo, doing, done].sort());
    expect((await ids("")).sort()).toEqual([todo, doing, done].sort());
  });

  it("rejects a non-boolean open value", async () => {
    const res = await get("?open=yes");
    expect(res.status).toBe(400);
  });
});

describe("GET /tasks?dueFrom&dueTo", () => {
  it("is inclusive on both days, including a non-midnight row on the last day", async () => {
    const before = await createTask({ dueDate: d("2026-09-27T23:59:59.000Z") });
    const first = await createTask({ dueDate: d("2026-09-28T00:00:00.000Z") });
    const mid = await createTask({ dueDate: d("2026-09-30T00:00:00.000Z") });
    const lastMidnight = await createTask({ dueDate: d("2026-10-04T00:00:00.000Z") });
    const lastLate = await createTask({ dueDate: d("2026-10-04T18:30:00.000Z") });
    const after = await createTask({ dueDate: d("2026-10-05T00:00:00.000Z") });
    const undated = await createTask({ dueDate: null });

    const got = await ids("?dueFrom=2026-09-28&dueTo=2026-10-04");
    expect(got.sort()).toEqual([first, mid, lastMidnight, lastLate].sort());
    for (const excluded of [before, after, undated]) expect(got).not.toContain(excluded);
  });

  it("dueFrom alone and dueTo alone are open-ended", async () => {
    const early = await createTask({ dueDate: d("2026-01-01T00:00:00.000Z") });
    const late = await createTask({ dueDate: d("2026-12-01T00:00:00.000Z") });
    expect(await ids("?dueFrom=2026-06-01")).toEqual([late]);
    expect(await ids("?dueTo=2026-06-01")).toEqual([early]);
  });

  it("a single-day range (dueFrom == dueTo) returns that day", async () => {
    const onDay = await createTask({ dueDate: d("2026-09-28T09:00:00.000Z") });
    await createTask({ dueDate: d("2026-09-29T00:00:00.000Z") });
    expect(await ids("?dueFrom=2026-09-28&dueTo=2026-09-28")).toEqual([onDay]);
  });

  it("returns 400 validation_error when dueFrom is after dueTo", async () => {
    const res = await get("?dueFrom=2026-10-05&dueTo=2026-10-04");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation_error");
  });

  it("returns 400 for a malformed or impossible day", async () => {
    expect((await get("?dueFrom=2026-02-30")).status).toBe(400);
    expect((await get("?dueTo=tomorrow")).status).toBe(400);
  });
});

describe("GET /tasks?sort", () => {
  it("sort=due orders soonest first with undated tasks last", async () => {
    const undated = await createTask({ dueDate: null });
    const later = await createTask({ dueDate: d("2026-11-01T00:00:00.000Z") });
    const sooner = await createTask({ dueDate: d("2026-09-01T00:00:00.000Z") });
    expect(await ids("?sort=due")).toEqual([sooner, later, undated]);
  });

  it("default and sort=position keep board order (position, then id)", async () => {
    const a = await createTask({ dueDate: d("2026-11-01T00:00:00.000Z") });
    const b = await createTask({ dueDate: d("2026-09-01T00:00:00.000Z") });
    expect(await ids("")).toEqual([a, b]);
    expect(await ids("?sort=position")).toEqual([a, b]);
  });

  it("rejects an unknown sort key", async () => {
    expect((await get("?sort=title")).status).toBe(400);
  });
});

describe("GET /tasks — filters compose through AND", () => {
  it("overdue + status + open + a due range intersect without clobbering", async () => {
    const today = "2026-09-29";
    // Every row is overdue relative to `today` unless noted.
    const match = await createTask({ status: "TODO", dueDate: d("2026-09-20T00:00:00.000Z") });
    await createTask({ status: "IN_PROGRESS", dueDate: d("2026-09-20T00:00:00.000Z") }); // wrong status
    await createTask({ status: "DONE", dueDate: d("2026-09-20T00:00:00.000Z") }); // done
    await createTask({ status: "TODO", dueDate: d("2026-09-10T00:00:00.000Z") }); // before range
    await createTask({ status: "TODO", dueDate: d("2026-09-29T00:00:00.000Z") }); // not overdue
    await createTask({ status: "TODO", dueDate: null });

    expect(
      await ids(
        `?overdue=true&status=TODO&open=true&dueFrom=2026-09-15&dueTo=2026-09-28&today=${today}`,
      ),
    ).toEqual([match]);
  });

  it("status=DONE with open=true is a contradiction and returns nothing", async () => {
    await createTask({ status: "DONE" });
    await createTask({ status: "TODO" });
    expect(await ids("?status=DONE&open=true")).toEqual([]);
  });

  it("status alone still filters (no overdue)", async () => {
    await createTask({ status: "TODO" });
    const done = await createTask({ status: "DONE" });
    expect(await ids("?status=DONE")).toEqual([done]);
  });
});

describe("GET /tasks — X-Total-Count", () => {
  it("equals the full match count while the body is capped at 200", async () => {
    await prisma.task.createMany({
      data: Array.from({ length: 205 }, (_, i) => ({
        projectId,
        title: `Bulk ${i}`,
        status: "TODO" as const,
        position: i,
      })),
    });
    await prisma.task.create({ data: { projectId, title: "Done one", status: "DONE" } });

    const all = await get("");
    expect(all.status).toBe(200);
    expect(all.body).toHaveLength(200);
    expect(all.headers["x-total-count"]).toBe("206");

    const open = await get("?open=true");
    expect(open.body).toHaveLength(200);
    expect(open.headers["x-total-count"]).toBe("205");
  });

  it("is present and 0 for an empty result", async () => {
    const res = await get("?open=true");
    expect(res.body).toEqual([]);
    expect(res.headers["x-total-count"]).toBe("0");
  });
});
