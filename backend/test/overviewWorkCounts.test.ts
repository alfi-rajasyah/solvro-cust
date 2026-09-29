import "./env.js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { seedRoles, createUserWithRole } from "./testAuth.js";

// GET /overview -> workCounts { overdue, dueThisWeek, openRisks }. `today` is
// pinned to Tuesday 2026-09-29, so the ISO week ends on Sunday 2026-10-04.
// A TAM token scopes every count to this test's own projects. Definitions
// mirror the lists the tiles open: overdue / due this week = top-level tasks
// across every visible project (as GET /tasks?topLevel=true), open risks =
// OPEN risks on the Daily Review project scope (ACTIVE, lib/dailyReviewScope).

const app = createApp();
const TODAY = "2026-09-29";
const d = (iso: string) => new Date(iso);

let token: string;
let userId: number;
let projectId: number;

async function task(
  status: "TODO" | "IN_PROGRESS" | "DONE",
  dueDate: Date | null,
  pid = projectId,
) {
  return prisma.task.create({ data: { projectId: pid, title: "T", status, dueDate } });
}

async function workCounts(qs = `?today=${TODAY}`) {
  const res = await request(app).get(`/overview${qs}`).set("Authorization", `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body.workCounts as { overdue: number; dueThisWeek: number; openRisks: number };
}

beforeAll(async () => {
  await seedRoles();
});

beforeEach(async () => {
  const u = await createUserWithRole("TAM");
  token = u.token;
  userId = u.userId;
  const p = await prisma.project.create({
    data: { name: `Overview ${Date.now()}-${Math.random()}`, tamId: userId, status: "ACTIVE" },
  });
  projectId = p.id;
});

describe("GET /overview workCounts", () => {
  it("is all zeros for a caller with nothing in scope", async () => {
    expect(await workCounts()).toEqual({ overdue: 0, dueThisWeek: 0, openRisks: 0 });
  });

  it("overdue counts open tasks due before today, excluding DONE, today and undated", async () => {
    await task("TODO", d("2026-09-28T00:00:00.000Z"));
    await task("IN_PROGRESS", d("2026-01-01T00:00:00.000Z"));
    await task("DONE", d("2026-09-01T00:00:00.000Z"));
    await task("TODO", d("2026-09-29T00:00:00.000Z")); // today is not overdue
    await task("TODO", null);
    expect((await workCounts()).overdue).toBe(2);
  });

  it("counts top-level tasks only: an overdue or due-this-week subtask is ignored", async () => {
    const parent = await task("TODO", null);
    for (const dueDate of ["2026-09-20T00:00:00.000Z", "2026-09-30T00:00:00.000Z"]) {
      await prisma.task.create({
        data: {
          projectId,
          title: "Sub",
          status: "TODO",
          dueDate: d(dueDate),
          parentTaskId: parent.id,
        },
      });
    }
    await task("TODO", d("2026-09-20T00:00:00.000Z"));
    expect(await workCounts()).toMatchObject({ overdue: 1, dueThisWeek: 0 });
  });

  it("dueThisWeek runs from today through Sunday, inclusive, open tasks only", async () => {
    await task("TODO", d("2026-09-28T00:00:00.000Z")); // Monday, already past
    await task("TODO", d("2026-09-29T00:00:00.000Z")); // today
    await task("IN_PROGRESS", d("2026-10-04T00:00:00.000Z")); // Sunday
    await task("TODO", d("2026-10-04T20:00:00.000Z")); // Sunday, non-midnight row
    await task("TODO", d("2026-10-05T00:00:00.000Z")); // next Monday
    await task("DONE", d("2026-09-30T00:00:00.000Z")); // done
    await task("TODO", null);
    const counts = await workCounts();
    expect(counts.dueThisWeek).toBe(3);
    expect(counts.overdue).toBe(1);
  });

  it("on a Sunday, the week is just that day", async () => {
    await task("TODO", d("2026-10-04T00:00:00.000Z"));
    await task("TODO", d("2026-10-05T00:00:00.000Z"));
    expect((await workCounts("?today=2026-10-04")).dueThisWeek).toBe(1);
  });

  it("openRisks counts OPEN risks only", async () => {
    const base = { projectId, description: "r" };
    await prisma.risk.create({ data: { ...base, status: "OPEN" } });
    await prisma.risk.create({ data: { ...base, status: "OPEN" } });
    await prisma.risk.create({ data: { ...base, status: "MITIGATED" } });
    await prisma.risk.create({ data: { ...base, status: "CLOSED" } });
    expect((await workCounts()).openRisks).toBe(2);
  });

  it("task counts cover every visible project, excluded-from-portfolio ones too, but not other users'", async () => {
    const other = await createUserWithRole("TAM");
    const foreign = await prisma.project.create({
      data: { name: `Foreign ${Date.now()}-${Math.random()}`, tamId: other.userId, status: "ACTIVE" },
    });
    const excluded = await prisma.project.create({
      data: {
        name: `Admin box ${Date.now()}-${Math.random()}`,
        tamId: userId,
        status: "ACTIVE",
        excludeFromPortfolio: true,
      },
    });
    await task("TODO", d("2026-09-01T00:00:00.000Z"), foreign.id);
    await task("TODO", d("2026-09-30T00:00:00.000Z"), foreign.id);
    await task("TODO", d("2026-09-01T00:00:00.000Z"), excluded.id);
    await task("TODO", d("2026-09-30T00:00:00.000Z"), excluded.id);
    await task("TODO", d("2026-09-01T00:00:00.000Z"));

    expect(await workCounts()).toMatchObject({ overdue: 2, dueThisWeek: 1 });
  });

  it("openRisks come from the Daily Review scope only: ACTIVE, in scope", async () => {
    const other = await createUserWithRole("TAM");
    const foreign = await prisma.project.create({
      data: { name: `Foreign ${Date.now()}-${Math.random()}`, tamId: other.userId, status: "ACTIVE" },
    });
    const onHold = await prisma.project.create({
      data: { name: `On hold ${Date.now()}-${Math.random()}`, tamId: userId, status: "ON_HOLD" },
    });
    const excluded = await prisma.project.create({
      data: {
        name: `Admin box ${Date.now()}-${Math.random()}`,
        tamId: userId,
        status: "ACTIVE",
        excludeFromPortfolio: true,
      },
    });
    for (const pid of [foreign.id, onHold.id]) {
      await prisma.risk.create({ data: { projectId: pid, description: "r", status: "OPEN" } });
    }
    await prisma.risk.create({ data: { projectId, description: "r", status: "OPEN" } });
    // Daily Review lists an excluded-from-portfolio ACTIVE project, so its risk counts.
    await prisma.risk.create({ data: { projectId: excluded.id, description: "r", status: "OPEN" } });

    expect((await workCounts()).openRisks).toBe(2);
  });

  it("falls back to the server's UTC day when today is omitted", async () => {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 2);
    yesterday.setUTCHours(0, 0, 0, 0);
    await task("TODO", yesterday);
    expect((await workCounts("")).overdue).toBe(1);
  });

  it("rejects a malformed today", async () => {
    const res = await request(app)
      .get("/overview?today=nope")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});
