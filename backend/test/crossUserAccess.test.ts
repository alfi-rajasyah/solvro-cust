// Another TAM must not read or change a project's risks, dependencies or
// labels, and the org-wide executive roll-up needs its own permission. A
// hidden project answers 404 "Project not found" like every other router
// (lib/visibility.ts#ensureProjectVisible); the body check tells that apart
// from the 404 of a route that does not exist. The owner's requests are the
// positive control, and nothing the other TAM asked for is changed.
import "./env.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import type { Response } from "supertest";
import { createUserWithRole, seedRoles } from "./testAuth.js";

const app = createApp();

interface Fixture {
  ownerToken: string;
  otherToken: string;
  projectId: number;
  riskId: number;
  dependencyId: number;
  labelId: number;
  taskA: number;
  taskC: number;
}

let f: Fixture;

beforeAll(async () => {
  await seedRoles();
  const owner = await createUserWithRole("TAM");
  const other = await createUserWithRole("TAM");
  const stamp = `${Date.now()}-${Math.random()}`;
  const customer = await prisma.customer.create({
    data: { name: `Cross-user customer ${stamp}`, description: "d", tamId: owner.userId },
  });
  const project = await prisma.project.create({
    data: { name: `Cross-user project ${stamp}`, tamId: owner.userId, customerId: customer.id, status: "ACTIVE" },
  });
  const [a, b, c] = await Promise.all(
    ["A", "B", "C"].map((title, position) => prisma.task.create({ data: { projectId: project.id, title, position } })),
  );
  const risk = await prisma.risk.create({ data: { projectId: project.id, description: "Supplier delay" } });
  const dependency = await prisma.taskDependency.create({
    data: { projectId: project.id, predecessorTaskId: a.id, successorTaskId: b.id },
  });
  const label = await prisma.label.create({ data: { projectId: project.id, name: "Blocked" } });
  f = {
    ownerToken: owner.token,
    otherToken: other.token,
    projectId: project.id,
    riskId: risk.id,
    dependencyId: dependency.id,
    labelId: label.id,
    taskA: a.id,
    taskC: c.id,
  };
});

/** The answer for a project the caller may not see. */
function expectHidden(res: Response): void {
  expect(res.status).toBe(404);
  expect(res.body.error).toBe("Project not found");
}

function as(token: string) {
  return {
    get: (path: string) => request(app).get(path).set("Authorization", `Bearer ${token}`),
    post: (path: string, body: object) => request(app).post(path).set("Authorization", `Bearer ${token}`).send(body),
    patch: (path: string, body: object) => request(app).patch(path).set("Authorization", `Bearer ${token}`).send(body),
    delete: (path: string) => request(app).delete(path).set("Authorization", `Bearer ${token}`),
  };
}

describe("risks", () => {
  it("another TAM cannot list, create, change or delete them", async () => {
    const other = as(f.otherToken);
    expectHidden(await other.get(`/projects/${f.projectId}/risks`));
    expectHidden(await other.post(`/projects/${f.projectId}/risks`, { description: "Injected" }));
    expectHidden(await other.patch(`/risks/${f.riskId}`, { description: "Changed" }));
    expectHidden(await other.delete(`/risks/${f.riskId}`));

    const risk = await prisma.risk.findUniqueOrThrow({ where: { id: f.riskId } });
    expect(risk.description).toBe("Supplier delay");
    expect(await prisma.risk.count({ where: { projectId: f.projectId } })).toBe(1);
  });

  it("the owner can (positive control)", async () => {
    const owner = as(f.ownerToken);
    expect((await owner.get(`/projects/${f.projectId}/risks`)).status).toBe(200);
    expect((await owner.patch(`/risks/${f.riskId}`, { probability: 3 })).status).toBe(200);
  });
});

describe("dependencies", () => {
  it("another TAM cannot list, create, change or delete them", async () => {
    const other = as(f.otherToken);
    expectHidden(await other.get(`/projects/${f.projectId}/dependencies`));
    // A new pair (A -> C): re-posting A -> B or B -> A would be refused as a
    // duplicate or a cycle even without the visibility check.
    expectHidden(
      await other.post(`/projects/${f.projectId}/dependencies`, { predecessorTaskId: f.taskA, successorTaskId: f.taskC }),
    );
    expectHidden(await other.patch(`/dependencies/${f.dependencyId}`, { type: "SOFT" }));
    expectHidden(await other.delete(`/dependencies/${f.dependencyId}`));

    const dep = await prisma.taskDependency.findUniqueOrThrow({ where: { id: f.dependencyId } });
    expect(dep.type).toBe("HARD");
    expect(await prisma.taskDependency.count({ where: { projectId: f.projectId } })).toBe(1);
  });

  it("the owner can (positive control)", async () => {
    const owner = as(f.ownerToken);
    expect((await owner.get(`/projects/${f.projectId}/dependencies`)).status).toBe(200);
    expect((await owner.patch(`/dependencies/${f.dependencyId}`, { type: "SOFT" })).status).toBe(200);
  });
});

describe("labels", () => {
  it("another TAM cannot list, create, change or delete them", async () => {
    const other = as(f.otherToken);
    expectHidden(await other.get(`/projects/${f.projectId}/labels`));
    expectHidden(await other.post(`/projects/${f.projectId}/labels`, { name: "Injected" }));
    expectHidden(await other.patch(`/labels/${f.labelId}`, { name: "Changed" }));
    expectHidden(await other.delete(`/labels/${f.labelId}`));

    const label = await prisma.label.findUniqueOrThrow({ where: { id: f.labelId } });
    expect(label.name).toBe("Blocked");
    expect(await prisma.label.count({ where: { projectId: f.projectId } })).toBe(1);
  });

  it("the owner can (positive control)", async () => {
    const owner = as(f.ownerToken);
    expect((await owner.get(`/projects/${f.projectId}/labels`)).status).toBe(200);
    expect((await owner.patch(`/labels/${f.labelId}`, { color: "#123456" })).status).toBe(200);
  });
});

describe("GET /reports/executive", () => {
  it("is refused without report:executive and allowed with it", async () => {
    expect((await as(f.otherToken).get("/reports/executive")).status).toBe(403);

    const roleName = `EXEC_TEST_${Date.now()}`;
    await prisma.role.create({ data: { roleName, permissions: ["project:read", "report:executive"] } });
    const exec = await createUserWithRole(roleName);
    const res = await as(exec.token).get("/reports/executive");
    expect(res.status).toBe(200);
    // Org-wide by design: the owner's project is in the roll-up.
    expect((res.body.projects as Array<{ id: number }>).some((p) => p.id === f.projectId)).toBe(true);
  });
});
