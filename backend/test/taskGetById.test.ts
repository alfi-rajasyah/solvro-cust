import "./env.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { createUserWithRole, seedRoles } from "./testAuth.js";
import { SID } from "./statusFixtures.js";

// GET /tasks/:id — the task page's single read. Same row shape as the list
// plus project { id, name }; hidden answers 404 like missing.

const app = createApp();
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  await seedRoles();
});

async function fixture() {
  const tam = await createUserWithRole("TAM");
  const project = await prisma.project.create({
    data: { name: `GetById ${Date.now()}-${Math.random()}`, tamId: tam.userId, status: "ACTIVE" },
  });
  const task = await prisma.task.create({
    data: { statusId: SID.TODO, projectId: project.id, title: "Parent", status: "TODO" },
  });
  return { tam, project, task };
}

describe("GET /tasks/:id", () => {
  it("returns a visible task with its project", async () => {
    const { tam, project, task } = await fixture();
    const res = await request(app).get(`/tasks/${task.id}`).set(auth(tam.token));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(task.id);
    expect(res.body.title).toBe("Parent");
    expect(res.body.project).toEqual({ id: project.id, name: project.name });
    expect(res.body._count).toEqual({ subtasks: 0, comments: 0 });
    expect(res.body.labels).toEqual([]);
    expect(res.body.statusDef).toBeTruthy();
  });

  it("returns parentTaskId for a subtask", async () => {
    const { tam, project, task } = await fixture();
    const sub = await prisma.task.create({
      data: { statusId: SID.TODO, projectId: project.id, title: "Sub", status: "TODO", parentTaskId: task.id },
    });
    const res = await request(app).get(`/tasks/${sub.id}`).set(auth(tam.token));
    expect(res.status).toBe(200);
    expect(res.body.parentTaskId).toBe(task.id);
  });

  it("answers 404 for a task on a project the caller cannot see", async () => {
    const { task } = await fixture();
    const other = await createUserWithRole("TAM");
    const res = await request(app).get(`/tasks/${task.id}`).set(auth(other.token));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("not_found");
  });

  it("answers 404 for a missing task, the same as a hidden one", async () => {
    const { tam } = await fixture();
    const res = await request(app).get("/tasks/2147483000").set(auth(tam.token));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("not_found");
  });

  it("answers 403 without project:read", async () => {
    const { task } = await fixture();
    const pending = await createUserWithRole("PENDING");
    const res = await request(app).get(`/tasks/${task.id}`).set(auth(pending.token));
    expect(res.status).toBe(403);
  });

  it("does not shadow the list route", async () => {
    const { tam } = await fixture();
    const res = await request(app).get("/tasks").set(auth(tam.token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
