import "./env.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { SID } from "./statusFixtures.js";
import { createUserWithRole, seedRoles } from "./testAuth.js";

// PATCH/DELETE /tasks/:id/comments/:commentId (docs/archive/plans/comment-edit-delete.md).

const app = createApp();

beforeAll(async () => {
  await seedRoles();
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function fixture() {
  const author = await createUserWithRole("TAM");
  const member = await createUserWithRole("TAM");
  const stakeholder = await createUserWithRole("STAKEHOLDER");
  const noComment = await createUserWithRole("AUDITOR"); // sees all, lacks task:comment
  const admin = await createUserWithRole("ADMIN");
  const project = await prisma.project.create({
    data: { name: `P ${Date.now()}-${Math.random()}`, tamId: author.userId, status: "ACTIVE" },
  });
  await prisma.projectMember.createMany({
    data: [member.userId, stakeholder.userId].map((userId) => ({ projectId: project.id, userId })),
  });
  const mk = (title: string) =>
    prisma.task.create({
      data: { statusId: SID.TODO, projectId: project.id, title, status: "TODO", priority: "MEDIUM", position: 0 },
    });
  const task = await mk("Task A");
  const otherTask = await mk("Task B");
  const comment = await prisma.comment.create({
    data: { taskId: task.id, authorId: author.userId, body: "original SECRET body" },
  });
  return { author, member, stakeholder, noComment, admin, project, task, otherTask, comment };
}

const patch = (token: string, taskId: number, commentId: number, body: unknown) =>
  request(app).patch(`/tasks/${taskId}/comments/${commentId}`).set(auth(token)).send(body as object);
const del = (token: string, taskId: number, commentId: number) =>
  request(app).delete(`/tasks/${taskId}/comments/${commentId}`).set(auth(token));

describe("PATCH /tasks/:id/comments/:commentId", () => {
  it("lets the author edit: 200, editedAt set, GET shape with author and inboundHook", async () => {
    const f = await fixture();
    const res = await patch(f.author.token, f.task.id, f.comment.id, { body: "new body" });
    expect(res.status).toBe(200);
    expect(res.body.body).toBe("new body");
    expect(res.body.editedAt).toEqual(expect.any(String));
    expect(res.body.author).toMatchObject({ id: f.author.userId });
    expect(res.body).toHaveProperty("inboundHook", null);
    const list = await request(app).get(`/tasks/${f.task.id}/comments`).set(auth(f.author.token));
    expect(list.body[0].editedAt).toBe(res.body.editedAt);
  });

  it("GET and POST carry editedAt: null for an unedited comment", async () => {
    const f = await fixture();
    const posted = await request(app)
      .post(`/tasks/${f.task.id}/comments`)
      .set(auth(f.author.token))
      .send({ body: "hi" });
    expect(posted.body).toHaveProperty("editedAt", null);
    const list = await request(app).get(`/tasks/${f.task.id}/comments`).set(auth(f.author.token));
    expect(list.body.every((c: { editedAt: unknown }) => c.editedAt === null)).toBe(true);
  });

  it("403s not_comment_author for another member, a stakeholder and an admin", async () => {
    const f = await fixture();
    for (const who of [f.member, f.stakeholder, f.admin]) {
      const res = await patch(who.token, f.task.id, f.comment.id, { body: "hijack" });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("not_comment_author");
    }
    const row = await prisma.comment.findUniqueOrThrow({ where: { id: f.comment.id } });
    expect(row.body).toBe("original SECRET body");
  });

  it("lets a read-only stakeholder edit their own comment", async () => {
    const f = await fixture();
    const own = await prisma.comment.create({
      data: { taskId: f.task.id, authorId: f.stakeholder.userId, body: "mine" },
    });
    const res = await patch(f.stakeholder.token, f.task.id, own.id, { body: "mine, edited" });
    expect(res.status).toBe(200);
  });

  it("403s forbidden for a user without task:comment, even on their own comment", async () => {
    const f = await fixture();
    const own = await prisma.comment.create({
      data: { taskId: f.task.id, authorId: f.noComment.userId, body: "mine" },
    });
    const res = await patch(f.noComment.token, f.task.id, own.id, { body: "x" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("forbidden");
  });

  it("404s a comment that belongs to another task, and an unknown id", async () => {
    const f = await fixture();
    const cross = await patch(f.author.token, f.otherTask.id, f.comment.id, { body: "x" });
    expect(cross.status).toBe(404);
    expect(cross.body.code).toBe("comment_not_found");
    const unknown = await patch(f.author.token, f.task.id, 999999999, { body: "x" });
    expect(unknown.status).toBe(404);
  });

  it("409s comment_not_editable for an incoming comment", async () => {
    const f = await fixture();
    const hook = await prisma.inboundHook.create({
      data: { projectId: f.project.id, createdById: f.author.userId, name: "CI", tokenHash: `h${Math.random()}`, tokenPreview: "abcd" },
    });
    const incoming = await prisma.comment.create({
      data: { taskId: f.task.id, authorId: f.author.userId, body: "Deployed", source: "incoming", inboundHookId: hook.id },
    });
    const res = await patch(f.author.token, f.task.id, incoming.id, { body: "edit" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("comment_not_editable");
  });

  it("validates the body like POST", async () => {
    const f = await fixture();
    expect((await patch(f.author.token, f.task.id, f.comment.id, { body: "" })).status).toBe(400);
    expect((await patch(f.author.token, f.task.id, f.comment.id, { body: "x".repeat(5001) })).status).toBe(400);
  });

  it("an unchanged save keeps editedAt null and records no activity", async () => {
    const f = await fixture();
    const before = await prisma.activityEvent.count({ where: { entityType: "comment", entityId: f.comment.id } });
    const res = await patch(f.author.token, f.task.id, f.comment.id, { body: "original SECRET body" });
    expect(res.status).toBe(200);
    expect(res.body.editedAt).toBeNull();
    expect(await prisma.activityEvent.count({ where: { entityType: "comment", entityId: f.comment.id } })).toBe(before);
  });

  it("records a comment/updated activity row that never carries the body", async () => {
    const f = await fixture();
    await patch(f.author.token, f.task.id, f.comment.id, { body: "brand new TOPSECRET text" });
    const ev = await prisma.activityEvent.findFirstOrThrow({
      where: { entityType: "comment", entityId: f.comment.id, action: "updated" },
    });
    expect(ev.entityLabel).toBe("Task A");
    expect(ev.changes).toEqual({ taskId: f.task.id });
    expect(JSON.stringify(ev)).not.toMatch(/SECRET/);
  });

  it("a mention-only change sets editedAt; mentions are filtered and only new ones notified", async () => {
    const f = await fixture();
    const outsider = await createUserWithRole("TAM"); // cannot see the project
    const created = await request(app)
      .post(`/tasks/${f.task.id}/comments`)
      .set(auth(f.author.token))
      .send({ body: "hi", mentionedUserIds: [f.member.userId] });
    expect(created.status).toBe(201);
    const id = created.body.id as number;
    const notified = (userId: number) => prisma.notification.count({ where: { userId } });
    expect(await notified(f.member.userId)).toBe(1);

    const res = await patch(f.author.token, f.task.id, id, {
      body: "hi",
      mentionedUserIds: [f.member.userId, f.stakeholder.userId, outsider.userId, 987654321],
    });
    expect(res.status).toBe(200);
    expect(res.body.editedAt).toEqual(expect.any(String));
    expect(res.body.mentionedUserIds.sort()).toEqual([f.member.userId, f.stakeholder.userId].sort());
    expect(await notified(f.member.userId)).toBe(1); // already mentioned, not again
    expect(await notified(f.stakeholder.userId)).toBe(1);
    expect(await notified(outsider.userId)).toBe(0);
  });

  it("does not notify the task assignee on an edit", async () => {
    const f = await fixture();
    await prisma.task.update({ where: { id: f.task.id }, data: { assignedToId: f.member.userId } });
    await patch(f.author.token, f.task.id, f.comment.id, { body: "changed" });
    expect(await prisma.notification.count({ where: { userId: f.member.userId } })).toBe(0);
  });
});

describe("DELETE /tasks/:id/comments/:commentId", () => {
  it("lets the author delete: 204, row gone, activity without body", async () => {
    const f = await fixture();
    const res = await del(f.author.token, f.task.id, f.comment.id);
    expect(res.status).toBe(204);
    expect(await prisma.comment.findUnique({ where: { id: f.comment.id } })).toBeNull();
    const ev = await prisma.activityEvent.findFirstOrThrow({
      where: { entityType: "comment", entityId: f.comment.id, action: "deleted" },
    });
    expect(ev.entityLabel).toBe("Task A");
    expect(ev.changes).toEqual({ taskId: f.task.id });
    expect(JSON.stringify(ev)).not.toMatch(/SECRET/);
  });

  it("lets an admin delete someone else's comment", async () => {
    const f = await fixture();
    expect((await del(f.admin.token, f.task.id, f.comment.id)).status).toBe(204);
  });

  it("403s not_comment_author for another member and a stakeholder", async () => {
    const f = await fixture();
    for (const who of [f.member, f.stakeholder]) {
      const res = await del(who.token, f.task.id, f.comment.id);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("not_comment_author");
    }
    expect(await prisma.comment.findUnique({ where: { id: f.comment.id } })).not.toBeNull();
  });

  it("403s forbidden for a user without task:comment", async () => {
    const f = await fixture();
    const res = await del(f.noComment.token, f.task.id, f.comment.id);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("forbidden");
  });

  it("404s a cross-task comment id", async () => {
    const f = await fixture();
    const res = await del(f.author.token, f.otherTask.id, f.comment.id);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("comment_not_found");
    expect(await prisma.comment.findUnique({ where: { id: f.comment.id } })).not.toBeNull();
  });

  it("deletes an incoming comment (author or admin) and records source in the activity", async () => {
    const f = await fixture();
    const hook = await prisma.inboundHook.create({
      data: { projectId: f.project.id, createdById: f.author.userId, name: "CI", tokenHash: `h${Math.random()}`, tokenPreview: "abcd" },
    });
    const mkIncoming = () =>
      prisma.comment.create({
        data: { taskId: f.task.id, authorId: f.author.userId, body: "Deployed", source: "incoming", inboundHookId: hook.id },
      });
    const a = await mkIncoming();
    expect((await del(f.author.token, f.task.id, a.id)).status).toBe(204);
    const b = await mkIncoming();
    expect((await del(f.admin.token, f.task.id, b.id)).status).toBe(204);
    const ev = await prisma.activityEvent.findFirstOrThrow({
      where: { entityType: "comment", entityId: a.id, action: "deleted" },
    });
    expect(ev.changes).toEqual({ taskId: f.task.id, source: "incoming" });
  });
});
