import "./env.js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { createAdminAndToken, seedRoles } from "./testAuth.js";

// Task.isCriticalPath — a manual "if this task slips, the project end date
// slips" flag, set by the TAM. Independent of priority, not computed from
// dependencies. Any task may carry it: top-level, subtask, or milestone.

const app = createApp();

let admin: { userId: number; token: string };

beforeAll(async () => {
  await seedRoles();
});

beforeEach(async () => {
  admin = await createAdminAndToken();
});

function uniq(label: string): string {
  return `${label} ${Date.now()}-${Math.random()}`;
}

async function createCustomer(): Promise<number> {
  const customer = await prisma.customer.create({
    data: { name: uniq("Customer"), description: "d", tamId: null },
  });
  return customer.id;
}

async function createProject(customerId: number): Promise<number> {
  const project = await prisma.project.create({
    data: { name: uniq("Project"), tamId: admin.userId, customerId, status: "ACTIVE" },
  });
  return project.id;
}

function post(path: string, body: Record<string, unknown>) {
  return request(app).post(path).set("Authorization", `Bearer ${admin.token}`).send(body);
}

function patch(id: number, body: Record<string, unknown>) {
  return request(app).patch(`/tasks/${id}`).set("Authorization", `Bearer ${admin.token}`).send(body);
}

function listProjectTasks(projectId: number) {
  return request(app)
    .get(`/projects/${projectId}/tasks`)
    .set("Authorization", `Bearer ${admin.token}`);
}

describe("Task.isCriticalPath", () => {
  it("defaults to false when omitted on create", async () => {
    const customerId = await createCustomer();
    const projectId = await createProject(customerId);

    const res = await post(`/projects/${projectId}/tasks`, { title: "Untouched" });
    expect(res.status).toBe(201);
    expect(res.body.isCriticalPath).toBe(false);
  });

  it("accepts isCriticalPath: true on create", async () => {
    const customerId = await createCustomer();
    const projectId = await createProject(customerId);

    const res = await post(`/projects/${projectId}/tasks`, {
      title: "Gates the deadline",
      isCriticalPath: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.isCriticalPath).toBe(true);
  });

  it("round-trips true -> false -> true via PATCH", async () => {
    const customerId = await createCustomer();
    const projectId = await createProject(customerId);
    const created = await post(`/projects/${projectId}/tasks`, { title: "Task" });
    const id = created.body.id as number;
    expect(created.body.isCriticalPath).toBe(false);

    const toTrue = await patch(id, { isCriticalPath: true });
    expect(toTrue.status).toBe(200);
    expect(toTrue.body.isCriticalPath).toBe(true);

    const toFalse = await patch(id, { isCriticalPath: false });
    expect(toFalse.status).toBe(200);
    expect(toFalse.body.isCriticalPath).toBe(false);

    const toTrueAgain = await patch(id, { isCriticalPath: true });
    expect(toTrueAgain.status).toBe(200);
    expect(toTrueAgain.body.isCriticalPath).toBe(true);
  });

  it("survives a PATCH that omits isCriticalPath (unrelated field patches don't clear the mark)", async () => {
    const customerId = await createCustomer();
    const projectId = await createProject(customerId);
    const created = await post(`/projects/${projectId}/tasks`, {
      title: "Marked",
      isCriticalPath: true,
    });
    const id = created.body.id as number;
    expect(created.body.isCriticalPath).toBe(true);

    const res = await patch(id, { status: "IN_PROGRESS" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("IN_PROGRESS");
    expect(res.body.isCriticalPath).toBe(true);

    const listed = await listProjectTasks(projectId);
    expect(listed.status).toBe(200);
    const row = listed.body.find((t: { id: number }) => t.id === id);
    expect(row.isCriticalPath).toBe(true);
  });

  it("a milestone accepts the mark", async () => {
    const customerId = await createCustomer();
    const projectId = await createProject(customerId);

    const res = await post(`/projects/${projectId}/tasks`, {
      title: "Milestone",
      isMilestone: true,
      dueDate: "2026-10-01",
      isCriticalPath: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.isMilestone).toBe(true);
    expect(res.body.isCriticalPath).toBe(true);
  });

  it("a subtask accepts the mark", async () => {
    const customerId = await createCustomer();
    const projectId = await createProject(customerId);
    const parent = await post(`/projects/${projectId}/tasks`, { title: "Parent" });

    const res = await post(`/projects/${projectId}/tasks`, {
      title: "Subtask",
      parentTaskId: parent.body.id,
      isCriticalPath: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.parentTaskId).toBe(parent.body.id);
    expect(res.body.isCriticalPath).toBe(true);
  });

  it("400s on a non-boolean isCriticalPath on create", async () => {
    const customerId = await createCustomer();
    const projectId = await createProject(customerId);

    const res = await post(`/projects/${projectId}/tasks`, {
      title: "Bad",
      isCriticalPath: "yes",
    });
    expect(res.status).toBe(400);
  });

  it("400s on a non-boolean isCriticalPath on PATCH", async () => {
    const customerId = await createCustomer();
    const projectId = await createProject(customerId);
    const created = await post(`/projects/${projectId}/tasks`, { title: "Task" });

    const res = await patch(created.body.id, { isCriticalPath: "yes" });
    expect(res.status).toBe(400);
  });

  it("appears on every row of GET /projects/:id/tasks", async () => {
    const customerId = await createCustomer();
    const projectId = await createProject(customerId);
    await post(`/projects/${projectId}/tasks`, { title: "Marked", isCriticalPath: true });
    await post(`/projects/${projectId}/tasks`, { title: "Unmarked" });

    const res = await listProjectTasks(projectId);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    for (const task of res.body) {
      expect(typeof task.isCriticalPath).toBe("boolean");
    }
    const marked = res.body.find((t: { title: string }) => t.title === "Marked");
    const unmarked = res.body.find((t: { title: string }) => t.title === "Unmarked");
    expect(marked.isCriticalPath).toBe(true);
    expect(unmarked.isCriticalPath).toBe(false);
  });
});
