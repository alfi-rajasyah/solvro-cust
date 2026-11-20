// Label create/rename permission alignment (ISS-007) and the duplicate-name
// message (ISS-041): creation needs task:write like rename/delete, and a name
// clash answers a plain 409 without database wording.
import "./env.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { createUserWithRole, seedRoles } from "./testAuth.js";

const app = createApp();

beforeAll(async () => {
  await seedRoles();
  for (const [roleName, permissions] of [
    ["TEST_TASK_WRITER_ONLY", ["project:read", "task:read", "task:write"]],
    ["TEST_PROJECT_WRITER_ONLY", ["project:read", "task:read", "project:write"]],
  ] as const) {
    await prisma.role.upsert({
      where: { roleName },
      update: { permissions: [...permissions] },
      create: { roleName, permissions: [...permissions] },
    });
  }
});

async function projectOwnedBy(userId: number) {
  return prisma.project.create({
    data: { name: `Labels ${Date.now()}-${Math.random()}`, tamId: userId, status: "ACTIVE" },
  });
}

describe("POST /projects/:id/labels permission", () => {
  it("lets a task:write caller without project:write create a label", async () => {
    const { userId, token } = await createUserWithRole("TEST_TASK_WRITER_ONLY");
    const project = await projectOwnedBy(userId);
    const res = await request(app)
      .post(`/projects/${project.id}/labels`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "bug" });
    expect(res.status).toBe(201);
  });

  it("answers 404 for a task:write caller who cannot see the project", async () => {
    const writer = await createUserWithRole("TEST_TASK_WRITER_ONLY");
    const owner = await createUserWithRole("TAM");
    const project = await projectOwnedBy(owner.userId);
    const res = await request(app)
      .post(`/projects/${project.id}/labels`)
      .set("Authorization", `Bearer ${writer.token}`)
      .send({ name: "bug" });
    expect(res.status).toBe(404);
  });

  it("refuses a project:write caller without task:write", async () => {
    const { userId, token } = await createUserWithRole("TEST_PROJECT_WRITER_ONLY");
    const project = await projectOwnedBy(userId);
    const res = await request(app)
      .post(`/projects/${project.id}/labels`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "bug" });
    expect(res.status).toBe(403);
  });
});

describe("duplicate label names", () => {
  it("answers 409 label_exists with a plain message on create", async () => {
    const { userId, token } = await createUserWithRole("TAM");
    const project = await projectOwnedBy(userId);
    const post = () =>
      request(app)
        .post(`/projects/${project.id}/labels`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "dup" });
    expect((await post()).status).toBe(201);
    const res = await post();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("label_exists");
    expect(res.body.error).toBe("A label with that name already exists");
    expect(JSON.stringify(res.body)).not.toMatch(/constraint/i);
  });

  it("answers the same 409 when a rename collides", async () => {
    const { userId, token } = await createUserWithRole("TAM");
    const project = await projectOwnedBy(userId);
    await prisma.label.create({ data: { projectId: project.id, name: "taken" } });
    const other = await prisma.label.create({ data: { projectId: project.id, name: "free" } });
    const res = await request(app)
      .patch(`/labels/${other.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "taken" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("label_exists");
    expect(res.body.error).toBe("A label with that name already exists");
  });
});
