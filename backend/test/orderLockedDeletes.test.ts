// Deleting a task, a section or an epic writes task rows (a task delete closes
// the gap in its sibling list; a section or epic delete nulls Task.sectionId /
// Task.epicId). All three take the project's task-order lock first, like a
// reorder, so they wait for it and answer 409 concurrent_update on timeout.
import "./env.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { lockProjectOrder } from "../src/lib/orderLock.js";
import { seedRoles, createAdminAndToken } from "./testAuth.js";
import { SID } from "./statusFixtures.js";

const app = createApp();

let token: string;
let projectId: number;

beforeAll(async () => {
  await seedRoles();
  const admin = await createAdminAndToken();
  token = admin.token;
  const project = await prisma.project.create({
    data: { name: `Locked deletes ${Date.now()}`, tamId: admin.userId, status: "ACTIVE" },
  });
  projectId = project.id;
});

// Runs `act` while another transaction holds the project's task-order lock,
// releasing it as soon as `act` returns.
async function whileLocked<T>(act: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let acquired!: () => void;
  const ready = new Promise<void>((resolve) => (acquired = resolve));
  const holder = prisma.$transaction(
    async (tx) => {
      await lockProjectOrder(tx, "tasks", projectId);
      acquired();
      await held;
    },
    { timeout: 15_000 },
  );
  await ready;
  try {
    return await act();
  } finally {
    release();
    await holder;
  }
}

function newTask(data: Record<string, unknown> = {}) {
  return prisma.task.create({
    data: { projectId, title: "T", status: "TODO", statusId: SID.TODO, priority: "MEDIUM", position: 0, ...data },
  });
}

const del = (path: string) => request(app).delete(path).set("Authorization", `Bearer ${token}`);

describe("deletes take the project's task-order lock", () => {
  it("a section delete answers 409 concurrent_update while it is held; section and task link kept", async () => {
    const section = await prisma.section.create({ data: { projectId, name: "S", position: 0 } });
    const task = await newTask({ sectionId: section.id });
    const res = await whileLocked(() => del(`/sections/${section.id}`));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("concurrent_update");
    expect(await prisma.section.count({ where: { id: section.id } })).toBe(1);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).sectionId).toBe(section.id);
  }, 15_000);

  it("an epic delete answers 409 concurrent_update while it is held; epic kept", async () => {
    const epic = await prisma.epic.create({ data: { projectId, title: "E", position: 0 } });
    const res = await whileLocked(() => del(`/epics/${epic.id}`));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("concurrent_update");
    expect(await prisma.epic.count({ where: { id: epic.id } })).toBe(1);
  }, 15_000);

  it("a task delete answers 409 concurrent_update while it is held; task kept", async () => {
    const task = await newTask();
    const res = await whileLocked(() => del(`/tasks/${task.id}`));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("concurrent_update");
    expect(await prisma.task.count({ where: { id: task.id } })).toBe(1);
  }, 15_000);

  it("all three still succeed when nobody holds the lock", async () => {
    const section = await prisma.section.create({ data: { projectId, name: "S2", position: 1 } });
    const epic = await prisma.epic.create({ data: { projectId, title: "E2", position: 1 } });
    const task = await newTask({ position: 1 });
    expect((await del(`/sections/${section.id}`)).status).toBe(204);
    expect((await del(`/epics/${epic.id}`)).status).toBe(204);
    expect((await del(`/tasks/${task.id}`)).status).toBe(204);
  });
});
