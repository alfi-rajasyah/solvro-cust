import "./env.js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { lockProjectOrder } from "../src/lib/orderLock.js";
import { seedRoles, createAdminAndToken, createUserWithRole } from "./testAuth.js";

// POST /tasks/bulk (src/lib/bulkTasks.ts): one change set applied to many
// tasks of one project, all or nothing.

const app = createApp();

let token: string;
let adminId: number;
let projectId: number;

async function makeProject(ownerId: number): Promise<number> {
  const p = await prisma.project.create({
    data: { name: `Bulk ${Date.now()}-${Math.random()}`, tamId: ownerId, status: "ACTIVE" },
  });
  return p.id;
}

async function makeTask(body: Record<string, unknown> = {}, inProject = projectId) {
  const res = await request(app)
    .post(`/projects/${inProject}/tasks`)
    .set("Authorization", `Bearer ${token}`)
    .send({ title: "Task", ...body });
  expect(res.status).toBe(201);
  return res.body as { id: number; parentTaskId: number | null };
}

const makeLabel = (name: string, inProject = projectId) =>
  prisma.label.create({ data: { name, projectId: inProject } });

function bulk(body: Record<string, unknown>, t = token) {
  return request(app).post("/tasks/bulk").set("Authorization", `Bearer ${t}`).send(body);
}

const row = (id: number) =>
  prisma.task.findUniqueOrThrow({
    where: { id },
    include: { labels: true, statusDef: true },
  });

beforeAll(async () => {
  await seedRoles();
});

beforeEach(async () => {
  const admin = await createAdminAndToken();
  token = admin.token;
  adminId = admin.userId;
  projectId = await makeProject(adminId);
});

describe("POST /tasks/bulk", () => {
  it("403 without task:write", async () => {
    const t = await makeTask();
    const viewer = await createUserWithRole("STAKEHOLDER");
    const res = await bulk({ taskIds: [t.id], priority: "HIGH" }, viewer.token);
    expect(res.status).toBe(403);
    expect((await row(t.id)).priority).not.toBe("HIGH");
  });

  it("404 for a task the caller cannot see, with no write", async () => {
    const mine = await makeTask();
    const otherOwner = await createUserWithRole("TAM");
    const hiddenProject = await makeProject(otherOwner.userId);
    const hidden = await prisma.task.create({
      data: {
        title: "Hidden",
        projectId: hiddenProject,
        ...(await (async () => {
          const def = await prisma.taskStatusDef.findFirstOrThrow({
            where: { category: "TODO", isDefault: true },
          });
          return { status: def.category, statusId: def.id };
        })()),
      },
    });
    const tam = await createUserWithRole("TAM");
    const visibleToTam = await makeProject(tam.userId);
    const own = await prisma.task.create({
      data: { title: "Own", projectId: visibleToTam, status: "TODO", statusId: hidden.statusId },
    });
    const res = await bulk({ taskIds: [own.id, hidden.id], priority: "URGENT" }, tam.token);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("not_found");
    expect((await row(own.id)).priority).not.toBe("URGENT");
    expect((await row(mine.id)).priority).not.toBe("URGENT");
  });

  it("404 for ids spanning two projects, with no write", async () => {
    const a = await makeTask();
    const otherProject = await makeProject(adminId);
    const b = await makeTask({}, otherProject);
    const res = await bulk({ taskIds: [a.id, b.id], priority: "URGENT" });
    expect(res.status).toBe(404);
    expect((await row(a.id)).priority).not.toBe("URGENT");
    expect((await row(b.id)).priority).not.toBe("URGENT");
  });

  it("404 for an id that does not exist", async () => {
    const a = await makeTask();
    const res = await bulk({ taskIds: [a.id, 99999999], priority: "HIGH" });
    expect(res.status).toBe(404);
  });

  it("caps taskIds at 200 (201 ids is 400)", async () => {
    const ids = Array.from({ length: 201 }, (_, i) => i + 1);
    const res = await bulk({ taskIds: ids, priority: "HIGH" });
    expect(res.status).toBe(400);
  });

  it("400 for duplicate ids, an empty list and no action", async () => {
    const a = await makeTask();
    expect((await bulk({ taskIds: [a.id, a.id], priority: "HIGH" })).status).toBe(400);
    expect((await bulk({ taskIds: [], priority: "HIGH" })).status).toBe(400);
    expect((await bulk({ taskIds: [a.id] })).status).toBe(400);
    expect((await bulk({ taskIds: [a.id], addLabelIds: [] })).status).toBe(400);
  });

  it("400 when a label is both added and removed, and for unknown keys", async () => {
    const a = await makeTask();
    const l = await makeLabel("x");
    expect((await bulk({ taskIds: [a.id], addLabelIds: [l.id], removeLabelIds: [l.id] })).status).toBe(400);
    expect((await bulk({ taskIds: [a.id], priority: "HIGH", position: 3 })).status).toBe(400);
  });

  it("400 invalid_label for a label of another project, with no write", async () => {
    const a = await makeTask();
    const good = await makeLabel("good");
    const foreignProject = await makeProject(adminId);
    const foreign = await makeLabel("foreign", foreignProject);
    const res = await bulk({ taskIds: [a.id], addLabelIds: [good.id, foreign.id], priority: "HIGH" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_label");
    const after = await row(a.id);
    expect(after.labels).toHaveLength(0);
    expect(after.priority).not.toBe("HIGH");
    const removeForeign = await bulk({ taskIds: [a.id], removeLabelIds: [foreign.id] });
    expect(removeForeign.status).toBe(400);
  });

  it("adds and removes labels while keeping the others", async () => {
    const [l1, l2, l3] = await Promise.all([makeLabel("one"), makeLabel("two"), makeLabel("three")]);
    const a = await makeTask({ labelIds: [l1.id] });
    const b = await makeTask({ labelIds: [l1.id, l2.id] });

    const add = await bulk({ taskIds: [a.id, b.id], addLabelIds: [l2.id, l3.id] });
    expect(add.status).toBe(200);
    expect(add.body).toEqual({ updated: 2 });
    expect((await row(a.id)).labels.map((l) => l.id).sort()).toEqual([l1.id, l2.id, l3.id].sort());
    expect((await row(b.id)).labels.map((l) => l.id).sort()).toEqual([l1.id, l2.id, l3.id].sort());

    const remove = await bulk({ taskIds: [a.id, b.id], removeLabelIds: [l1.id, l3.id] });
    expect(remove.status).toBe(200);
    expect((await row(a.id)).labels.map((l) => l.id)).toEqual([l2.id]);
    expect((await row(b.id)).labels.map((l) => l.id)).toEqual([l2.id]);
  });

  it("keeps Task.status equal to the statusDef category on a status change", async () => {
    const a = await makeTask();
    const b = await makeTask();
    const done = await prisma.taskStatusDef.findFirstOrThrow({ where: { category: "DONE" } });
    const res = await bulk({ taskIds: [a.id, b.id], statusId: done.id });
    expect(res.status).toBe(200);
    for (const id of [a.id, b.id]) {
      const r = await row(id);
      expect(r.statusId).toBe(done.id);
      expect(r.status).toBe(r.statusDef.category);
      expect(r.status).toBe("DONE");
    }
    expect((await bulk({ taskIds: [a.id], statusId: 99999999 })).body.code).toBe("status_not_found");
  });

  it("sets priority and assignee, and clears the assignee with null", async () => {
    const a = await makeTask();
    const me = await createUserWithRole("TAM");
    await prisma.projectMember.create({ data: { projectId, userId: me.userId, addedById: adminId } });
    const set = await bulk({ taskIds: [a.id], priority: "URGENT", assignedToId: me.userId });
    expect(set.status).toBe(200);
    const r = await row(a.id);
    expect(r.priority).toBe("URGENT");
    expect(r.assignedToId).toBe(me.userId);
    expect((await bulk({ taskIds: [a.id], assignedToId: null })).status).toBe(200);
    expect((await row(a.id)).assignedToId).toBeNull();
  });

  it("400 assignee_inactive for a deactivated user, with no write", async () => {
    const a = await makeTask();
    const gone = await createUserWithRole("TAM");
    await prisma.user.update({ where: { id: gone.userId }, data: { active: false } });
    const res = await bulk({ taskIds: [a.id], assignedToId: gone.userId, priority: "URGENT" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("assignee_inactive");
    expect((await row(a.id)).priority).not.toBe("URGENT");
    expect((await bulk({ taskIds: [a.id], assignedToId: 99999999 })).body.code).toBe("assignee_not_found");
  });

  it("makes a non-member assignee a project member", async () => {
    const a = await makeTask();
    const outsider = await createUserWithRole("TAM");
    const res = await bulk({ taskIds: [a.id], assignedToId: outsider.userId });
    expect(res.status).toBe(200);
    const member = await prisma.projectMember.findFirst({
      where: { projectId, userId: outsider.userId },
    });
    expect(member).not.toBeNull();
    const event = await prisma.activityEvent.findFirst({
      where: { projectId, entityType: "member", entityId: outsider.userId },
    });
    expect(event?.action).toBe("added");
  });

  it("sets and clears an epic on top-level tasks; 400 epic_on_subtask when any is a subtask", async () => {
    const epic = await prisma.epic.create({ data: { projectId, title: "E", position: 0 } });
    const parent = await makeTask();
    const other = await makeTask();
    const sub = await makeTask({ parentTaskId: parent.id });

    const refused = await bulk({ taskIds: [other.id, sub.id], epicId: epic.id });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe("epic_on_subtask");
    expect((await row(other.id)).epicId).toBeNull();

    const ok = await bulk({ taskIds: [parent.id, other.id], epicId: epic.id });
    expect(ok.status).toBe(200);
    expect((await row(parent.id)).epicId).toBe(epic.id);

    // Clearing over a mixed selection leaves the subtask alone and does not fail.
    const clear = await bulk({ taskIds: [parent.id, sub.id], epicId: null });
    expect(clear.status).toBe(200);
    expect((await row(parent.id)).epicId).toBeNull();

    const otherProject = await makeProject(adminId);
    const foreignEpic = await prisma.epic.create({
      data: { projectId: otherProject, title: "F", position: 0 },
    });
    const foreign = await bulk({ taskIds: [other.id], epicId: foreignEpic.id });
    expect(foreign.status).toBe(400);
    expect(foreign.body.code).toBe("epic_not_found");
  });

  it("applies to subtasks (labels, status, priority)", async () => {
    const parent = await makeTask();
    const sub = await makeTask({ parentTaskId: parent.id });
    const l = await makeLabel("sub");
    const res = await bulk({ taskIds: [sub.id], addLabelIds: [l.id], priority: "LOW" });
    expect(res.status).toBe(200);
    const r = await row(sub.id);
    expect(r.labels.map((x) => x.id)).toEqual([l.id]);
    expect(r.priority).toBe("LOW");
    expect(r.parentTaskId).toBe(parent.id);
  });

  it("records one activity event per changed task and leaves position alone", async () => {
    const a = await makeTask();
    const b = await makeTask();
    const c = await makeTask();
    const before = await prisma.task.findMany({
      where: { projectId },
      select: { id: true, position: true },
      orderBy: { id: "asc" },
    });
    const l = await makeLabel("act");
    const res = await bulk({ taskIds: [a.id, b.id], addLabelIds: [l.id], priority: "URGENT" });
    expect(res.status).toBe(200);

    const events = await prisma.activityEvent.findMany({
      where: { projectId, entityType: "task", action: "updated" },
    });
    expect(events.map((e) => e.entityId).sort()).toEqual([a.id, b.id].sort());
    const changes = events[0].changes as Record<string, unknown>;
    expect(changes.priority).toBeDefined();
    expect(changes.labels).toEqual({ added: ["act"], removed: [] });

    const after = await prisma.task.findMany({
      where: { projectId },
      select: { id: true, position: true },
      orderBy: { id: "asc" },
    });
    expect(after).toEqual(before);
    expect((await row(c.id)).priority).not.toBe("URGENT");
  });

  it("is not swallowed by /tasks/:id (route order)", async () => {
    const res = await request(app).post("/tasks/bulk").set("Authorization", `Bearer ${token}`).send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation_error");
  });

  it("waits for the project order lock before it row-locks any task", async () => {
    const a = await makeTask();
    const b = await makeTask();
    const lowest = Math.min(a.id, b.id);
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    let held!: () => void;
    const holding = new Promise<void>((r) => (held = r));

    // Holds the order lock the way a reorder or a delete does.
    const holder = prisma.$transaction(
      async (tx) => {
        await lockProjectOrder(tx, "tasks", projectId);
        held();
        await released;
      },
      { timeout: 20_000, maxWait: 10_000 },
    );
    await holding;

    const pending = bulk({ taskIds: [a.id, b.id], priority: "URGENT" }).then((r) => r);
    try {
      // The bulk request is parked on the advisory lock.
      const deadline = Date.now() + 2_000;
      let waiting = 0;
      while (waiting === 0 && Date.now() < deadline) {
        const rows = await prisma.$queryRaw<{ n: bigint }[]>`
          SELECT count(*)::bigint AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`;
        waiting = Number(rows[0].n);
        if (waiting === 0) await new Promise((r) => setTimeout(r, 25));
      }
      expect(waiting).toBeGreaterThan(0);

      // While it waits, it holds no row lock on the tasks: NOWAIT would raise
      // 55P03 if it did.
      await expect(
        prisma.$queryRaw`SELECT id FROM tasks WHERE id = ${lowest} FOR NO KEY UPDATE NOWAIT`,
      ).resolves.toBeDefined();
    } finally {
      release();
      await holder;
    }
    const res = await pending;
    expect(res.status).toBe(200);
    expect((await row(a.id)).priority).toBe("URGENT");
  });

  it("notifies each newly assigned task once, and nobody when the assignee is the actor", async () => {
    const a = await makeTask();
    const b = await makeTask();
    const c = await makeTask();
    const other = await createUserWithRole("TAM");
    const res = await bulk({ taskIds: [a.id, b.id, c.id], assignedToId: other.userId });
    expect(res.status).toBe(200);
    expect(await prisma.notification.count({ where: { userId: other.userId, reason: "assigned" } })).toBe(3);

    const d = await makeTask();
    const self = await bulk({ taskIds: [d.id], assignedToId: adminId });
    expect(self.status).toBe(200);
    expect(await prisma.notification.count({ where: { userId: adminId } })).toBe(0);
  });

  it("lets a caller who sees the project only as a member bulk-edit", async () => {
    const a = await makeTask();
    const member = await createUserWithRole("TAM");
    await prisma.projectMember.create({ data: { projectId, userId: member.userId, addedById: adminId } });
    const res = await bulk({ taskIds: [a.id], priority: "URGENT" }, member.token);
    expect(res.status).toBe(200);
    expect((await row(a.id)).priority).toBe("URGENT");
  });

  it("records no activity for a status write on a task already in that status", async () => {
    const a = await makeTask();
    const b = await makeTask();
    const cur = (await row(a.id)).statusDef;
    const done = await prisma.taskStatusDef.findFirstOrThrow({ where: { category: "DONE" } });
    await bulk({ taskIds: [b.id], statusId: done.id });
    await prisma.activityEvent.deleteMany({ where: { projectId } });

    const res = await bulk({ taskIds: [a.id, b.id], statusId: cur.id });
    expect(res.body).toEqual({ updated: 1 });
    const none = await bulk({ taskIds: [a.id], statusId: cur.id });
    expect(none.body).toEqual({ updated: 0 });
    const events = await prisma.activityEvent.findMany({ where: { projectId, entityType: "task" } });
    expect(events.map((e) => e.entityId)).toEqual([b.id]);
  });
});
