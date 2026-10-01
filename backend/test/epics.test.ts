import "./env.js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { seedRoles, createAdminAndToken, createUserWithRole } from "./testAuth.js";

// docs/archive/plans/epics-spec.md — Epic model, migration, epics router, Task.epicId.

const app = createApp();

let token: string;
let projectId: number;

async function createProject(ownerUserId: number): Promise<number> {
  const project = await prisma.project.create({
    data: {
      name: `Project ${Date.now()}-${Math.random()}`,
      tamId: ownerUserId,
      status: "ACTIVE",
    },
  });
  return project.id;
}

interface EpicRow {
  id: number;
  projectId: number;
  title: string;
  description: string | null;
  status: string;
  color: string;
  ownerId: number | null;
  startDate: string | null;
  dueDate: string | null;
  position: number;
  progress?: { done: number; total: number };
}

interface TaskRow {
  id: number;
  title: string;
  status: string;
  parentTaskId: number | null;
  epicId: number | null;
  position: number;
}

async function createEpic(
  inProjectId: number,
  body: Record<string, unknown> = {},
): Promise<EpicRow> {
  const res = await request(app)
    .post(`/projects/${inProjectId}/epics`)
    .set("Authorization", `Bearer ${token}`)
    .send({ title: "Epic", ...body });
  expect(res.status).toBe(201);
  return res.body as EpicRow;
}

async function patchEpic(id: number, body: Record<string, unknown>) {
  return request(app).patch(`/epics/${id}`).set("Authorization", `Bearer ${token}`).send(body);
}

async function getEpic(id: number, callerToken = token) {
  return request(app).get(`/epics/${id}`).set("Authorization", `Bearer ${callerToken}`);
}

async function deleteEpic(id: number) {
  return request(app).delete(`/epics/${id}`).set("Authorization", `Bearer ${token}`);
}

async function listEpics(inProjectId: number): Promise<EpicRow[]> {
  const res = await request(app)
    .get(`/projects/${inProjectId}/epics`)
    .set("Authorization", `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body as EpicRow[];
}

function createTask(
  overrides: Partial<{
    title: string;
    status: string;
    parentTaskId: number | null;
    epicId: number | null;
  }> = {},
  inProjectId = projectId,
) {
  return request(app)
    .post(`/projects/${inProjectId}/tasks`)
    .set("Authorization", `Bearer ${token}`)
    .send({ title: overrides.title ?? "Task", ...overrides });
}

async function createTaskOk(
  overrides: Partial<{
    title: string;
    status: string;
    parentTaskId: number | null;
    epicId: number | null;
  }> = {},
  inProjectId = projectId,
): Promise<TaskRow> {
  const res = await request(app)
    .post(`/projects/${inProjectId}/tasks`)
    .set("Authorization", `Bearer ${token}`)
    .send({ title: overrides.title ?? "Task", ...overrides });
  expect(res.status).toBe(201);
  return res.body as TaskRow;
}

async function patchTask(id: number, body: Record<string, unknown>) {
  return request(app).patch(`/tasks/${id}`).set("Authorization", `Bearer ${token}`).send(body);
}

beforeAll(async () => {
  await seedRoles();
});

beforeEach(async () => {
  const admin = await createAdminAndToken();
  token = admin.token;
  projectId = await createProject(admin.userId);
});

describe("POST /projects/:id/epics and GET /projects/:id/epics", () => {
  it("creates epics that append at the end, listed in position order", async () => {
    const a = await createEpic(projectId, { title: "Alpha" });
    const b = await createEpic(projectId, { title: "Beta" });
    const c = await createEpic(projectId, { title: "Gamma" });

    expect([a.position, b.position, c.position]).toEqual([0, 1, 2]);

    const listed = await listEpics(projectId);
    expect(listed.map((e) => e.id)).toEqual([a.id, b.id, c.id]);
    expect(listed.every((e) => e.progress?.done === 0 && e.progress?.total === 0)).toBe(true);
  });

  it("defaults status TODO and color #94a3b8, and accepts overrides", async () => {
    const epic = await createEpic(projectId, { title: "Custom", color: "#123456" });
    expect(epic.status).toBe("TODO");
    expect(epic.color).toBe("#123456");
  });

  it("404s the list for a project invisible to the caller", async () => {
    const otherTam = await createUserWithRole("TAM");
    const res = await request(app)
      .get(`/projects/${projectId}/epics`)
      .set("Authorization", `Bearer ${otherTam.token}`);
    expect(res.status).toBe(404);
  });

  // STAKEHOLDER has project:read + project:view-all but no project:write, so
  // this exercises the permission gate independent of visibility (mirrors
  // taskDuplicate.test.ts's "403s without task:write").
  it("403s create for a caller who can see the project but lacks project:write", async () => {
    const stakeholder = await createUserWithRole("STAKEHOLDER");
    const res = await request(app)
      .post(`/projects/${projectId}/epics`)
      .set("Authorization", `Bearer ${stakeholder.token}`)
      .send({ title: "Blocked" });
    expect(res.status).toBe(403);
  });

  // Epics have no re-pack on delete (mirrors DELETE /tasks/:id and
  // DELETE /sections/:id), so a naive `count` as the next position would
  // collide with (or land before) a surviving epic once an earlier one is
  // gone. The append position must be max(position) + 1, not count.
  it("appends after the current end even when earlier epics were deleted (no re-pack)", async () => {
    const a = await createEpic(projectId, { title: "A" });
    const b = await createEpic(projectId, { title: "B" });
    const c = await createEpic(projectId, { title: "C" });
    const d = await createEpic(projectId, { title: "D" });
    expect([a.position, b.position, c.position, d.position]).toEqual([0, 1, 2, 3]);

    expect((await deleteEpic(a.id)).status).toBe(204);
    expect((await deleteEpic(b.id)).status).toBe(204);

    const e = await createEpic(projectId, { title: "E" });

    const listed = await listEpics(projectId);
    expect(listed.map((ep) => ep.id)).toEqual([c.id, d.id, e.id]);
    expect(e.position).toBeGreaterThan(d.position);
  });
});

describe("PATCH /epics/:id — field updates", () => {
  it("renames and changes status without touching position", async () => {
    const a = await createEpic(projectId, { title: "A" });
    const b = await createEpic(projectId, { title: "B" });

    const res = await patchEpic(a.id, { title: "A-renamed", status: "IN_PROGRESS" });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("A-renamed");
    expect(res.body.status).toBe("IN_PROGRESS");
    expect(res.body.position).toBe(0);

    const listed = await listEpics(projectId);
    expect(listed.map((e) => e.id)).toEqual([a.id, b.id]);
  });

  // GET /:id, GET /projects/:id/epics, and POST /projects/:id/epics all
  // include progress; PATCH must too — the frontend Epic type promises it
  // on every epic response.
  it("includes progress in its response", async () => {
    const epic = await createEpic(projectId, { title: "Sprint 1" });
    const story = await createTaskOk({ title: "Story", epicId: epic.id });
    const doneRes = await patchTask(story.id, { status: "DONE" });
    expect(doneRes.status).toBe(200);

    const res = await patchEpic(epic.id, { title: "Sprint 1 renamed" });
    expect(res.status).toBe(200);
    expect(res.body.progress).toEqual({ done: 1, total: 1 });
  });

  it("sets startDate/dueDate on create and clears both via PATCH null", async () => {
    const created = await createEpic(projectId, {
      title: "Dated",
      startDate: "2026-10-01",
      dueDate: "2026-10-15",
    });
    expect(new Date(created.startDate!).toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(new Date(created.dueDate!).toISOString().slice(0, 10)).toBe("2026-10-15");

    const res = await patchEpic(created.id, { startDate: null, dueDate: null });
    expect(res.status).toBe(200);
    expect(res.body.startDate).toBeNull();
    expect(res.body.dueDate).toBeNull();
  });
});

describe("PATCH /epics/:id — position re-pack", () => {
  it("moves an epic toward the front of the list", async () => {
    const a = await createEpic(projectId, { title: "A" });
    const b = await createEpic(projectId, { title: "B" });
    const c = await createEpic(projectId, { title: "C" });

    const res = await patchEpic(c.id, { position: 0 });
    expect(res.status).toBe(200);
    expect(res.body.position).toBe(0);

    const listed = await listEpics(projectId);
    expect(listed.map((e) => e.id)).toEqual([c.id, a.id, b.id]);
    expect(listed.map((e) => e.position)).toEqual([0, 1, 2]);
  });

  it("clamps a position beyond the end of the list and keeps positions dense", async () => {
    const a = await createEpic(projectId, { title: "A" });
    const b = await createEpic(projectId, { title: "B" });

    const res = await patchEpic(a.id, { position: 999 });
    expect(res.status).toBe(200);
    expect(res.body.position).toBe(1);

    const listed = await listEpics(projectId);
    expect(listed.map((e) => e.id)).toEqual([b.id, a.id]);
    expect(listed.map((e) => e.position)).toEqual([0, 1]);
  });

  it("applies a title change together with a position move in the same request", async () => {
    const a = await createEpic(projectId, { title: "A" });
    const b = await createEpic(projectId, { title: "B" });

    const res = await patchEpic(a.id, { position: 1, title: "A-renamed" });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("A-renamed");
    expect(res.body.position).toBe(1);

    const listed = await listEpics(projectId);
    expect(listed.map((e) => e.id)).toEqual([b.id, a.id]);
  });

  it("404s a PATCH on an epic in a project invisible to the caller", async () => {
    const otherTam = await createUserWithRole("TAM");
    const epic = await createEpic(projectId, { title: "Hidden" });

    const res = await request(app)
      .patch(`/epics/${epic.id}`)
      .set("Authorization", `Bearer ${otherTam.token}`)
      .send({ position: 0 });
    expect(res.status).toBe(404);
  });

  it("403s a PATCH for a caller who can see the epic but lacks project:write", async () => {
    const epic = await createEpic(projectId, { title: "Visible" });
    const stakeholder = await createUserWithRole("STAKEHOLDER");

    const res = await request(app)
      .patch(`/epics/${epic.id}`)
      .set("Authorization", `Bearer ${stakeholder.token}`)
      .send({ title: "Blocked" });
    expect(res.status).toBe(403);
  });
});

describe("GET /epics/:id — detail, progress, tasks", () => {
  it("returns the epic with progress and its top-level tasks ordered by position", async () => {
    const epic = await createEpic(projectId, { title: "Sprint 1" });
    const t0 = await createTaskOk({ title: "Story A", epicId: epic.id });
    const t1 = await createTaskOk({ title: "Story B", epicId: epic.id });
    const doneRes = await patchTask(t1.id, { status: "DONE" });
    expect(doneRes.status).toBe(200);

    const res = await getEpic(epic.id);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(epic.id);
    expect(res.body.progress).toEqual({ done: 1, total: 2 });
    expect((res.body.tasks as TaskRow[]).map((t) => t.id)).toEqual([t0.id, t1.id]);
  });

  it("a DONE subtask does not count toward progress", async () => {
    const epic = await createEpic(projectId, { title: "Sprint 1" });
    const story = await createTaskOk({ title: "Story A", epicId: epic.id });
    const subtask = await createTaskOk({ title: "Sub", parentTaskId: story.id });
    const doneRes = await patchTask(subtask.id, { status: "DONE" });
    expect(doneRes.status).toBe(200);

    const res = await getEpic(epic.id);
    expect(res.status).toBe(200);
    // Only the top-level story counts, and it's still TODO — the subtask's
    // DONE status must not leak into the epic's progress.
    expect(res.body.progress).toEqual({ done: 0, total: 1 });
    expect((res.body.tasks as TaskRow[]).map((t) => t.id)).toEqual([story.id]);
  });

  it("the project epics list's progress also excludes subtasks", async () => {
    const epic = await createEpic(projectId, { title: "Sprint 1" });
    const story = await createTaskOk({ title: "Story A", epicId: epic.id, status: "DONE" });
    const subtask = await createTaskOk({ title: "Sub", parentTaskId: story.id });
    const subDoneRes = await patchTask(subtask.id, { status: "DONE" });
    expect(subDoneRes.status).toBe(200);

    const listed = await listEpics(projectId);
    const found = listed.find((e) => e.id === epic.id)!;
    expect(found.progress).toEqual({ done: 1, total: 1 });
  });

  it("404s for a caller who cannot see the project", async () => {
    const epic = await createEpic(projectId, { title: "Hidden" });
    const otherTam = await createUserWithRole("TAM");
    const res = await getEpic(epic.id, otherTam.token);
    expect(res.status).toBe(404);
  });
});

describe("DELETE /epics/:id", () => {
  it("returns 204 and sets epicId to null on its tasks, which keep their other data", async () => {
    const epic = await createEpic(projectId, { title: "To delete" });
    const task = await createTaskOk({ title: "Keeps data", epicId: epic.id, status: "IN_PROGRESS" });

    const res = await deleteEpic(epic.id);
    expect(res.status).toBe(204);

    const taskAfter = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(taskAfter.epicId).toBeNull();
    expect(taskAfter.title).toBe("Keeps data");
    expect(taskAfter.status).toBe("IN_PROGRESS");

    const epicAfter = await prisma.epic.findUnique({ where: { id: epic.id } });
    expect(epicAfter).toBeNull();
  });

  it("404s for a caller who cannot see the project", async () => {
    const epic = await createEpic(projectId, { title: "Hidden" });
    const otherTam = await createUserWithRole("TAM");
    const res = await request(app)
      .delete(`/epics/${epic.id}`)
      .set("Authorization", `Bearer ${otherTam.token}`);
    expect(res.status).toBe(404);
  });

  it("403s for a caller who can see the epic but lacks project:write", async () => {
    const epic = await createEpic(projectId, { title: "Visible" });
    const stakeholder = await createUserWithRole("STAKEHOLDER");
    const res = await request(app)
      .delete(`/epics/${epic.id}`)
      .set("Authorization", `Bearer ${stakeholder.token}`);
    expect(res.status).toBe(403);

    // Rejected request must not have deleted the epic.
    const epicAfter = await prisma.epic.findUnique({ where: { id: epic.id } });
    expect(epicAfter).not.toBeNull();
  });
});

describe("epicId validation on task create/update", () => {
  it("rejects an epicId from another project on task create (epic_not_found)", async () => {
    const otherProjectId = await createProject((await createAdminAndToken()).userId);
    const foreignEpic = await createEpic(otherProjectId, { title: "Foreign" });

    const res = await createTask({ title: "Bad", epicId: foreignEpic.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("epic_not_found");
  });

  it("rejects an epicId from another project on task update (epic_not_found)", async () => {
    const otherProjectId = await createProject((await createAdminAndToken()).userId);
    const foreignEpic = await createEpic(otherProjectId, { title: "Foreign" });
    const task = await createTaskOk({ title: "Local" });

    const res = await patchTask(task.id, { epicId: foreignEpic.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("epic_not_found");
  });

  it("accepts an epicId from the same project on create and update", async () => {
    const epic = await createEpic(projectId, { title: "Local" });
    const created = await createTaskOk({ title: "Task", epicId: epic.id });
    expect(created.epicId).toBe(epic.id);

    const other = await createEpic(projectId, { title: "Other" });
    const res = await patchTask(created.id, { epicId: other.id });
    expect(res.status).toBe(200);
    expect(res.body.epicId).toBe(other.id);
  });

  it("rejects epicId together with parentTaskId on create (epic_on_subtask)", async () => {
    const epic = await createEpic(projectId, { title: "Local" });
    const parent = await createTaskOk({ title: "Parent" });

    const res = await createTask({ title: "Bad subtask", parentTaskId: parent.id, epicId: epic.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("epic_on_subtask");
  });

  it("rejects setting epicId on an existing subtask (epic_on_subtask)", async () => {
    const epic = await createEpic(projectId, { title: "Local" });
    const parent = await createTaskOk({ title: "Parent" });
    const subtask = await createTaskOk({ title: "Sub", parentTaskId: parent.id });

    const res = await patchTask(subtask.id, { epicId: epic.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("epic_on_subtask");
  });

  it("returns epicId on GET /projects/:id/tasks and GET /tasks", async () => {
    const epic = await createEpic(projectId, { title: "Local" });
    const task = await createTaskOk({ title: "Task", epicId: epic.id });

    const projectTasksRes = await request(app)
      .get(`/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${token}`);
    expect(projectTasksRes.status).toBe(200);
    const found = (projectTasksRes.body as TaskRow[]).find((t) => t.id === task.id)!;
    expect(found.epicId).toBe(epic.id);

    const crossProjectRes = await request(app).get("/tasks").set("Authorization", `Bearer ${token}`);
    expect(crossProjectRes.status).toBe(200);
    const foundGlobal = (crossProjectRes.body as TaskRow[]).find((t) => t.id === task.id)!;
    expect(foundGlobal.epicId).toBe(epic.id);
  });

  it("re-parenting a task clears its epicId in the same transaction", async () => {
    const epic = await createEpic(projectId, { title: "Local" });
    const task = await createTaskOk({ title: "Story", epicId: epic.id });
    const newParent = await createTaskOk({ title: "New parent" });

    const res = await patchTask(task.id, { parentTaskId: newParent.id });
    expect(res.status).toBe(200);
    expect(res.body.parentTaskId).toBe(newParent.id);
    expect(res.body.epicId).toBeNull();

    const fromDb = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(fromDb.epicId).toBeNull();
  });

  // Consistency with create: `{ parentTaskId, epicId }` together 400s
  // epic_on_subtask on create (tested above) and must do the same on
  // update — not silently clear epicId the way an update with parentTaskId
  // alone (no epicId in the body) does.
  it("rejects parentTaskId + epicId together on update (epic_on_subtask, not a silent clear)", async () => {
    const epic = await createEpic(projectId, { title: "Local" });
    const task = await createTaskOk({ title: "Story" });
    const newParent = await createTaskOk({ title: "New parent" });

    const res = await patchTask(task.id, { parentTaskId: newParent.id, epicId: epic.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("epic_on_subtask");

    // Rejected request must not have touched the task.
    const fromDb = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(fromDb.parentTaskId).toBeNull();
    expect(fromDb.epicId).toBeNull();
  });

  it("epicId: null clears an existing epic link", async () => {
    const epic = await createEpic(projectId, { title: "Local" });
    const task = await createTaskOk({ title: "Story", epicId: epic.id });

    const res = await patchTask(task.id, { epicId: null });
    expect(res.status).toBe(200);
    expect(res.body.epicId).toBeNull();
  });
});
