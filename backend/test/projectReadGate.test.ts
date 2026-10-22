// The projects router and the Outline mention routers require `project:read`
// like the rest of the project surface. A member with no permissions — a
// PENDING account becomes one through task assignment or an admin reassign —
// previously passed the visibility filter and could read project detail,
// tasks, notes and mention counts.
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

async function projectWithMember(roleName: string) {
  const tam = await createUserWithRole("TAM");
  const member = await createUserWithRole(roleName);
  const project = await prisma.project.create({
    data: { name: `Gate ${Date.now()}-${Math.random()}`, tamId: tam.userId, status: "ACTIVE" },
  });
  const task = await prisma.task.create({
    data: { projectId: project.id, title: "T", status: "TODO", priority: "MEDIUM", position: 0 },
  });
  await prisma.projectMember.create({ data: { projectId: project.id, userId: member.userId, addedById: tam.userId } });
  const epic = await prisma.epic.create({ data: { projectId: project.id, title: "E", position: 0 } });
  return { tam, member, projectId: project.id, taskId: task.id, epicId: epic.id };
}

const get = (path: string, token: string) => request(app).get(path).set("Authorization", `Bearer ${token}`);

describe("project reads require project:read", () => {
  it("a PENDING member gets 403 forbidden on every project read, not the data", async () => {
    const { member, projectId, taskId, epicId } = await projectWithMember("PENDING");
    for (const path of [
      // Outside the /projects prefix, the same member could still read task rows,
      // comment bodies, epics and the portfolio until those routers got the gate.
      "/tasks",
      `/tasks/${taskId}`,
      `/tasks/${taskId}/comments`,
      `/epics/${epicId}`,
      "/overview?today=2026-10-22",
      "/overview/badges?today=2026-10-22",
      "/projects",
      `/projects/${projectId}`,
      `/projects/${projectId}/tasks`,
      `/projects/${projectId}/notes`,
      `/projects/${projectId}/sections`,
      `/projects/${projectId}/risks`,
      `/projects/${projectId}/dependencies`,
      `/projects/${projectId}/outline-mentions`,
      `/tasks/${taskId}/outline-mentions`,
    ]) {
      const res = await get(path, member.token);
      expect(res.status, path).toBe(403);
      expect(res.body.code, path).toBe("forbidden");
    }
  });

  it("a STAKEHOLDER member (project:read) and the TAM still read the project", async () => {
    const { tam, member, projectId } = await projectWithMember("STAKEHOLDER");
    expect((await get(`/projects/${projectId}`, member.token)).status).toBe(200);
    expect((await get(`/projects/${projectId}/tasks`, member.token)).status).toBe(200);
    expect((await get(`/projects/${projectId}`, tam.token)).status).toBe(200);
    expect((await get(`/projects/${projectId}/outline-mentions`, tam.token)).status).toBe(200);
    expect((await get("/tasks", member.token)).status).toBe(200);
    expect((await get("/overview?today=2026-10-22", member.token)).status).toBe(200);
    expect((await get("/overview/badges?today=2026-10-22", tam.token)).status).toBe(200);
  });
});
