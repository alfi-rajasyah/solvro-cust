// Task.storyPoints: whole numbers 0-100 or null on create and PATCH, per-field
// stale-write check, copied by task and section duplicate, logged as activity.
import "./env.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { createUserWithRole, seedRoles } from "./testAuth.js";

const app = createApp();

beforeAll(async () => {
  await seedRoles();
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function fixture() {
  const tam = await createUserWithRole("TAM");
  const project = await prisma.project.create({
    data: { name: `SP ${Date.now()}-${Math.random()}`, tamId: tam.userId, status: "ACTIVE" },
  });
  return { tam, project };
}

const create = (token: string, projectId: number, body: object) =>
  request(app).post(`/projects/${projectId}/tasks`).set(auth(token)).send({ title: "T", ...body });
const patch = (token: string, id: number, body: object) =>
  request(app).patch(`/tasks/${id}`).set(auth(token)).send(body);

describe("storyPoints validation", () => {
  it("defaults to null and accepts 0 and 100 on create", async () => {
    const { tam, project } = await fixture();
    expect((await create(tam.token, project.id, {})).body.storyPoints).toBeNull();
    const zero = await create(tam.token, project.id, { storyPoints: 0 });
    expect(zero.status).toBe(201);
    expect(zero.body.storyPoints).toBe(0);
    const max = await create(tam.token, project.id, { storyPoints: 100 });
    expect(max.status).toBe(201);
    expect(max.body.storyPoints).toBe(100);
  });

  it("rejects 101, -1 and fractions on create and update", async () => {
    const { tam, project } = await fixture();
    for (const bad of [101, -1, 2.5, "3"]) {
      expect((await create(tam.token, project.id, { storyPoints: bad })).status).toBe(400);
    }
    const task = (await create(tam.token, project.id, { storyPoints: 5 })).body;
    for (const bad of [101, -1, 2.5, "3"]) {
      const res = await patch(tam.token, task.id, { storyPoints: bad });
      expect(res.status).toBe(400);
    }
    const row = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.storyPoints).toBe(5);
  });

  it("updates the value and clears it with null", async () => {
    const { tam, project } = await fixture();
    const task = (await create(tam.token, project.id, { storyPoints: 3 })).body;
    const set = await patch(tam.token, task.id, { storyPoints: 8 });
    expect(set.status).toBe(200);
    expect(set.body.storyPoints).toBe(8);
    const cleared = await patch(tam.token, task.id, { storyPoints: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.storyPoints).toBeNull();
  });
});

describe("storyPoints stale-write check", () => {
  it("409s when the stored value differs from expected, applies when it matches", async () => {
    const { tam, project } = await fixture();
    const task = (await create(tam.token, project.id, { storyPoints: 3 })).body;
    await prisma.task.update({ where: { id: task.id }, data: { storyPoints: 5 } });
    const stale = await patch(tam.token, task.id, { storyPoints: 8, expected: { storyPoints: 3 } });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("stale_write");
    expect(JSON.stringify(stale.body)).toContain("storyPoints");
    const ok = await patch(tam.token, task.id, { storyPoints: 8, expected: { storyPoints: 5 } });
    expect(ok.status).toBe(200);
    expect(ok.body.storyPoints).toBe(8);
    const fromNull = await patch(tam.token, task.id, { storyPoints: null, expected: { storyPoints: 8 } });
    expect(fromNull.status).toBe(200);
  });
});

describe("storyPoints duplicate", () => {
  it("is copied by task duplicate (with subtasks) and section duplicate", async () => {
    const { tam, project } = await fixture();
    const section = await prisma.section.create({
      data: { projectId: project.id, name: "S", position: 0 },
    });
    const parent = (await create(tam.token, project.id, { storyPoints: 13, sectionId: section.id })).body;
    await create(tam.token, project.id, { storyPoints: 2, parentTaskId: parent.id });

    const dup = await request(app).post(`/tasks/${parent.id}/duplicate`).set(auth(tam.token));
    expect(dup.status).toBe(201);
    expect(dup.body.storyPoints).toBe(13);
    const copiedSub = await prisma.task.findFirstOrThrow({ where: { parentTaskId: dup.body.id } });
    expect(copiedSub.storyPoints).toBe(2);

    const secDup = await request(app).post(`/sections/${section.id}/duplicate`).set(auth(tam.token));
    expect(secDup.status).toBe(201);
    const newSectionId = secDup.body.id as number;
    const copies = await prisma.task.findMany({ where: { sectionId: newSectionId, parentTaskId: null } });
    expect(copies.map((t) => t.storyPoints)).toContain(13);
  });
});

describe("storyPoints activity", () => {
  it("logs a from/to change, and nothing when the value is unchanged", async () => {
    const { tam, project } = await fixture();
    const task = (await create(tam.token, project.id, {})).body;
    await patch(tam.token, task.id, { storyPoints: 5 });
    await patch(tam.token, task.id, { storyPoints: 5 });
    await patch(tam.token, task.id, { storyPoints: null });
    const events = await prisma.activityEvent.findMany({
      where: { projectId: project.id, entityType: "task", action: "updated" },
      orderBy: { id: "asc" },
    });
    const created = await create(tam.token, project.id, { storyPoints: 8 });
    const createdEvent = await prisma.activityEvent.findFirstOrThrow({
      where: { projectId: project.id, entityType: "task", action: "created", entityId: created.body.id },
    });
    expect(createdEvent.changes).toEqual({ storyPoints: { from: null, to: 8 } });
    const plain = await create(tam.token, project.id, {});
    const plainEvent = await prisma.activityEvent.findFirstOrThrow({
      where: { projectId: project.id, entityType: "task", action: "created", entityId: plain.body.id },
    });
    expect(plainEvent.changes).toBeNull();
    expect(events.map((e) => e.changes)).toEqual([
      { storyPoints: { from: null, to: 5 } },
      { storyPoints: { from: 5, to: null } },
    ]);
  });
});
