// POST /projects/:id/dependencies must never let a cycle in, also under
// concurrency: before the per-project advisory lock, two simultaneous
// requests (A→B and B→A) each walked an edge list that did not yet contain
// the other's edge, and both inserted.
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

async function projectWithTasks(count: number) {
  const tam = await createUserWithRole("TAM");
  const project = await prisma.project.create({
    data: { name: `Deps ${Date.now()}-${Math.random()}`, tamId: tam.userId, status: "ACTIVE" },
  });
  const tasks: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = await prisma.task.create({
      data: { projectId: project.id, title: `T${i}`, status: "TODO", priority: "MEDIUM", position: i },
    });
    tasks.push(t.id);
  }
  return { token: tam.token, projectId: project.id, tasks };
}

function addEdge(token: string, projectId: number, predecessorTaskId: number, successorTaskId: number) {
  return request(app)
    .post(`/projects/${projectId}/dependencies`)
    .set("Authorization", `Bearer ${token}`)
    .send({ predecessorTaskId, successorTaskId });
}

describe("POST /projects/:id/dependencies — cycle check", () => {
  it("rejects a direct and an indirect cycle sequentially", async () => {
    const { token, projectId, tasks: [a, b, c] } = await projectWithTasks(3);
    expect((await addEdge(token, projectId, a, b)).status).toBe(201);
    expect((await addEdge(token, projectId, b, c)).status).toBe(201);
    const direct = await addEdge(token, projectId, b, a);
    expect(direct.status).toBe(400);
    expect(direct.body.code).toBe("cycle");
    const indirect = await addEdge(token, projectId, c, a);
    expect(indirect.status).toBe(400);
    expect(indirect.body.code).toBe("cycle");
    expect(await prisma.taskDependency.count({ where: { projectId } })).toBe(2);
  });

  it("lets exactly one of two concurrent opposite edges in", async () => {
    const { token, projectId, tasks: [a, b] } = await projectWithTasks(2);
    const [r1, r2] = await Promise.all([addEdge(token, projectId, a, b), addEdge(token, projectId, b, a)]);
    expect([r1.status, r2.status].sort()).toEqual([201, 400]);
    expect([r1.body.code, r2.body.code].filter(Boolean)).toEqual(["cycle"]);
    expect(await prisma.taskDependency.count({ where: { projectId } })).toBe(1);
  });

  it("lets exactly one of three concurrent edges that would close a triangle in the last step", async () => {
    const { token, projectId, tasks: [a, b, c] } = await projectWithTasks(3);
    expect((await addEdge(token, projectId, a, b)).status).toBe(201);
    // b→c and c→a together close a loop through the existing a→b; one of them must lose.
    const [r1, r2] = await Promise.all([addEdge(token, projectId, b, c), addEdge(token, projectId, c, a)]);
    expect([r1.status, r2.status].sort()).toEqual([201, 400]);
    expect(await prisma.taskDependency.count({ where: { projectId } })).toBe(2);
  });
});
