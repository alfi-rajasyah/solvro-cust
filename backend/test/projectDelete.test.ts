import "./env.js";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { logger } from "../src/logger.js";
import { createAdminAndToken, createUserWithRole, seedRoles } from "./testAuth.js";

// DELETE /projects/:id — hard delete behind project:write and the
// visibility filter. The schema cascades the project's children.

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

async function createCustomer(tamId: number | null = null): Promise<number> {
  const customer = await prisma.customer.create({
    data: { name: uniq("Customer"), description: "d", tamId },
  });
  return customer.id;
}

async function createProject(customerId: number, tamId: number): Promise<number> {
  const project = await prisma.project.create({
    data: { name: uniq("Project"), tamId, customerId, status: "ACTIVE" },
  });
  return project.id;
}

function post(token: string, path: string, body: Record<string, unknown>) {
  return request(app).post(path).set("Authorization", `Bearer ${token}`).send(body);
}

function del(token: string, id: number | string) {
  return request(app).delete(`/projects/${id}`).set("Authorization", `Bearer ${token}`);
}

function getProject(token: string, id: number) {
  return request(app).get(`/projects/${id}`).set("Authorization", `Bearer ${token}`);
}

describe("DELETE /projects/:id", () => {
  it("deletes a visible project with its tasks, sections, labels, risks and notes (204)", async () => {
    const customerId = await createCustomer();
    const projectId = await createProject(customerId, admin.userId);
    const base = `/projects/${projectId}`;
    const children = await Promise.all([
      post(admin.token, `${base}/tasks`, { title: "Cascade me" }),
      post(admin.token, `${base}/sections`, { name: "Phase 1" }),
      post(admin.token, `${base}/labels`, { name: "urgent" }),
      post(admin.token, `${base}/risks`, { description: "Schedule slip" }),
      post(admin.token, `${base}/notes`, { body: "Kickoff done" }),
    ]);
    for (const child of children) expect(child.status).toBe(201);

    const res = await del(admin.token, projectId);
    expect(res.status).toBe(204);

    expect((await getProject(admin.token, projectId)).status).toBe(404);
    expect(await prisma.project.findUnique({ where: { id: projectId } })).toBeNull();
    // Every cascading relation the route relies on, not just tasks — a schema
    // edit that flipped one of these to Restrict would 500 the route.
    expect(await prisma.task.count({ where: { projectId } })).toBe(0);
    expect(await prisma.section.count({ where: { projectId } })).toBe(0);
    expect(await prisma.label.count({ where: { projectId } })).toBe(0);
    expect(await prisma.risk.count({ where: { projectId } })).toBe(0);
    expect(await prisma.projectNote.count({ where: { projectId } })).toBe(0);
    // The customer is untouched.
    expect(await prisma.customer.findUnique({ where: { id: customerId } })).not.toBeNull();
  });

  it("logs the deletion and leaves a customer activity event that outlives the project", async () => {
    const customerId = await createCustomer();
    const projectId = await createProject(customerId, admin.userId);
    const name = (await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).name;
    const info = vi.spyOn(logger, "info");
    const before = Date.now();
    try {
      expect((await del(admin.token, projectId)).status).toBe(204);
      const call = info.mock.calls.find(
        (c) => (c[0] as { event?: string } | undefined)?.event === "project.deleted",
      );
      expect(call?.[0]).toMatchObject({ projectId, projectName: name, customerId, actorId: admin.userId });
    } finally {
      info.mockRestore();
    }
    expect(await prisma.project.findUnique({ where: { id: projectId } })).toBeNull();
    const events = await prisma.customerActivityEvent.findMany({ where: { customerId } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorId: admin.userId, action: "project_deleted", projectId, projectName: name });
    expect(events[0].createdAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("records a customer-less project delete with a null customer, and keeps it when a customer is deleted", async () => {
    const orphan = await prisma.project.create({
      data: { name: uniq("Orphan"), tamId: admin.userId, status: "ACTIVE" },
    });
    expect((await del(admin.token, orphan.id)).status).toBe(204);
    const row = await prisma.customerActivityEvent.findFirstOrThrow({ where: { projectId: orphan.id } });
    expect(row).toMatchObject({ customerId: null, actorId: admin.userId, projectName: orphan.name });

    const customerId = await createCustomer();
    const projectId = await createProject(customerId, admin.userId);
    expect((await del(admin.token, projectId)).status).toBe(204);
    await prisma.customer.delete({ where: { id: customerId } });
    const kept = await prisma.customerActivityEvent.findFirstOrThrow({ where: { projectId } });
    expect(kept.customerId).toBeNull();
    expect(kept.action).toBe("project_deleted");
  });

  it("records nothing for a refused delete", async () => {
    const owner = await createUserWithRole("TAM");
    const other = await createUserWithRole("TAM");
    const customerId = await createCustomer(owner.userId);
    const projectId = await createProject(customerId, owner.userId);
    expect((await del(other.token, projectId)).status).toBe(404);
    expect(await prisma.customerActivityEvent.count({ where: { projectId } })).toBe(0);
  });

  it("404s for an unknown project", async () => {
    const res = await del(admin.token, 999999);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("not_found");
  });

  it("lets the TAM who owns the customer delete a project another TAM runs", async () => {
    const owner = await createUserWithRole("TAM");
    const other = await createUserWithRole("TAM");
    const customerId = await createCustomer(owner.userId);
    const projectId = await createProject(customerId, other.userId);

    expect((await del(owner.token, projectId)).status).toBe(204);
    expect(await prisma.project.findUnique({ where: { id: projectId } })).toBeNull();
  });

  it("404s (not 403) for a project the caller cannot see, and leaves it in place", async () => {
    const owner = await createUserWithRole("TAM");
    const other = await createUserWithRole("TAM");
    const customerId = await createCustomer(owner.userId);
    const projectId = await createProject(customerId, owner.userId);

    const res = await del(other.token, projectId);
    expect(res.status).toBe(404);
    expect(await prisma.project.findUnique({ where: { id: projectId } })).not.toBeNull();
  });

  it("403s without project:write even when the project is visible", async () => {
    const customerId = await createCustomer();
    const projectId = await createProject(customerId, admin.userId);
    // AUDITOR carries project:read + project:view-all, never project:write.
    const stakeholder = await createUserWithRole("AUDITOR");
    expect((await getProject(stakeholder.token, projectId)).status).toBe(200);

    const res = await del(stakeholder.token, projectId);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("forbidden");
    expect(await prisma.project.findUnique({ where: { id: projectId } })).not.toBeNull();
  });

  it("400s on a malformed id", async () => {
    const res = await del(admin.token, "abc");
    expect(res.status).toBe(400);
  });

  it("401s without a token", async () => {
    const res = await request(app).delete("/projects/1");
    expect(res.status).toBe(401);
  });
});
