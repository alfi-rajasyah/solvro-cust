// In-app notifications (docs/archive/plans/collaboration-and-sharing.md, C5b):
// creation rules in the same transaction as the activity event, and the
// /notifications API. Fixtures write via `prisma` directly.
import "./env.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { recordActivity } from "../src/lib/activity.js";
import { filterActiveUsersWhoCanSeeProject, notifyForEvent } from "../src/lib/notifications.js";
import { projectVisibilityFilter } from "../src/lib/visibility.js";
import { PrismaClient } from "@prisma/client";
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
  const third = await createUserWithRole("TAM");
  const customer = await prisma.customer.create({
    data: { name: uniq("Customer"), description: "d", tamId: tam.userId },
  });
  const project = await prisma.project.create({
    data: { name: uniq("Project"), tamId: tam.userId, customerId: customer.id, status: "ACTIVE" },
  });
  return { tam, other, third, customer, project };
}

async function makeTask(projectId: number, extra: Record<string, unknown> = {}) {
  return prisma.task.create({
    data: { projectId, title: uniq("Task"), status: "TODO", priority: "MEDIUM", position: 0, ...extra },
  });
}

/**
 * Reference implementation for the batch check: one user at a time through
 * `projectVisibilityFilter`, the rule every route uses.
 */
async function isActiveUserWhoCanSeeProject(userId: number, projectId: number): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { active: true, role: { select: { roleName: true, permissions: true } } },
  });
  if (!user?.active) return false;
  const payload = {
    sub: userId,
    role: user.role.roleName,
    permissions: user.role.permissions as string[],
  };
  const visible = await prisma.project.findFirst({
    where: { id: projectId, ...projectVisibilityFilter(payload) },
    select: { id: true },
  });
  return visible !== null;
}

const notesFor = (userId: number) =>
  prisma.notification.findMany({ where: { userId }, orderBy: { id: "asc" } });

const patchTask = (token: string, id: number, body: Record<string, unknown>) =>
  request(app).patch(`/tasks/${id}`).set(auth(token)).send(body);

describe("assigned", () => {
  it("task update assigning someone else notifies them once, and a re-save does not repeat", async () => {
    const { tam, other, project } = await fixture();
    const task = await makeTask(project.id, { title: "Assign me" });
    expect((await patchTask(tam.token, task.id, { assignedToId: other.userId })).status).toBe(200);
    const rows = await notesFor(other.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: "assigned", readAt: null });
    const event = await prisma.activityEvent.findUniqueOrThrow({ where: { id: rows[0]!.activityEventId } });
    expect(event).toMatchObject({ entityType: "task", entityId: task.id, action: "updated" });
    expect(await notesFor(tam.userId)).toHaveLength(0);

    await patchTask(tam.token, task.id, { assignedToId: other.userId, title: "Renamed" });
    expect(await notesFor(other.userId)).toHaveLength(1);
  });

  it("task create with an assignee notifies them; unassigned create notifies nobody", async () => {
    const { tam, other, project } = await fixture();
    const before = await prisma.notification.count();
    await request(app).post(`/projects/${project.id}/tasks`).set(auth(tam.token)).send({ title: "Nobody" });
    expect(await prisma.notification.count()).toBe(before);
    const res = await request(app)
      .post(`/projects/${project.id}/tasks`)
      .set(auth(tam.token))
      .send({ title: "Mine", assignedToId: other.userId });
    expect(res.status).toBe(201);
    const rows = await notesFor(other.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).toBe("assigned");
  });

  it("never notifies the actor (self-assign)", async () => {
    const { tam, project } = await fixture();
    const task = await makeTask(project.id);
    await patchTask(tam.token, task.id, { assignedToId: tam.userId });
    expect(await notesFor(tam.userId)).toHaveLength(0);
  });

  it("duplicating an assigned task never notifies", async () => {
    const { tam, other, project } = await fixture();
    const task = await makeTask(project.id, { assignedToId: other.userId });
    await prisma.projectMember.create({ data: { projectId: project.id, userId: other.userId } });
    const res = await request(app).post(`/tasks/${task.id}/duplicate`).set(auth(tam.token));
    expect(res.status).toBe(201);
    expect(await notesFor(other.userId)).toHaveLength(0);
  });

  it("skips an inactive assignee", async () => {
    const { tam, other, project } = await fixture();
    await prisma.projectMember.create({ data: { projectId: project.id, userId: other.userId } });
    await prisma.user.update({ where: { id: other.userId }, data: { active: false } });
    const task = await makeTask(project.id);
    expect((await patchTask(tam.token, task.id, { assignedToId: other.userId })).status).toBe(200);
    expect(await notesFor(other.userId)).toHaveLength(0);
  });

  it("two simultaneous identical assign PATCHes create exactly one notification", async () => {
    const { tam, other, project } = await fixture();
    const task = await makeTask(project.id);
    const send = () => patchTask(tam.token, task.id, { assignedToId: other.userId });
    const [a, b] = await Promise.all([send(), send()]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await notesFor(other.userId)).toHaveLength(1);
  });

  it("a stale_write 409 leaves no notification", async () => {
    const { tam, other, project } = await fixture();
    const task = await makeTask(project.id, { title: "Theirs" });
    const res = await patchTask(tam.token, task.id, {
      assignedToId: other.userId,
      expected: { title: "Mine" },
    });
    expect(res.status).toBe(409);
    expect(await notesFor(other.userId)).toHaveLength(0);
  });
});

describe("commented", () => {
  it("a comment by someone else notifies the task's assignee once", async () => {
    const { tam, other, project } = await fixture();
    await prisma.projectMember.create({ data: { projectId: project.id, userId: other.userId } });
    const task = await makeTask(project.id, { assignedToId: other.userId });
    const res = await request(app)
      .post(`/tasks/${task.id}/comments`)
      .set(auth(tam.token))
      .send({ body: "hello" });
    expect(res.status).toBe(201);
    const rows = await notesFor(other.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).toBe("commented");
    expect(await notesFor(tam.userId)).toHaveLength(0);
  });

  it("the assignee commenting on their own task notifies nobody", async () => {
    const { other, project } = await fixture();
    await prisma.projectMember.create({ data: { projectId: project.id, userId: other.userId } });
    const task = await makeTask(project.id, { assignedToId: other.userId });
    const res = await request(app)
      .post(`/tasks/${task.id}/comments`)
      .set(auth(other.token))
      .send({ body: "note to self" });
    expect(res.status).toBe(201);
    expect(await notesFor(other.userId)).toHaveLength(0);
  });

  it("a comment on an unassigned task notifies nobody", async () => {
    const { tam, project } = await fixture();
    const before = await prisma.notification.count();
    const task = await makeTask(project.id);
    await request(app).post(`/tasks/${task.id}/comments`).set(auth(tam.token)).send({ body: "x" });
    expect(await prisma.notification.count()).toBe(before);
  });

  it("skips an assignee who cannot see the project and one who is inactive", async () => {
    const { tam, other, third, project } = await fixture();
    // `other` is not a member (assigned directly via prisma) -> cannot see.
    const hidden = await makeTask(project.id, { assignedToId: other.userId });
    await request(app).post(`/tasks/${hidden.id}/comments`).set(auth(tam.token)).send({ body: "x" });
    expect(await notesFor(other.userId)).toHaveLength(0);

    await prisma.projectMember.create({ data: { projectId: project.id, userId: third.userId } });
    await prisma.user.update({ where: { id: third.userId }, data: { active: false } });
    const inactive = await makeTask(project.id, { assignedToId: third.userId });
    await request(app).post(`/tasks/${inactive.id}/comments`).set(auth(tam.token)).send({ body: "x" });
    expect(await notesFor(third.userId)).toHaveLength(0);
  });
});

describe("notifyForEvent", () => {
  async function commentEvent(projectId: number, actorId: number) {
    return recordActivity(prisma, {
      projectId,
      actorId,
      entityType: "comment",
      entityId: 1,
      action: "created",
      entityLabel: "T",
      changes: { taskId: 1 },
    });
  }

  it("a mention wins over commented: one notification per user per event", async () => {
    const { tam, other, third, project } = await fixture();
    await prisma.projectMember.createMany({
      data: [
        { projectId: project.id, userId: other.userId },
        { projectId: project.id, userId: third.userId },
      ],
    });
    const event = await commentEvent(project.id, tam.userId);
    const count = await notifyForEvent(prisma, event, {
      taskAssigneeId: other.userId,
      mentionedUserIds: [other.userId, third.userId, tam.userId],
    });
    expect(count).toBe(2);
    expect((await notesFor(other.userId)).map((n) => n.reason)).toEqual(["mentioned"]);
    expect((await notesFor(third.userId)).map((n) => n.reason)).toEqual(["mentioned"]);
    expect(await notesFor(tam.userId)).toHaveLength(0);
  });

  it("a rolled-back transaction leaves neither event nor notification", async () => {
    const { tam, other, project } = await fixture();
    await prisma.projectMember.create({ data: { projectId: project.id, userId: other.userId } });
    await expect(
      prisma.$transaction(async (tx) => {
        const event = await recordActivity(tx, {
          projectId: project.id,
          actorId: tam.userId,
          entityType: "comment",
          entityId: 2,
          action: "created",
        });
        await notifyForEvent(tx, event, { taskAssigneeId: other.userId });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await notesFor(other.userId)).toHaveLength(0);
    expect(await prisma.activityEvent.count({ where: { projectId: project.id } })).toBe(0);
  });
});

describe("GET /notifications", () => {
  async function seed(userId: number, projectId: number, n: number) {
    const ids: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const event = await prisma.activityEvent.create({
        data: {
          projectId,
          actorId: null,
          entityType: "task",
          entityId: i + 1,
          action: "updated",
          entityLabel: `T${i}`,
          changes: { assignee: { from: null, to: { id: userId, username: "u" } } },
        },
      });
      const row = await prisma.notification.create({
        data: { userId, activityEventId: event.id, reason: "assigned" },
      });
      ids.push(row.id);
    }
    return ids;
  }

  it("lists own rows newest first with the feed event shape, pages, and hides other users' rows", async () => {
    const { tam, other, project } = await fixture();
    await prisma.projectMember.create({ data: { projectId: project.id, userId: other.userId } });
    const ids = await seed(other.userId, project.id, 3);
    await seed(tam.userId, project.id, 1);

    const first = await request(app).get("/notifications?limit=2").set(auth(other.token));
    expect(first.status).toBe(200);
    expect(first.body.notifications.map((n: { id: number }) => n.id)).toEqual([ids[2], ids[1]]);
    expect(first.body.nextBefore).toBe(ids[1]);
    expect(first.body.notifications[0]).toMatchObject({
      reason: "assigned",
      readAt: null,
      projectId: project.id,
      projectName: project.name,
      event: {
        entityType: "task",
        action: "updated",
        entityLabel: "T2",
        actor: null,
      },
    });
    expect(Object.keys(first.body.notifications[0].event).sort()).toEqual(
      ["action", "actor", "changes", "createdAt", "entityId", "entityLabel", "entityType", "id"].sort(),
    );
    const second = await request(app)
      .get(`/notifications?limit=2&before=${first.body.nextBefore}`)
      .set(auth(other.token));
    expect(second.body.notifications.map((n: { id: number }) => n.id)).toEqual([ids[0]]);
    expect(second.body.nextBefore).toBeNull();
  });

  it("drops rows (and unread count) for a project the caller can no longer see", async () => {
    const { other, project } = await fixture();
    await prisma.projectMember.create({ data: { projectId: project.id, userId: other.userId } });
    await seed(other.userId, project.id, 2);
    const visible = await request(app).get("/notifications/unread-count").set(auth(other.token));
    expect(visible.body).toEqual({ count: 2 });

    await prisma.projectMember.deleteMany({ where: { projectId: project.id, userId: other.userId } });
    const list = await request(app).get("/notifications").set(auth(other.token));
    expect(list.body.notifications).toHaveLength(0);
    const count = await request(app).get("/notifications/unread-count").set(auth(other.token));
    expect(count.body).toEqual({ count: 0 });
  });

  it("requires authentication", async () => {
    expect((await request(app).get("/notifications")).status).toBe(401);
    expect((await request(app).get("/notifications/unread-count")).status).toBe(401);
  });
});

describe("read / read-all", () => {
  async function one(userId: number, projectId: number) {
    const event = await prisma.activityEvent.create({
      data: { projectId, entityType: "task", entityId: 1, action: "created" },
    });
    return prisma.notification.create({
      data: { userId, activityEventId: event.id, reason: "assigned" },
    });
  }

  it("marks one read (idempotent), 404 for someone else's row, and lowers the unread count", async () => {
    const { other, third, project } = await fixture();
    await prisma.projectMember.createMany({
      data: [
        { projectId: project.id, userId: other.userId },
        { projectId: project.id, userId: third.userId },
      ],
    });
    const mine = await one(other.userId, project.id);
    await one(other.userId, project.id);

    const foreign = await request(app).post(`/notifications/${mine.id}/read`).set(auth(third.token));
    expect(foreign.status).toBe(404);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: mine.id } })).readAt).toBeNull();

    const res = await request(app).post(`/notifications/${mine.id}/read`).set(auth(other.token));
    expect(res.status).toBe(200);
    const again = await request(app).post(`/notifications/${mine.id}/read`).set(auth(other.token));
    expect(again.body.readAt).toBe(res.body.readAt);
    const count = await request(app).get("/notifications/unread-count").set(auth(other.token));
    expect(count.body).toEqual({ count: 1 });
    expect((await request(app).post("/notifications/999999999/read").set(auth(other.token))).status).toBe(404);
  });

  it("read-all marks only the caller's unread rows", async () => {
    const { other, third, project } = await fixture();
    await prisma.projectMember.createMany({
      data: [
        { projectId: project.id, userId: other.userId },
        { projectId: project.id, userId: third.userId },
      ],
    });
    await one(other.userId, project.id);
    await one(other.userId, project.id);
    const theirs = await one(third.userId, project.id);
    const res = await request(app).post("/notifications/read-all").set(auth(other.token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 2 });
    expect((await request(app).get("/notifications/unread-count").set(auth(other.token))).body).toEqual({ count: 0 });
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: theirs.id } })).readAt).toBeNull();
  });
});

describe("retention cascade", () => {
  it("deleting expired events removes their notifications", async () => {
    const { other, project } = await fixture();
    const old = await prisma.activityEvent.create({
      data: {
        projectId: project.id,
        entityType: "task",
        entityId: 1,
        action: "created",
        createdAt: new Date(Date.now() - 200 * 86_400_000),
      },
    });
    const fresh = await prisma.activityEvent.create({
      data: { projectId: project.id, entityType: "task", entityId: 2, action: "created" },
    });
    await prisma.notification.create({ data: { userId: other.userId, activityEventId: old.id, reason: "assigned" } });
    await prisma.notification.create({ data: { userId: other.userId, activityEventId: fresh.id, reason: "assigned" } });
    await deleteExpiredActivityEvents();
    const left = await notesFor(other.userId);
    expect(left.map((n) => n.activityEventId)).toEqual([fresh.id]);
  });
});

describe("visibility arms for recipients", () => {
  const comment = (token: string, taskId: number) =>
    request(app).post(`/tasks/${taskId}/comments`).set(auth(token)).send({ body: "ping" });

  it("notifies an assignee who sees the project only through project:view-all or *", async () => {
    const { tam, project } = await fixture();
    const stakeholder = await createUserWithRole("AUDITOR");
    const admin = await createUserWithRole("ADMIN");
    for (const viewer of [stakeholder, admin]) {
      const task = await makeTask(project.id, { assignedToId: viewer.userId });
      expect((await comment(tam.token, task.id)).status).toBe(201);
      const rows = await notesFor(viewer.userId);
      expect(rows.map((r) => r.reason)).toEqual(["commented"]);
    }
  });

  it("notifies an assignee who sees the project only as the customer owner", async () => {
    const { tam, third, project } = await fixture();
    const customer = await prisma.customer.create({
      data: { name: uniq("OwnedCustomer"), description: "d", tamId: third.userId },
    });
    const owned = await prisma.project.create({
      data: { name: uniq("P"), tamId: tam.userId, customerId: customer.id, status: "ACTIVE" },
    });
    expect(project.id).not.toBe(owned.id);
    const task = await makeTask(owned.id, { assignedToId: third.userId });
    expect((await comment(tam.token, task.id)).status).toBe(201);
    expect((await notesFor(third.userId)).map((r) => r.reason)).toEqual(["commented"]);
  });

  it("the batch check agrees with projectVisibilityFilter for every arm", async () => {
    const { tam, other, third, project } = await fixture();
    const stakeholder = await createUserWithRole("AUDITOR");
    const admin = await createUserWithRole("ADMIN");
    const stranger = await createUserWithRole("TAM");
    const inactiveMember = await createUserWithRole("TAM");
    const owner = await createUserWithRole("TAM");
    const customer = await prisma.customer.create({
      data: { name: uniq("C"), description: "d", tamId: owner.userId },
    });
    const p = await prisma.project.create({
      data: { name: uniq("P"), tamId: tam.userId, customerId: customer.id, status: "ACTIVE" },
    });
    await prisma.projectMember.createMany({
      data: [
        { projectId: p.id, userId: other.userId },
        { projectId: p.id, userId: inactiveMember.userId },
      ],
    });
    await prisma.user.update({ where: { id: inactiveMember.userId }, data: { active: false } });
    const everyone = [tam, other, third, stakeholder, admin, stranger, inactiveMember, owner].map(
      (u) => u.userId,
    );
    const batch = await filterActiveUsersWhoCanSeeProject(prisma, p.id, [...everyone, 999_999_999]);
    for (const uid of everyone) {
      expect(batch.has(uid), `user ${uid}`).toBe(await isActiveUserWhoCanSeeProject(uid, p.id));
    }
    expect([...batch].sort()).toEqual(
      [tam, other, stakeholder, admin, owner].map((u) => u.userId).sort(),
    );
    expect(batch.has(999_999_999)).toBe(false);
    expect(project.id).toBeGreaterThan(0);
  });
});

describe("@mentions", () => {
  const post = (token: string, taskId: number, body: Record<string, unknown>) =>
    request(app).post(`/tasks/${taskId}/comments`).set(auth(token)).send(body);

  async function team() {
    const f = await fixture();
    const [a, b] = await Promise.all([createUserWithRole("TAM"), createUserWithRole("TAM")]);
    await prisma.projectMember.createMany({
      data: [f.other.userId, f.third.userId, a.userId, b.userId].map((userId) => ({
        projectId: f.project.id,
        userId,
      })),
    });
    return { ...f, a, b };
  }

  it("mentioned users get exactly one `mentioned` row and the stored list is returned", async () => {
    const { tam, other, third, project } = await team();
    const task = await makeTask(project.id);
    const res = await post(tam.token, task.id, {
      body: "look @a",
      mentionedUserIds: [other.userId, third.userId, other.userId],
    });
    expect(res.status).toBe(201);
    expect(res.body.mentionedUserIds).toEqual([other.userId, third.userId]);
    expect((await notesFor(other.userId)).map((n) => n.reason)).toEqual(["mentioned"]);
    expect((await notesFor(third.userId)).map((n) => n.reason)).toEqual(["mentioned"]);
    expect(await notesFor(tam.userId)).toHaveLength(0);

    const list = await request(app).get(`/tasks/${task.id}/comments`).set(auth(tam.token));
    expect(list.body[0].mentionedUserIds).toEqual([other.userId, third.userId]);
    // The activity event stays free of the mention ids and the body.
    const event = await prisma.activityEvent.findFirstOrThrow({
      where: { projectId: project.id, entityType: "comment" },
    });
    expect(event.changes).toEqual({ taskId: task.id });
  });

  it("a mentioned assignee gets `mentioned` only, not also `commented`", async () => {
    const { tam, other, project } = await team();
    const task = await makeTask(project.id, { assignedToId: other.userId });
    await post(tam.token, task.id, { body: "x", mentionedUserIds: [other.userId] });
    expect((await notesFor(other.userId)).map((n) => n.reason)).toEqual(["mentioned"]);
  });

  it("keeps a self-mention in the stored list but never notifies the commenter", async () => {
    const { tam, project } = await team();
    const task = await makeTask(project.id);
    const res = await post(tam.token, task.id, { body: "x", mentionedUserIds: [tam.userId] });
    expect(res.status).toBe(201);
    expect(res.body.mentionedUserIds).toEqual([tam.userId]);
    expect(await notesFor(tam.userId)).toHaveLength(0);
  });

  it("drops inactive, non-visible and unknown ids from the stored list and notifies none of them", async () => {
    const { tam, other, third, a, project } = await team();
    const outsider = await createUserWithRole("TAM");
    await prisma.user.update({ where: { id: third.userId }, data: { active: false } });
    const task = await makeTask(project.id);
    const res = await post(tam.token, task.id, {
      body: "x",
      mentionedUserIds: [outsider.userId, third.userId, 999_999_999, other.userId, a.userId],
    });
    expect(res.status).toBe(201);
    expect(res.body.mentionedUserIds).toEqual([other.userId, a.userId]);
    expect(await notesFor(outsider.userId)).toHaveLength(0);
    expect(await notesFor(third.userId)).toHaveLength(0);
    const stored = await prisma.comment.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored.mentionedUserIds).toEqual([other.userId, a.userId]);
  });

  it("rejects more than 20 mentions and a comment without mentions stores an empty list", async () => {
    const { tam, project } = await team();
    const task = await makeTask(project.id);
    const many = Array.from({ length: 21 }, (_, i) => i + 1);
    expect((await post(tam.token, task.id, { body: "x", mentionedUserIds: many })).status).toBe(400);
    const plain = await post(tam.token, task.id, { body: "x" });
    expect(plain.status).toBe(201);
    expect(plain.body.mentionedUserIds).toEqual([]);
  });

  it("a rolled-back transaction leaves no comment, event or notification", async () => {
    const { tam, other, project } = await team();
    const task = await makeTask(project.id);
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.comment.create({
          data: { taskId: task.id, authorId: tam.userId, body: "x", mentionedUserIds: [other.userId] },
        });
        const event = await recordActivity(tx, {
          projectId: project.id,
          actorId: tam.userId,
          entityType: "comment",
          entityId: 1,
          action: "created",
        });
        await notifyForEvent(tx, event, { mentionedUserIds: [other.userId] });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await notesFor(other.userId)).toHaveLength(0);
    expect(await prisma.comment.count({ where: { taskId: task.id } })).toBe(0);
  });

  it("recipient checks use a fixed number of queries however many are mentioned", async () => {
    const { tam, other, project } = await team();
    const crowd = await Promise.all(Array.from({ length: 20 }, () => createUserWithRole("TAM")));
    await prisma.projectMember.createMany({
      data: crowd.map((u) => ({ projectId: project.id, userId: u.userId })),
    });
    const logged = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } },
      log: [{ emit: "event", level: "query" }],
    });
    try {
      // Prisma delivers query-log events asynchronously: the implicit
      // transaction's COMMIT that `createMany` issues can be logged AFTER the
      // awaited call has already resolved, so counting right after the call
      // sometimes attributed it to the next measurement (7 vs 8 in CI). Events
      // do arrive in order, so we flush by running a marker statement and
      // waiting until its own event shows up: everything before it is complete.
      const MARKER = "SELECT 'query-log-flush' AS marker";
      let seen: string[] = [];
      let onMarker: (() => void) | undefined;
      logged.$on("query", (e) => {
        if (e.query.includes("query-log-flush")) onMarker?.();
        else seen.push(e.query);
      });
      const measure = async (ids: number[]) => {
        const event = await recordActivity(prisma, {
          projectId: project.id,
          actorId: tam.userId,
          entityType: "comment",
          entityId: 1,
          action: "created",
        });
        seen = [];
        const created = await notifyForEvent(logged, event, { mentionedUserIds: ids });
        let timer: ReturnType<typeof setTimeout> | undefined;
        const flushed = new Promise<void>((resolve, reject) => {
          onMarker = resolve;
          timer = setTimeout(() => reject(new Error("query log never delivered the marker")), 5_000);
        });
        try {
          await logged.$queryRawUnsafe(MARKER);
          await flushed;
        } finally {
          clearTimeout(timer);
        }
        return { created, statements: [...seen] };
      };
      const one = await measure([other.userId]);
      const twenty = await measure(crowd.map((u) => u.userId));
      expect(one.created).toBe(1);
      expect(twenty.created).toBe(20);
      // The point: statement count does not grow with the number of mentions...
      expect(twenty.statements).toHaveLength(one.statements.length);
      // ...and stays a handful: Prisma splits the nested user->role and
      // project->customer/members reads into separate statements (5 reads),
      // plus createMany's implicit BEGIN / INSERT / COMMIT.
      expect(twenty.statements.length).toBeLessThanOrEqual(8);
    } finally {
      await logged.$disconnect();
    }
  });
});
