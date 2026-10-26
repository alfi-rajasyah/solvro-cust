// Two people reordering the same list at the same moment. Each
// reorder re-packs every sibling row; two re-packs that lock the rows in a
// different order can deadlock, and Postgres aborts one of them. The user
// must never see a 500 for that, and the list must stay dense 0..n-1. Tasks,
// sections and epics each keep such a list per project.
import "./env.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { seedRoles, createAdminAndToken } from "./testAuth.js";

const app = createApp();

let token: string;
let projectId: number;

beforeAll(async () => {
  await seedRoles();
  const admin = await createAdminAndToken();
  token = admin.token;
  const project = await prisma.project.create({
    data: { name: `Reorder race ${Date.now()}`, tamId: admin.userId, status: "ACTIVE" },
  });
  projectId = project.id;
});

async function createTask(title: string): Promise<number> {
  const res = await request(app)
    .post(`/projects/${projectId}/tasks`)
    .set("Authorization", `Bearer ${token}`)
    .send({ title });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

describe("concurrent reorders in one sibling list", () => {
  it("never answer 500 and leave the positions dense", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 12; i++) ids.push(await createTask(`T${i}`));

    const statuses: number[] = [];
    for (let round = 0; round < 6; round++) {
      // Opposite moves at once: the first rows to the end, the last rows to
      // the top, so the re-packs touch the shared rows in opposite orders.
      const moves = [
        { id: ids[0], position: 11 },
        { id: ids[11], position: 0 },
        { id: ids[1], position: 10 },
        { id: ids[10], position: 1 },
      ];
      const results = await Promise.all(
        moves.map((m) =>
          request(app)
            .patch(`/tasks/${m.id}`)
            .set("Authorization", `Bearer ${token}`)
            .send({ position: m.position }),
        ),
      );
      statuses.push(...results.map((r) => r.status));
    }

    // Re-packs of one project wait for each other (lockProjectOrder), so every
    // move succeeds; before, most of them died in a deadlock with a 500.
    expect(statuses.filter((s) => s !== 200)).toEqual([]);

    const rows = await prisma.task.findMany({
      where: { projectId, parentTaskId: null },
      orderBy: { position: "asc" },
      select: { position: true },
    });
    expect(rows.map((r) => r.position)).toEqual(rows.map((_, i) => i));
  });
});

// Opposite moves at once, in rounds, on whatever list `path` reorders.
async function raceMoves(path: (id: number) => string, ids: number[]): Promise<number[]> {
  const last = ids.length - 1;
  const statuses: number[] = [];
  for (let round = 0; round < 6; round++) {
    const moves = [
      { id: ids[0], position: last },
      { id: ids[last], position: 0 },
      { id: ids[1], position: last - 1 },
      { id: ids[last - 1], position: 1 },
    ];
    const results = await Promise.all(
      moves.map((m) =>
        request(app).patch(path(m.id)).set("Authorization", `Bearer ${token}`).send({ position: m.position }),
      ),
    );
    statuses.push(...results.map((r) => r.status));
  }
  return statuses;
}

describe("concurrent reorders of sections and epics", () => {
  it("sections: never answer 500 and stay dense", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post(`/projects/${projectId}/sections`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: `S${i}` });
      expect(res.status).toBe(201);
      ids.push(res.body.id as number);
    }
    expect((await raceMoves((id) => `/sections/${id}`, ids)).filter((s) => s !== 200)).toEqual([]);
    const rows = await prisma.section.findMany({ where: { projectId }, orderBy: { position: "asc" } });
    expect(rows.map((r) => r.position)).toEqual(rows.map((_, i) => i));
  });

  it("epics: never answer 500 and stay dense", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post(`/projects/${projectId}/epics`)
        .set("Authorization", `Bearer ${token}`)
        .send({ title: `E${i}` });
      expect(res.status).toBe(201);
      ids.push(res.body.id as number);
    }
    expect((await raceMoves((id) => `/epics/${id}`, ids)).filter((s) => s !== 200)).toEqual([]);
    const rows = await prisma.epic.findMany({ where: { projectId }, orderBy: { position: "asc" } });
    expect(rows.map((r) => r.position)).toEqual(rows.map((_, i) => i));
  });
});

describe("a reorder that waits too long for another one", () => {
  it("answers 409 concurrent_update, not 500, and saves nothing", async () => {
    const id = await createTask("Waiter");
    const before = await prisma.task.findUniqueOrThrow({ where: { id }, select: { position: true } });

    // Another transaction holds the project's task-order lock for 4.5 s,
    // longer than the 3 s a reorder waits.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(7313, ${projectId}::int)`;
        await held;
      },
      { timeout: 10_000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    const timer = setTimeout(release, 4_500);

    const res = await request(app)
      .patch(`/tasks/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ position: 0 });
    clearTimeout(timer);
    release();
    await holder;

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("concurrent_update");
    const after = await prisma.task.findUniqueOrThrow({ where: { id }, select: { position: true } });
    expect(after.position).toBe(before.position);
  });
});
