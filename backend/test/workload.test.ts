// GET /utilization/workload and /utilization/workload/tasks: per-assignee task
// counts for an ISO week, permission-scoped on the server (lib/workload.ts).
import "./env.js";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { signToken } from "../src/http/auth.js";
import { createUserWithRole, seedRoles } from "./testAuth.js";
import { SID } from "./statusFixtures.js";

const app = createApp();
// 2026-W47 = Mon 16 Nov .. Sun 22 Nov 2026.
const WEEK = "2026-W47";
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

beforeAll(async () => {
  await seedRoles();
});
afterEach(() => vi.useRealTimers());

let n = 0;
/** A TAM-like user whose role carries exactly `extra` on top of project:read. */
async function userWith(extra: string[], opts: { active?: boolean } = {}) {
  n += 1;
  const role = await prisma.role.create({
    data: { roleName: `wl-${Date.now()}-${n}`, permissions: ["project:read", "task:read", ...extra] },
  });
  const user = await prisma.user.create({
    data: {
      username: `wl-user-${Date.now()}-${n}`,
      email: `wl-${Date.now()}-${n}@example.com`,
      passwordHash: null,
      roleId: role.id,
      active: opts.active ?? true,
    },
  });
  return { userId: user.id, token: signToken({ sub: user.id, ver: 0 }), username: user.username };
}

async function project(tamId: number) {
  return prisma.project.create({ data: { name: `WL ${Date.now()}-${++n}`, tamId, status: "ACTIVE" } });
}

interface TaskSeed {
  projectId: number;
  assignedToId?: number | null;
  statusId?: number;
  start?: string;
  due?: string;
  storyPoints?: number | null;
  parentTaskId?: number | null;
}
async function task(t: TaskSeed) {
  const statusId = t.statusId ?? SID.TODO;
  return prisma.task.create({
    data: {
      projectId: t.projectId,
      title: "T",
      statusId,
      status: statusId === SID.DONE ? "DONE" : statusId === SID.IN_PROGRESS ? "IN_PROGRESS" : "TODO",
      assignedToId: t.assignedToId ?? null,
      startDate: t.start ? day(t.start) : null,
      dueDate: t.due ? day(t.due) : null,
      storyPoints: t.storyPoints ?? null,
      parentTaskId: t.parentTaskId ?? null,
    },
  });
}

const get = (token: string, offset = 0) =>
  request(app)
    .get(`/utilization/workload?week=${WEEK}&utcOffsetMinutes=${offset}`)
    .set({ Authorization: `Bearer ${token}` });
const detail = (token: string, assignee: number | "unassigned") =>
  request(app)
    .get(`/utilization/workload/tasks?assignee=${assignee}`)
    .set({ Authorization: `Bearer ${token}` });
const rowOf = (body: { rows: { userId: number | null; open: number }[] }, userId: number | null) =>
  body.rows.find((r) => r.userId === userId);

describe("own-only (no workload permission)", () => {
  it("shows only the caller's row, counting tasks in visible projects", async () => {
    const me = await userWith([]);
    const other = await userWith([]);
    const mine = await project(me.userId);
    const theirs = await project(other.userId);
    await task({ projectId: mine.id, assignedToId: me.userId, due: "2026-11-18", storyPoints: 3 });
    // Assigned to me but in a project I cannot see: not counted.
    await task({ projectId: theirs.id, assignedToId: me.userId, due: "2026-11-18", storyPoints: 8 });
    await task({ projectId: mine.id, assignedToId: other.userId });
    await task({ projectId: mine.id, assignedToId: null });

    const res = await get(me.token);
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe("own");
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0]).toMatchObject({ userId: me.userId, open: 1, dueThisWeek: 1, storyPoints: 3 });
  });

  it("report:executive alone grants nothing beyond the own row", async () => {
    const exec = await userWith(["report:executive"]);
    const other = await userWith([]);
    const p = await project(other.userId);
    await task({ projectId: p.id, assignedToId: other.userId });
    const res = await get(exec.token);
    expect(res.body.scope).toBe("own");
    expect(res.body.rows.map((r: { userId: number }) => r.userId)).toEqual([exec.userId]);
    expect((await detail(exec.token, other.userId)).status).toBe(403);
    expect((await detail(exec.token, "unassigned")).status).toBe(403);
  });

  it("requires project:read", async () => {
    const pending = await createUserWithRole("PENDING");
    expect((await get(pending.token)).status).toBe(403);
  });
});

describe("workload:team", () => {
  it("shows the caller and assignees of owned projects, with a limited Unassigned row", async () => {
    const lead = await userWith(["workload:team"]);
    const a = await userWith([]);
    const stranger = await userWith([]);
    const owned = await project(lead.userId);
    const foreign = await project(stranger.userId);
    await task({ projectId: owned.id, assignedToId: a.userId, due: "2026-11-17" });
    await task({ projectId: owned.id, assignedToId: null });
    await task({ projectId: foreign.id, assignedToId: null });
    await task({ projectId: foreign.id, assignedToId: stranger.userId });

    const res = await get(lead.token);
    expect(res.body.scope).toBe("team");
    const ids = res.body.rows.map((r: { userId: number | null }) => r.userId);
    expect(ids).toContain(lead.userId);
    expect(ids).toContain(a.userId);
    expect(ids).not.toContain(stranger.userId);
    expect(rowOf(res.body, a.userId)).toMatchObject({ open: 1, dueThisWeek: 1 });
    expect(rowOf(res.body, null)).toMatchObject({ name: "Unassigned", open: 1 });
    expect((await detail(lead.token, a.userId)).status).toBe(200);
    expect((await detail(lead.token, stranger.userId)).status).toBe(403);
  });

  it("counts a team member's tasks only in projects the caller can see", async () => {
    const lead = await userWith(["workload:team"]);
    const a = await userWith([]);
    const stranger = await userWith([]);
    const owned = await project(lead.userId);
    const hidden = await project(stranger.userId);
    await task({ projectId: owned.id, assignedToId: a.userId });
    await task({ projectId: hidden.id, assignedToId: a.userId });
    const res = await get(lead.token);
    expect(rowOf(res.body, a.userId)?.open).toBe(1);
  });
});

describe("workload:all", () => {
  it("sees every assignee across all projects, plus the org-wide Unassigned row", async () => {
    const boss = await userWith(["workload:all"]);
    const a = await userWith([]);
    const b = await userWith([]);
    const pa = await project(a.userId);
    const pb = await project(b.userId);
    await task({ projectId: pa.id, assignedToId: a.userId, storyPoints: 2 });
    await task({ projectId: pb.id, assignedToId: b.userId, storyPoints: 5 });
    await task({ projectId: pb.id, assignedToId: null });

    const res = await get(boss.token);
    expect(res.body.scope).toBe("all");
    expect(rowOf(res.body, a.userId)).toMatchObject({ open: 1, storyPoints: 2 });
    expect(rowOf(res.body, b.userId)).toMatchObject({ open: 1, storyPoints: 5 });
    expect(rowOf(res.body, null)?.open).toBeGreaterThanOrEqual(1);
    expect((await detail(boss.token, b.userId)).status).toBe(200);
    expect((await detail(boss.token, "unassigned")).status).toBe(200);
  });

  it("the * wildcard grants it too", async () => {
    const admin = await createUserWithRole("ADMIN");
    expect((await get(admin.token)).body.scope).toBe("all");
  });
});

describe("counting rules", () => {
  it("excludes done-category tasks, by category and not by name", async () => {
    const me = await userWith([]);
    const p = await project(me.userId);
    const def = await prisma.taskStatusDef.create({
      data: { name: `Shipped ${Date.now()}`, category: "DONE", color: "emerald", position: 50 },
    });
    await task({ projectId: p.id, assignedToId: me.userId });
    await task({ projectId: p.id, assignedToId: me.userId, statusId: SID.DONE });
    await prisma.task.create({
      data: { projectId: p.id, title: "custom done", statusId: def.id, status: "DONE", assignedToId: me.userId },
    });
    const res = await get(me.token);
    expect(res.body.rows[0].open).toBe(1);
    const list = await detail(me.token, me.userId);
    expect(list.body.tasks).toHaveLength(1);
    await prisma.task.deleteMany({ where: { statusId: def.id } });
    await prisma.taskStatusDef.delete({ where: { id: def.id } });
  });

  it("counts subtasks as separate tasks and sums each task's own story points", async () => {
    const me = await userWith([]);
    const p = await project(me.userId);
    const parent = await task({ projectId: p.id, assignedToId: me.userId, storyPoints: 5 });
    await task({ projectId: p.id, assignedToId: me.userId, storyPoints: 2, parentTaskId: parent.id });
    await task({ projectId: p.id, assignedToId: me.userId, storyPoints: null, parentTaskId: parent.id });
    const row = (await get(me.token)).body.rows[0];
    expect(row.open).toBe(3);
    expect(row.storyPoints).toBe(7);
  });

  it("buckets due, overdue and active by calendar day of the week", async () => {
    const me = await userWith([]);
    const p = await project(me.userId);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-18T12:00:00.000Z"));
    // due Mon 16 (start of week) and Sun 22 (end): both this week.
    await task({ projectId: p.id, assignedToId: me.userId, due: "2026-11-16" });
    await task({ projectId: p.id, assignedToId: me.userId, due: "2026-11-22" });
    // due Sun 15 (last week) and Mon 23 (next week): not this week; 15 is overdue.
    await task({ projectId: p.id, assignedToId: me.userId, due: "2026-11-15" });
    await task({ projectId: p.id, assignedToId: me.userId, due: "2026-11-23" });
    // spans the whole week; ends before; starts after; start only inside; no dates.
    await task({ projectId: p.id, assignedToId: me.userId, start: "2026-11-01", due: "2026-12-01" });
    await task({ projectId: p.id, assignedToId: me.userId, start: "2026-11-01", due: "2026-11-10" });
    await task({ projectId: p.id, assignedToId: me.userId, start: "2026-11-30", due: "2026-12-05" });
    await task({ projectId: p.id, assignedToId: me.userId, start: "2026-11-19" });
    await task({ projectId: p.id, assignedToId: me.userId });

    const row = (await get(me.token)).body.rows[0];
    expect(row.open).toBe(9);
    expect(row.dueThisWeek).toBe(2);
    // Overdue: due 16, 15 and 10 (before 18 Nov local today).
    expect(row.overdue).toBe(3);
    // Active: 16, 22, whole-week span, start-only 19.
    expect(row.activeInWeek).toBe(4);
  });

  it("derives 'today' for overdue from utcOffsetMinutes (the viewer's local day)", async () => {
    const me = await userWith([]);
    const p = await project(me.userId);
    await task({ projectId: p.id, assignedToId: me.userId, due: "2026-11-18" });
    vi.useFakeTimers({ toFake: ["Date"] });
    // 20:00 UTC on the 18th is already the 19th at UTC+7.
    vi.setSystemTime(new Date("2026-11-18T20:00:00.000Z"));
    const utc = await get(me.token, 0);
    const bangkok = await get(me.token, 420);
    expect(utc.body.today).toBe("2026-11-18");
    expect(utc.body.rows[0].overdue).toBe(0);
    expect(bangkok.body.today).toBe("2026-11-19");
    expect(bangkok.body.rows[0].overdue).toBe(1);
    // The week itself is calendar days: the offset never moves a Monday task out of it.
    expect(bangkok.body.rows[0].dueThisWeek).toBe(1);
    const west = await get(me.token, -300);
    expect(west.body.rows[0].dueThisWeek).toBe(1);
  });
});

describe("inactive users and Unassigned", () => {
  it("hides an inactive user unless they hold open tasks", async () => {
    const lead = await userWith(["workload:team"]);
    const gone = await userWith([], { active: false });
    const goneBusy = await userWith([], { active: false });
    const p = await project(lead.userId);
    await task({ projectId: p.id, assignedToId: gone.userId, statusId: SID.DONE });
    await task({ projectId: p.id, assignedToId: goneBusy.userId });
    const res = await get(lead.token);
    expect(rowOf(res.body, gone.userId)).toBeUndefined();
    expect(rowOf(res.body, goneBusy.userId)).toMatchObject({ open: 1, active: false });
  });

  it("shows unassigned open tasks as one Unassigned row, last, and none when empty", async () => {
    const lead = await userWith(["workload:team"]);
    const p = await project(lead.userId);
    expect(rowOf((await get(lead.token)).body, null)).toBeUndefined();
    await task({ projectId: p.id });
    await task({ projectId: p.id });
    const res = await get(lead.token);
    const unassigned = res.body.rows.filter((r: { userId: number | null }) => r.userId === null);
    expect(unassigned).toHaveLength(1);
    expect(unassigned[0].open).toBe(2);
    expect(res.body.rows.at(-1).userId).toBeNull();
  });
});

describe("detail list and projects the caller cannot open", () => {
  it("workload:all counts every project but returns names only for visible ones", async () => {
    const boss = await userWith(["workload:all"]);
    const a = await userWith([]);
    const stranger = await userWith([]);
    const bossProject = await project(boss.userId);
    const hidden = await project(stranger.userId);
    await task({ projectId: bossProject.id, assignedToId: a.userId, due: "2026-11-17" });
    await task({ projectId: hidden.id, assignedToId: a.userId });
    await task({ projectId: hidden.id, assignedToId: a.userId });
    const table = await get(boss.token);
    expect(rowOf(table.body, a.userId)?.open).toBe(3);
    const res = await detail(boss.token, a.userId);
    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(1);
    expect(res.body.tasks[0].projectId).toBe(bossProject.id);
    expect(res.body.hiddenCount).toBe(2);
    expect(JSON.stringify(res.body)).not.toContain(hidden.name);
  });

  it("an admin (project:view-all) sees every task and no hidden count", async () => {
    const admin = await createUserWithRole("ADMIN");
    const a = await userWith([]);
    const p = await project(a.userId);
    await task({ projectId: p.id, assignedToId: a.userId });
    const res = await detail(admin.token, a.userId);
    expect(res.body.tasks).toHaveLength(1);
    expect(res.body.hiddenCount).toBe(0);
  });

  it("own and team callers get no hidden count for what they cannot count", async () => {
    const me = await userWith([]);
    const p = await project(me.userId);
    await task({ projectId: p.id, assignedToId: me.userId });
    expect((await detail(me.token, me.userId)).body.hiddenCount).toBe(0);
  });
});

describe("detail list", () => {
  it("lists open tasks with project, status definition and due date, soonest first", async () => {
    const me = await userWith([]);
    const p = await project(me.userId);
    const late = await task({ projectId: p.id, assignedToId: me.userId, due: "2026-12-01" });
    const soon = await task({ projectId: p.id, assignedToId: me.userId, due: "2026-11-17", statusId: SID.IN_PROGRESS });
    const none = await task({ projectId: p.id, assignedToId: me.userId });
    const res = await detail(me.token, me.userId);
    expect(res.status).toBe(200);
    expect(res.body.tasks.map((t: { id: number }) => t.id)).toEqual([soon.id, late.id, none.id]);
    expect(res.body.tasks[0]).toMatchObject({
      projectId: p.id,
      projectName: p.name,
      statusDef: { name: "In progress", category: "IN_PROGRESS" },
      dueDate: "2026-11-17T00:00:00.000Z",
    });
    expect(res.body.truncated).toBe(false);
    expect(res.body.hiddenCount).toBe(0);
  });

  it("rejects an invalid assignee", async () => {
    const me = await userWith([]);
    const res = await request(app)
      .get("/utilization/workload/tasks?assignee=abc")
      .set({ Authorization: `Bearer ${me.token}` });
    expect(res.status).toBe(400);
  });
});
