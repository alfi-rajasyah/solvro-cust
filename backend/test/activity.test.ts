// Project activity log (docs/archive/plans/collaboration-and-sharing.md, C5a): one
// event per write path, written in the write's own transaction; the feed
// endpoint; the retention job. Fixtures write via `prisma` directly.
import "./env.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { recordActivity } from "../src/lib/activity.js";
import { deleteExpiredActivityEvents } from "../src/lib/activityCleanup.js";
import { createUserWithRole, seedRoles } from "./testAuth.js";

const app = createApp();

beforeAll(async () => {
  await seedRoles();
});

const uniq = (label: string) => `${label} ${Date.now()}-${Math.random()}`;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function fixture() {
  const tam = await createUserWithRole("TAM");
  const other = await createUserWithRole("TAM");
  const outsider = await createUserWithRole("TAM");
  const customer = await prisma.customer.create({
    data: { name: uniq("Customer"), description: "d", tamId: tam.userId },
  });
  const project = await prisma.project.create({
    data: { name: uniq("Project"), tamId: tam.userId, customerId: customer.id, status: "ACTIVE" },
  });
  return { tam, other, outsider, customer, project };
}

const eventsOf = (projectId: number) =>
  prisma.activityEvent.findMany({ where: { projectId }, orderBy: { id: "asc" } });

async function makeTask(projectId: number, extra: Record<string, unknown> = {}) {
  return prisma.task.create({
    data: { projectId, title: uniq("Task"), status: "TODO", priority: "MEDIUM", position: 0, ...extra },
  });
}

describe("task writes", () => {
  it("create records one event; an assignee adds a member event and lands in changes", async () => {
    const { tam, other, project } = await fixture();
    const plain = await request(app)
      .post(`/projects/${project.id}/tasks`)
      .set(auth(tam.token))
      .send({ title: "Plain task" });
    expect(plain.status).toBe(201);
    let events = await eventsOf(project.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorId: tam.userId,
      entityType: "task",
      entityId: plain.body.id,
      action: "created",
      entityLabel: "Plain task",
      changes: null,
    });

    const assigned = await request(app)
      .post(`/projects/${project.id}/tasks`)
      .set(auth(tam.token))
      .send({ title: "Assigned task", assignedToId: other.userId });
    expect(assigned.status).toBe(201);
    events = await eventsOf(project.id);
    expect(events).toHaveLength(3);
    const otherUser = await prisma.user.findUniqueOrThrow({ where: { id: other.userId } });
    expect(events[1]).toMatchObject({
      entityType: "member",
      entityId: other.userId,
      action: "added",
      entityLabel: otherUser.username,
    });
    expect(events[2]).toMatchObject({ entityType: "task", action: "created" });
    expect(events[2]!.changes).toEqual({
      assignee: { from: null, to: { id: other.userId, username: otherUser.username } },
    });
  });

  it("update records from/to for short fields, day strings for dates, no description text", async () => {
    const { tam, other, project } = await fixture();
    const task = await makeTask(project.id, { title: "Configure backups", dueDate: new Date("2026-10-02T00:00:00.000Z") });
    const label = await prisma.label.create({ data: { projectId: project.id, name: "urgent" } });
    const secret = uniq("SECRET-DESCRIPTION");

    const res = await request(app)
      .patch(`/tasks/${task.id}`)
      .set(auth(tam.token))
      .send({
        title: "Configure backup jobs",
        status: "IN_PROGRESS",
        priority: "HIGH",
        dueDate: "2026-10-05",
        description: secret,
        isCriticalPath: true,
        labelIds: [label.id],
        assignedToId: other.userId,
      });
    expect(res.status).toBe(200);

    const events = await eventsOf(project.id);
    // member added (C2 auto-add) + the task update
    expect(events.map((e) => `${e.entityType}:${e.action}`)).toEqual(["member:added", "task:updated"]);
    const updated = events[1]!;
    expect(updated.entityLabel).toBe("Configure backup jobs");
    const otherUser = await prisma.user.findUniqueOrThrow({ where: { id: other.userId } });
    expect(updated.changes).toEqual({
      title: { from: "Configure backups", to: "Configure backup jobs" },
      status: { from: "TODO", to: "IN_PROGRESS" },
      priority: { from: "MEDIUM", to: "HIGH" },
      dueDate: { from: "2026-10-02", to: "2026-10-05" },
      isCriticalPath: { from: false, to: true },
      description: { changed: true },
      labels: { added: ["urgent"], removed: [] },
      assignee: { from: null, to: { id: other.userId, username: otherUser.username } },
    });
    expect(JSON.stringify(events)).not.toContain(secret);

    // Removing the label and unassigning.
    await request(app)
      .patch(`/tasks/${task.id}`)
      .set(auth(tam.token))
      .send({ labelIds: [], assignedToId: null });
    const last = (await eventsOf(project.id)).at(-1)!;
    expect(last.changes).toEqual({
      labels: { added: [], removed: ["urgent"] },
      assignee: { from: { id: other.userId, username: otherUser.username }, to: null },
    });
  });

  it("a re-save of identical values and a reorder-only write record nothing", async () => {
    const { tam, project } = await fixture();
    const a = await makeTask(project.id, { title: "A", position: 0 });
    await makeTask(project.id, { title: "B", position: 1 });

    const same = await request(app)
      .patch(`/tasks/${a.id}`)
      .set(auth(tam.token))
      .send({ title: "A", status: "TODO" });
    expect(same.status).toBe(200);
    const reorder = await request(app)
      .patch(`/tasks/${a.id}`)
      .set(auth(tam.token))
      .send({ position: 1 });
    expect(reorder.status).toBe(200);
    expect(reorder.body.position).toBe(1);
    expect(await eventsOf(project.id)).toHaveLength(0);

    // A drag that also changes status records the status change only.
    const move = await request(app)
      .patch(`/tasks/${a.id}`)
      .set(auth(tam.token))
      .send({ status: "DONE", position: 0 });
    expect(move.status).toBe(200);
    const events = await eventsOf(project.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.changes).toEqual({ status: { from: "TODO", to: "DONE" } });
  });

  it("a rejected stale write leaves no event", async () => {
    const { tam, project } = await fixture();
    const task = await makeTask(project.id, { title: "Original" });
    await prisma.task.update({ where: { id: task.id }, data: { title: "Theirs" } });
    const res = await request(app)
      .patch(`/tasks/${task.id}`)
      .set(auth(tam.token))
      .send({ title: "Mine", expected: { title: "Original" } });
    expect(res.status).toBe(409);
    expect(await eventsOf(project.id)).toHaveLength(0);
  });

  it("delete records the title snapshot", async () => {
    const { tam, project } = await fixture();
    const task = await makeTask(project.id, { title: "Doomed task" });
    const res = await request(app).delete(`/tasks/${task.id}`).set(auth(tam.token));
    expect(res.status).toBe(204);
    const events = await eventsOf(project.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      entityType: "task",
      entityId: task.id,
      action: "deleted",
      entityLabel: "Doomed task",
      actorId: tam.userId,
    });
  });
});

describe("task writes — locking and duplicates", () => {
  it("a successful `expected` save records its event from the locked row", async () => {
    const { tam, project } = await fixture();
    const task = await makeTask(project.id, { title: "Before", priority: "LOW" });
    const res = await request(app)
      .patch(`/tasks/${task.id}`)
      .set(auth(tam.token))
      .send({ title: "After", expected: { title: "Before" } });
    expect(res.status).toBe(200);
    const events = await eventsOf(project.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.changes).toEqual({ title: { from: "Before", to: "After" } });
  });

  it("two simultaneous identical assignee PATCHes record exactly one assignee change", async () => {
    const { tam, other, project } = await fixture();
    const task = await makeTask(project.id, { title: "Race" });
    const send = () =>
      request(app)
        .patch(`/tasks/${task.id}`)
        .set(auth(tam.token))
        .send({ assignedToId: other.userId });
    const [a, b] = await Promise.all([send(), send()]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const events = await eventsOf(project.id);
    const assigneeEvents = events.filter(
      (e) => e.entityType === "task" && e.changes && "assignee" in (e.changes as object),
    );
    expect(assigneeEvents).toHaveLength(1);
    expect(events.filter((e) => e.entityType === "member")).toHaveLength(1);
  });

  it("logs itopTicketRef changes as from/to", async () => {
    const { tam, project } = await fixture();
    const task = await makeTask(project.id);
    await request(app)
      .patch(`/tasks/${task.id}`)
      .set(auth(tam.token))
      .send({ itopTicketRef: "R-000123" });
    const events = await eventsOf(project.id);
    expect(events[0]!.changes).toEqual({ itopTicketRef: { from: null, to: "R-000123" } });
  });

  it("duplicating a task records one created event for the copy, not its subtasks", async () => {
    const { tam, project } = await fixture();
    const parent = await makeTask(project.id, { title: "Parent" });
    await makeTask(project.id, { title: "Child", parentTaskId: parent.id });
    const res = await request(app).post(`/tasks/${parent.id}/duplicate`).set(auth(tam.token));
    expect(res.status).toBe(201);
    const events = await eventsOf(project.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      entityType: "task",
      entityId: res.body.id,
      action: "created",
      entityLabel: "Parent",
      actorId: tam.userId,
    });
  });

  it("duplicating a section records one created event per copied top-level task", async () => {
    const { tam, project } = await fixture();
    const section = await prisma.section.create({
      data: { projectId: project.id, name: "Phase", position: 0 },
    });
    const one = await makeTask(project.id, { title: "One", sectionId: section.id, position: 0 });
    await makeTask(project.id, { title: "Two", sectionId: section.id, position: 1 });
    await makeTask(project.id, { title: "Sub", parentTaskId: one.id, sectionId: section.id });
    const res = await request(app).post(`/sections/${section.id}/duplicate`).set(auth(tam.token));
    expect(res.status).toBe(201);
    expect(res.body.taskCount).toBe(2);
    const events = await eventsOf(project.id);
    expect(events.map((e) => `${e.action}:${e.entityLabel}`)).toEqual(["created:One", "created:Two"]);
    expect(events.every((e) => e.entityType === "task" && e.actorId === tam.userId)).toBe(true);
  });
});

describe("comments", () => {
  it("records the task title and never the comment body", async () => {
    const { tam, project } = await fixture();
    const task = await makeTask(project.id, { title: "Discussed task" });
    const body = uniq("COMMENT-BODY");
    const res = await request(app)
      .post(`/tasks/${task.id}/comments`)
      .set(auth(tam.token))
      .send({ body });
    expect(res.status).toBe(201);
    const events = await eventsOf(project.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      entityType: "comment",
      entityId: res.body.id,
      action: "created",
      entityLabel: "Discussed task",
      changes: { taskId: task.id },
    });
    expect(JSON.stringify(events)).not.toContain(body);
  });
});

describe("risks", () => {
  it("create, update and delete each record one event without text bodies", async () => {
    const { tam, project } = await fixture();
    const plan = uniq("MITIGATION-TEXT");
    const created = await request(app)
      .post(`/projects/${project.id}/risks`)
      .set(auth(tam.token))
      .send({ description: "Vendor may slip", mitigationPlan: plan });
    expect(created.status).toBe(201);

    const patched = await request(app)
      .patch(`/risks/${created.body.id}`)
      .set(auth(tam.token))
      .send({ probability: 4, status: "MITIGATED", mitigationPlan: `${plan} v2`, impact: 1 });
    expect(patched.status).toBe(200);

    const removed = await request(app).delete(`/risks/${created.body.id}`).set(auth(tam.token));
    expect(removed.status).toBe(204);

    const events = await eventsOf(project.id);
    expect(events.map((e) => e.action)).toEqual(["created", "updated", "deleted"]);
    expect(events.every((e) => e.entityType === "risk" && e.entityId === created.body.id)).toBe(true);
    expect(events.every((e) => e.entityLabel === "Vendor may slip")).toBe(true);
    expect(events[1]!.changes).toEqual({
      probability: { from: 1, to: 4 },
      status: { from: "OPEN", to: "MITIGATED" },
      mitigationPlan: { changed: true },
    });
    expect(JSON.stringify(events)).not.toContain(plan);
  });
});

describe("project notes", () => {
  it("records id and visibility only — never the body — for INTERNAL and CUSTOMER_FACING", async () => {
    const { tam, project } = await fixture();
    const secret = uniq("INTERNAL-NOTE-BODY");
    const created = await request(app)
      .post(`/projects/${project.id}/notes`)
      .set(auth(tam.token))
      .send({ body: secret });
    expect(created.status).toBe(201);
    const noteId = created.body.id as number;
    const customerFacing = await request(app)
      .post(`/projects/${project.id}/notes`)
      .set(auth(tam.token))
      .send({ body: secret, visibility: "CUSTOMER_FACING" });
    expect(customerFacing.status).toBe(201);

    const edited = await request(app)
      .patch(`/projects/${project.id}/notes/${noteId}`)
      .set(auth(tam.token))
      .send({ body: `${secret} edited` });
    expect(edited.status).toBe(200);
    const removed = await request(app)
      .delete(`/projects/${project.id}/notes/${noteId}`)
      .set(auth(tam.token));
    expect(removed.status).toBe(204);

    const events = await eventsOf(project.id);
    expect(events.map((e) => e.action)).toEqual(["created", "created", "updated", "deleted"]);
    expect(events.every((e) => e.entityType === "note" && e.entityLabel === null)).toBe(true);
    expect(events[0]).toMatchObject({ entityId: noteId, changes: { visibility: "INTERNAL" } });
    expect(events[1]!.changes).toEqual({ visibility: "CUSTOMER_FACING" });
    expect(events[2]!.changes).toEqual({ visibility: "INTERNAL" });
    expect(events[3]!.changes).toEqual({ visibility: "INTERNAL" });
    expect(JSON.stringify(events)).not.toContain(secret);
  });
});

describe("project notes — unchanged body", () => {
  it("saving a note without changing its body records no updated event", async () => {
    const { tam, project } = await fixture();
    const created = await request(app)
      .post(`/projects/${project.id}/notes`)
      .set(auth(tam.token))
      .send({ body: "same body" });
    const res = await request(app)
      .patch(`/projects/${project.id}/notes/${created.body.id}`)
      .set(auth(tam.token))
      .send({ body: "same body" });
    expect(res.status).toBe(200);
    expect((await eventsOf(project.id)).map((e) => e.action)).toEqual(["created"]);
  });
});

describe("members", () => {
  it("add and remove record one event each; removal notes unassigned tasks", async () => {
    const { tam, other, project } = await fixture();
    const otherUser = await prisma.user.findUniqueOrThrow({ where: { id: other.userId } });
    const add = await request(app)
      .post(`/projects/${project.id}/members`)
      .set(auth(tam.token))
      .send({ userId: other.userId });
    expect(add.status).toBe(201);
    // Idempotent re-add records nothing more.
    const again = await request(app)
      .post(`/projects/${project.id}/members`)
      .set(auth(tam.token))
      .send({ userId: other.userId });
    expect(again.status).toBe(200);
    await makeTask(project.id, { assignedToId: other.userId });

    const del = await request(app)
      .delete(`/projects/${project.id}/members/${other.userId}`)
      .set(auth(tam.token));
    expect(del.status).toBe(204);
    // Removing a non-member records nothing.
    await request(app).delete(`/projects/${project.id}/members/${other.userId}`).set(auth(tam.token));

    const events = await eventsOf(project.id);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      entityType: "member",
      entityId: other.userId,
      action: "added",
      entityLabel: otherUser.username,
      actorId: tam.userId,
      changes: null,
    });
    expect(events[1]).toMatchObject({
      entityType: "member",
      action: "removed",
      entityLabel: otherUser.username,
      changes: { unassignedTasks: 1 },
    });
  });
});

describe("project updates", () => {
  it("records name, status and customer; other fields and re-saves record nothing", async () => {
    const { tam, project } = await fixture();
    const customer2 = await prisma.customer.create({
      data: { name: uniq("Customer2"), description: "d", tamId: tam.userId },
    });

    const noop = await request(app)
      .patch(`/projects/${project.id}`)
      .set(auth(tam.token))
      .send({ name: project.name, status: "ACTIVE", description: "changed description text" });
    expect(noop.status).toBe(200);
    expect(await eventsOf(project.id)).toHaveLength(0);

    const res = await request(app)
      .patch(`/projects/${project.id}`)
      .set(auth(tam.token))
      .send({ name: "Renamed project", status: "ON_HOLD", customerId: customer2.id });
    expect(res.status).toBe(200);
    const events = await eventsOf(project.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      entityType: "project",
      entityId: project.id,
      action: "updated",
      entityLabel: "Renamed project",
    });
    expect(events[0]!.changes).toEqual({
      name: { from: project.name, to: "Renamed project" },
      status: { from: "ACTIVE", to: "ON_HOLD" },
      customerId: { from: project.customerId, to: customer2.id },
    });
    expect(JSON.stringify(events)).not.toContain("changed description text");
  });
});

describe("atomicity", () => {
  it("an event recorded inside a transaction that rolls back is not persisted", async () => {
    const { tam, project } = await fixture();
    await expect(
      prisma.$transaction(async (tx) => {
        await recordActivity(tx, {
          projectId: project.id,
          actorId: tam.userId,
          entityType: "task",
          entityId: 1,
          action: "created",
          entityLabel: "Never committed",
        });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await eventsOf(project.id)).toHaveLength(0);
  });

  it("a failing write leaves no event (task create with an unknown section)", async () => {
    const { tam, project } = await fixture();
    const res = await request(app)
      .post(`/projects/${project.id}/tasks`)
      .set(auth(tam.token))
      .send({ title: "X", sectionId: 999_999_999 });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await eventsOf(project.id)).toHaveLength(0);
  });
});

describe("GET /projects/:id/activity", () => {
  async function seedEvents(projectId: number, actorId: number, n: number, offset = 0) {
    for (let i = 0; i < n; i += 1) {
      await prisma.activityEvent.create({
        data: {
          projectId,
          actorId,
          entityType: "task",
          entityId: i + 1,
          action: "created",
          entityLabel: `T${offset + i}`,
        },
      });
    }
  }

  it("pages newest first with nextBefore, and filters by actor", async () => {
    const { tam, other, project } = await fixture();
    await seedEvents(project.id, tam.userId, 3);
    await seedEvents(project.id, other.userId, 2, 3);

    const first = await request(app)
      .get(`/projects/${project.id}/activity?limit=2`)
      .set(auth(tam.token));
    expect(first.status).toBe(200);
    expect(first.body.events.map((e: { entityLabel: string }) => e.entityLabel)).toEqual(["T4", "T3"]);
    expect(first.body.nextBefore).toBe(first.body.events[1].id);
    expect(first.body.events[0].actor).toEqual({
      id: other.userId,
      username: expect.any(String),
      avatarUrl: null,
    });

    const second = await request(app)
      .get(`/projects/${project.id}/activity?limit=2&before=${first.body.nextBefore}`)
      .set(auth(tam.token));
    expect(second.body.events.map((e: { entityLabel: string }) => e.entityLabel)).toEqual(["T2", "T1"]);
    const third = await request(app)
      .get(`/projects/${project.id}/activity?limit=2&before=${second.body.nextBefore}`)
      .set(auth(tam.token));
    expect(third.body.events.map((e: { entityLabel: string }) => e.entityLabel)).toEqual(["T0"]);
    expect(third.body.nextBefore).toBeNull();

    const filtered = await request(app)
      .get(`/projects/${project.id}/activity?actorId=${other.userId}`)
      .set(auth(tam.token));
    expect(filtered.body.events).toHaveLength(2);
    expect(filtered.body.nextBefore).toBeNull();
  });

  it("caps limit at 100, defaults to 50, and returns a null actor for a deleted user", async () => {
    const { tam, project } = await fixture();
    await seedEvents(project.id, tam.userId, 51);
    const def = await request(app).get(`/projects/${project.id}/activity`).set(auth(tam.token));
    expect(def.body.events).toHaveLength(50);
    expect(def.body.nextBefore).not.toBeNull();
    const tooBig = await request(app)
      .get(`/projects/${project.id}/activity?limit=101`)
      .set(auth(tam.token));
    expect(tooBig.status).toBe(400);

    const ghost = await createUserWithRole("TAM");
    await prisma.activityEvent.create({
      data: { projectId: project.id, actorId: ghost.userId, entityType: "risk", entityId: 1, action: "created" },
    });
    await prisma.user.delete({ where: { id: ghost.userId } });
    const after = await request(app)
      .get(`/projects/${project.id}/activity?limit=1`)
      .set(auth(tam.token));
    expect(after.body.events[0].actor).toBeNull();
  });

  it("is visible to a member and 404 for a non-member", async () => {
    const { tam, other, outsider, project } = await fixture();
    await seedEvents(project.id, tam.userId, 1);
    await prisma.projectMember.create({ data: { projectId: project.id, userId: other.userId } });
    const asMember = await request(app).get(`/projects/${project.id}/activity`).set(auth(other.token));
    expect(asMember.status).toBe(200);
    expect(asMember.body.events).toHaveLength(1);
    const asOutsider = await request(app)
      .get(`/projects/${project.id}/activity`)
      .set(auth(outsider.token));
    expect(asOutsider.status).toBe(404);
    const anon = await request(app).get(`/projects/${project.id}/activity`);
    expect(anon.status).toBe(401);
  });
});

describe("retention", () => {
  it("deletes only events older than 180 days", async () => {
    const { tam, project } = await fixture();
    const now = new Date();
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
    const mk = (label: string, createdAt: Date) =>
      prisma.activityEvent.create({
        data: {
          projectId: project.id,
          actorId: tam.userId,
          entityType: "task",
          entityId: 1,
          action: "created",
          entityLabel: label,
          createdAt,
        },
      });
    await mk("old", daysAgo(181));
    await mk("older", daysAgo(400));
    await mk("edge", daysAgo(179));
    await mk("fresh", now);

    const count = await deleteExpiredActivityEvents(now);
    expect(count).toBeGreaterThanOrEqual(2);
    const left = (await eventsOf(project.id)).map((e) => e.entityLabel).sort();
    expect(left).toEqual(["edge", "fresh"]);
  });
});

describe("project creation", () => {
  it("records a created event with the TAM and customer (ids and names, no emails)", async () => {
    const { tam, customer } = await fixture();
    const res = await request(app)
      .post("/projects")
      .set(auth(tam.token))
      .send({ name: "Fresh project", customerId: customer.id });
    expect(res.status).toBe(201);
    const events = await eventsOf(res.body.id);
    expect(events).toHaveLength(1);
    const tamRow = await prisma.user.findUniqueOrThrow({ where: { id: tam.userId } });
    expect(events[0]).toMatchObject({
      actorId: tam.userId,
      entityType: "project",
      entityId: res.body.id,
      action: "created",
      entityLabel: "Fresh project",
    });
    expect(events[0]!.changes).toEqual({
      tam: { id: tam.userId, username: tamRow.username },
      customer: { id: customer.id, name: customer.name },
    });
    expect(JSON.stringify(events)).not.toContain("@example.com");
  });

  it("an admin creating a project for a TAM notifies that TAM; a TAM creating their own is not notified", async () => {
    const { tam, customer } = await fixture();
    const admin = await createUserWithRole("ADMIN");
    const res = await request(app)
      .post("/projects")
      .set(auth(admin.token))
      .send({ name: "Admin-created", customerId: customer.id, tamId: tam.userId });
    expect(res.status).toBe(201);
    const [event] = await eventsOf(res.body.id);
    const rows = await prisma.notification.findMany({ where: { userId: tam.userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: "assigned", activityEventId: event!.id });
    expect(await prisma.notification.count({ where: { userId: admin.userId } })).toBe(0);

    const own = await request(app)
      .post("/projects")
      .set(auth(tam.token))
      .send({ name: "Self-created", customerId: customer.id });
    expect(own.status).toBe(201);
    expect(await prisma.notification.count({ where: { activityEvent: { projectId: own.body.id } } })).toBe(0);
  });
});

describe("project TAM changes", () => {
  const notificationsOf = (userId: number) =>
    prisma.notification.findMany({ where: { userId }, orderBy: { id: "asc" } });

  it("logs the TAM as from/to (ids and usernames) and notifies the new TAM, not the actor", async () => {
    const { tam, other, project } = await fixture();
    const res = await request(app)
      .patch(`/projects/${project.id}`)
      .set(auth(tam.token))
      .send({ tamId: other.userId });
    expect(res.status).toBe(200);
    const events = await eventsOf(project.id);
    expect(events).toHaveLength(1);
    const [tamRow, otherRow] = await Promise.all(
      [tam, other].map((u) => prisma.user.findUniqueOrThrow({ where: { id: u.userId } })),
    );
    expect(events[0]!.changes).toEqual({
      tam: {
        from: { id: tam.userId, username: tamRow!.username },
        to: { id: other.userId, username: otherRow!.username },
      },
    });
    expect(JSON.stringify(events)).not.toContain("@example.com");

    const newTam = await notificationsOf(other.userId);
    expect(newTam).toHaveLength(1);
    expect(newTam[0]).toMatchObject({ reason: "assigned", activityEventId: events[0]!.id });
    expect(await notificationsOf(tam.userId)).toHaveLength(0);
  });

  it("does not notify on an unrelated update, an inactive new TAM, or a re-save of the same TAM", async () => {
    const { tam, project } = await fixture();
    await request(app).patch(`/projects/${project.id}`).set(auth(tam.token)).send({ name: "Just a rename" });
    expect(await prisma.notification.count({ where: { activityEvent: { projectId: project.id } } })).toBe(0);

    const again = await request(app)
      .patch(`/projects/${project.id}`)
      .set(auth(tam.token))
      .send({ tamId: tam.userId });
    expect(again.status).toBe(200);
    expect(await eventsOf(project.id)).toHaveLength(1);

    const inactive = await createUserWithRole("TAM");
    await prisma.user.update({ where: { id: inactive.userId }, data: { active: false } });
    const admin = await createUserWithRole("ADMIN");
    const res = await request(app)
      .patch(`/projects/${project.id}`)
      .set(auth(admin.token))
      .send({ tamId: inactive.userId });
    expect(res.status).toBe(200);
    expect(await eventsOf(project.id)).toHaveLength(2);
    expect(await notificationsOf(inactive.userId)).toHaveLength(0);
  });
});

describe("epics", () => {
  it("create, update and delete each record one event; a no-op PATCH records nothing; descriptions never appear as text", async () => {
    const { tam, other, project } = await fixture();
    const created = await request(app)
      .post(`/projects/${project.id}/epics`)
      .set(auth(tam.token))
      .send({ title: "Launch", description: "secret epic text", ownerId: other.userId, dueDate: "2026-11-05" });
    expect(created.status).toBe(201);
    const epicId = created.body.id as number;
    const otherRow = await prisma.user.findUniqueOrThrow({ where: { id: other.userId } });
    let events = await eventsOf(project.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorId: tam.userId,
      entityType: "epic",
      entityId: epicId,
      action: "created",
      entityLabel: "Launch",
    });
    expect(events[0]!.changes).toEqual({
      owner: { from: null, to: { id: other.userId, username: otherRow.username } },
      dueDate: { from: null, to: "2026-11-05" },
    });

    // Identical values and a position-only write are not changes.
    const noop = await request(app)
      .patch(`/epics/${epicId}`)
      .set(auth(tam.token))
      .send({ title: "Launch", status: "TODO", position: 0 });
    expect(noop.status).toBe(200);
    expect(await eventsOf(project.id)).toHaveLength(1);

    const updated = await request(app)
      .patch(`/epics/${epicId}`)
      .set(auth(tam.token))
      .send({
        title: "Launch v2",
        status: "IN_PROGRESS",
        color: "#112233",
        ownerId: null,
        startDate: "2026-11-01",
        description: "new secret text",
      });
    expect(updated.status).toBe(200);
    events = await eventsOf(project.id);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ entityType: "epic", entityId: epicId, action: "updated", entityLabel: "Launch v2" });
    expect(events[1]!.changes).toEqual({
      title: { from: "Launch", to: "Launch v2" },
      status: { from: "TODO", to: "IN_PROGRESS" },
      color: { from: "#94a3b8", to: "#112233" },
      owner: { from: { id: other.userId, username: otherRow.username }, to: null },
      startDate: { from: null, to: "2026-11-01" },
      description: { changed: true },
    });
    expect(JSON.stringify(events)).not.toContain("secret");

    const task = await makeTask(project.id, { epicId });
    await makeTask(project.id, { epicId, position: 1 });
    const del = await request(app).delete(`/epics/${epicId}`).set(auth(tam.token));
    expect(del.status).toBe(204);
    events = await eventsOf(project.id);
    expect(events).toHaveLength(3);
    expect(events[2]).toMatchObject({
      entityType: "epic",
      entityId: epicId,
      action: "deleted",
      entityLabel: "Launch v2",
      changes: { taskCount: 2 },
    });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).epicId).toBeNull();
    // Epics never notify.
    expect(await prisma.notification.count({ where: { activityEvent: { projectId: project.id } } })).toBe(0);
  });

  it("a rejected epic write (no project:write) records nothing", async () => {
    const { tam, project } = await fixture();
    const created = await request(app)
      .post(`/projects/${project.id}/epics`)
      .set(auth(tam.token))
      .send({ title: "Guarded" });
    const auditor = await createUserWithRole("AUDITOR");
    const patch = await request(app).patch(`/epics/${created.body.id}`).set(auth(auditor.token)).send({ title: "x" });
    expect(patch.status).toBe(403);
    const del = await request(app).delete(`/epics/${created.body.id}`).set(auth(auditor.token));
    expect(del.status).toBe(403);
    expect(await eventsOf(project.id)).toHaveLength(1);
  });
});

describe("Admin › Project Override (PUT /admin/projects/reassign)", () => {
  it("logs the TAM change as from/to, notifies the new TAM and not the acting admin", async () => {
    const { tam, other, project } = await fixture();
    const admin = await createUserWithRole("ADMIN");
    const res = await request(app)
      .put("/admin/projects/reassign")
      .set(auth(admin.token))
      .send({ projectId: project.id, newTamId: other.userId });
    expect(res.status).toBe(200);
    expect(res.body.tam.id).toBe(other.userId);

    const events = await eventsOf(project.id);
    expect(events).toHaveLength(1);
    const [tamRow, otherRow] = await Promise.all(
      [tam, other].map((u) => prisma.user.findUniqueOrThrow({ where: { id: u.userId } })),
    );
    expect(events[0]).toMatchObject({
      actorId: admin.userId,
      entityType: "project",
      entityId: project.id,
      action: "updated",
    });
    expect(events[0]!.changes).toEqual({
      tam: {
        from: { id: tam.userId, username: tamRow!.username },
        to: { id: other.userId, username: otherRow!.username },
      },
    });
    expect(JSON.stringify(events)).not.toContain("@example.com");

    const rows = await prisma.notification.findMany({ where: { activityEvent: { projectId: project.id } } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: other.userId, reason: "assigned", activityEventId: events[0]!.id });
    expect(await prisma.notification.count({ where: { userId: admin.userId } })).toBe(0);
  });

  it("an admin assigning themselves is not notified; reassigning to the current TAM records nothing; an unknown project is 404", async () => {
    const { tam, project } = await fixture();
    const admin = await createUserWithRole("ADMIN");
    const self = await request(app)
      .put("/admin/projects/reassign")
      .set(auth(admin.token))
      .send({ projectId: project.id, newTamId: admin.userId });
    expect(self.status).toBe(200);
    expect(await eventsOf(project.id)).toHaveLength(1);
    expect(await prisma.notification.count({ where: { userId: admin.userId } })).toBe(0);

    const same = await request(app)
      .put("/admin/projects/reassign")
      .set(auth(admin.token))
      .send({ projectId: project.id, newTamId: admin.userId });
    expect(same.status).toBe(200);
    expect(await eventsOf(project.id)).toHaveLength(1);

    const missing = await request(app)
      .put("/admin/projects/reassign")
      .set(auth(admin.token))
      .send({ projectId: 999_999_999, newTamId: tam.userId });
    expect(missing.status).toBe(404);

    const nonAdmin = await request(app)
      .put("/admin/projects/reassign")
      .set(auth(tam.token))
      .send({ projectId: project.id, newTamId: tam.userId });
    expect(nonAdmin.status).toBe(403);
  });
});
