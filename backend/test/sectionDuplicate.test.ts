import "./env.js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { createAdminAndToken, createUserWithRole, seedRoles } from "./testAuth.js";

// POST /sections/:id/duplicate — docs/plans/duplicate-tasks-sections.md §3-4.
// Settled rules: name/color copied verbatim; the new section lands directly
// after the source BY IDENTITY (not `source.position + 1` as an index —
// section lists can be sparse after a delete); every top-level task under
// the source, plus each of their subtasks, is copied via the same
// duplicateTaskTree engine POST /tasks/:id/duplicate uses (status -> TODO,
// baseline cleared, labels copied, no TaskDependency rows, comments never
// copied); the copies land directly after the source section's own last
// top-level task in the project's task order; `taskCount` counts top-level
// copies only.

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

async function createProject(ownerUserId: number): Promise<number> {
  const project = await prisma.project.create({
    data: { name: uniq("Project"), tamId: ownerUserId, customerId: null, status: "ACTIVE" },
  });
  return project.id;
}

function post(path: string, token: string, body?: Record<string, unknown>) {
  const req = request(app).post(path).set("Authorization", `Bearer ${token}`);
  return body ? req.send(body) : req.send();
}

interface SectionRow {
  id: number;
  projectId: number;
  name: string;
  color: string;
  position: number;
}

interface TaskRow {
  id: number;
  title: string;
  status: string;
  parentTaskId: number | null;
  sectionId: number | null;
  position: number;
  labels: { id: number; name: string }[];
  _count: { subtasks: number; comments: number };
}

async function createSection(
  projectId: number,
  token: string,
  name: string,
  color?: string,
): Promise<SectionRow> {
  const res = await post(`/projects/${projectId}/sections`, token, {
    name,
    ...(color !== undefined && { color }),
  });
  expect(res.status).toBe(201);
  return res.body as SectionRow;
}

async function createTask(
  projectId: number,
  token: string,
  overrides: Partial<{
    title: string;
    parentTaskId: number;
    sectionId: number;
    labelIds: number[];
  }> = {},
): Promise<TaskRow> {
  const res = await post(`/projects/${projectId}/tasks`, token, {
    title: overrides.title ?? "Task",
    ...overrides,
  });
  expect(res.status).toBe(201);
  return res.body as TaskRow;
}

async function createLabel(projectId: number, token: string, name: string): Promise<number> {
  const res = await post(`/projects/${projectId}/labels`, token, { name });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

async function duplicateSection(id: number, token: string) {
  return request(app)
    .post(`/sections/${id}/duplicate`)
    .set("Authorization", `Bearer ${token}`)
    .send();
}

async function listSections(projectId: number, token: string): Promise<SectionRow[]> {
  const res = await request(app)
    .get(`/projects/${projectId}/sections`)
    .set("Authorization", `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body as SectionRow[];
}

async function listProjectTasks(projectId: number, token: string, query = ""): Promise<TaskRow[]> {
  const res = await request(app)
    .get(`/projects/${projectId}/tasks${query}`)
    .set("Authorization", `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body as TaskRow[];
}

describe("POST /sections/:id/duplicate", () => {
  it("keeps the source's name and color, placing the new section directly after it (dense list)", async () => {
    const projectId = await createProject(admin.userId);
    const a = await createSection(projectId, admin.token, "A", "#111111");
    const source = await createSection(projectId, admin.token, "Kickoff", "#ff00ff");
    const c = await createSection(projectId, admin.token, "C", "#222222");

    const res = await duplicateSection(source.id, admin.token);
    expect(res.status).toBe(201);
    const copy = res.body.section as SectionRow;
    expect(res.body.taskCount).toBe(0);

    expect(copy.id).not.toBe(source.id);
    expect(copy.name).toBe("Kickoff");
    expect(copy.color).toBe("#ff00ff");

    const listed = await listSections(projectId, admin.token);
    expect(listed.map((s) => s.id)).toEqual([a.id, source.id, copy.id, c.id]);
    expect(listed.map((s) => s.position)).toEqual([0, 1, 2, 3]);
  });

  it("places the copy directly after the source even when an earlier section was deleted (sparse list)", async () => {
    const projectId = await createProject(admin.userId);
    const a = await createSection(projectId, admin.token, "A");
    const source = await createSection(projectId, admin.token, "B");
    const c = await createSection(projectId, admin.token, "C");

    // DELETE /sections/:id never re-packs: after this, source and c keep
    // their stale stored positions (1 and 2) even though the list now has
    // only two members — regression coverage for identity-based placement
    // instead of `source.position + 1` treated as a list index.
    const deleteRes = await request(app)
      .delete(`/sections/${a.id}`)
      .set("Authorization", `Bearer ${admin.token}`);
    expect(deleteRes.status).toBe(204);

    const res = await duplicateSection(source.id, admin.token);
    expect(res.status).toBe(201);
    const copy = res.body.section as SectionRow;

    const listed = await listSections(projectId, admin.token);
    expect(listed.map((s) => s.id)).toEqual([source.id, copy.id, c.id]);
    expect(listed.map((s) => s.position)).toEqual([0, 1, 2]);
  });

  it("copies top-level tasks and their subtasks, in source order, all TODO, into the new section", async () => {
    const projectId = await createProject(admin.userId);
    const source = await createSection(projectId, admin.token, "Kickoff");
    const other = await createSection(projectId, admin.token, "Other");

    const t0 = await createTask(projectId, admin.token, { title: "T0", sectionId: source.id });
    const t1 = await createTask(projectId, admin.token, { title: "T1", sectionId: source.id });
    const s0 = await createTask(projectId, admin.token, {
      title: "S0",
      parentTaskId: t0.id,
      sectionId: source.id, // same section as its parent
    });
    const s1 = await createTask(projectId, admin.token, {
      title: "S1",
      parentTaskId: t0.id,
      sectionId: other.id, // different section from its parent
    });

    // DONE t1 to prove status resets on the copy.
    const doneRes = await request(app)
      .patch(`/tasks/${t1.id}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ status: "DONE" });
    expect(doneRes.status).toBe(200);

    const res = await duplicateSection(source.id, admin.token);
    expect(res.status).toBe(201);
    expect(res.body.taskCount).toBe(2); // top-level only: t0, t1 — not s0/s1

    const copySectionId = (res.body.section as SectionRow).id;
    const copiedTopLevel = await listProjectTasks(
      projectId,
      admin.token,
      `?parentTaskId=null`,
    ).then((all) => all.filter((t) => t.sectionId === copySectionId && t.parentTaskId === null));
    expect(copiedTopLevel.map((t) => t.title)).toEqual(["T0", "T1"]);
    for (const t of copiedTopLevel) expect(t.status).toBe("TODO");

    const copyT0 = copiedTopLevel.find((t) => t.title === "T0")!;
    const copiedSubtasks = await listProjectTasks(
      projectId,
      admin.token,
      `?parentTaskId=${copyT0.id}`,
    );
    expect(copiedSubtasks.map((t) => t.title)).toEqual(["S0", "S1"]);
    for (const t of copiedSubtasks) expect(t.status).toBe("TODO");

    const copyS0 = copiedSubtasks.find((t) => t.title === "S0")!;
    const copyS1 = copiedSubtasks.find((t) => t.title === "S1")!;
    // S0 shared its parent's original section -> follows the parent into
    // the new section.
    expect(copyS0.sectionId).toBe(copySectionId);
    // S1 had its own different section -> keeps it, untouched.
    expect(copyS1.sectionId).toBe(other.id);

    // Source rows untouched.
    const sourceT0 = await prisma.task.findUniqueOrThrow({ where: { id: t0.id } });
    const sourceT1 = await prisma.task.findUniqueOrThrow({ where: { id: t1.id } });
    expect(sourceT0.sectionId).toBe(source.id);
    expect(sourceT0.status).toBe("TODO");
    expect(sourceT1.sectionId).toBe(source.id);
    expect(sourceT1.status).toBe("DONE");
  });

  it("copies labels onto the top-level copy and places copies right after the source section's last top-level task, dense", async () => {
    const projectId = await createProject(admin.userId);
    const label = await createLabel(projectId, admin.token, "urgent-copy");
    const source = await createSection(projectId, admin.token, "Kickoff");

    const before = await createTask(projectId, admin.token, { title: "Before" });
    const t0 = await createTask(projectId, admin.token, {
      title: "T0",
      sectionId: source.id,
      labelIds: [label],
    });
    const t1 = await createTask(projectId, admin.token, { title: "T1", sectionId: source.id });
    const after = await createTask(projectId, admin.token, { title: "After" });

    const res = await duplicateSection(source.id, admin.token);
    expect(res.status).toBe(201);
    expect(res.body.taskCount).toBe(2);

    const all = await listProjectTasks(projectId, admin.token, "?parentTaskId=null");
    const copyIds = all
      .filter((t) => ![before.id, t0.id, t1.id, after.id].includes(t.id))
      .map((t) => t.id);
    expect(copyIds.length).toBe(2);

    const relevant = all.filter((t) =>
      [before.id, t0.id, t1.id, ...copyIds, after.id].includes(t.id),
    );
    // before, T0, T1, copyOfT0, copyOfT1, after — copies land right after T1
    // (source section's own last top-level task), not at the project's end.
    expect(relevant.map((t) => t.id)).toEqual([before.id, t0.id, t1.id, ...copyIds, after.id]);
    expect(relevant.map((t) => t.position)).toEqual([0, 1, 2, 3, 4, 5]);

    // copyIds is in position order, and duplicateTaskTree/insertManyAfter
    // preserve source order (T0 then T1), so copyIds[0] is T0's copy.
    const copyOfT0 = all.find((t) => t.id === copyIds[0])!;
    expect(copyOfT0.labels.map((l) => l.id)).toEqual([label]);
  });

  it("creates zero TaskDependency rows on any copy (edge inside the section and edge leaving it)", async () => {
    const projectId = await createProject(admin.userId);
    const source = await createSection(projectId, admin.token, "Kickoff");

    const outside = await createTask(projectId, admin.token, { title: "Outside" });
    const t0 = await createTask(projectId, admin.token, { title: "T0", sectionId: source.id });
    const t1 = await createTask(projectId, admin.token, { title: "T1", sectionId: source.id });

    // Edge inside the section: t0 -> t1.
    const internal = await post(`/projects/${projectId}/dependencies`, admin.token, {
      predecessorTaskId: t0.id,
      successorTaskId: t1.id,
    });
    expect(internal.status).toBe(201);

    // Edge leaving the section: t1 -> outside.
    const leaving = await post(`/projects/${projectId}/dependencies`, admin.token, {
      predecessorTaskId: t1.id,
      successorTaskId: outside.id,
    });
    expect(leaving.status).toBe(201);

    const beforeCount = await prisma.taskDependency.count({ where: { projectId } });
    expect(beforeCount).toBe(2);

    const res = await duplicateSection(source.id, admin.token);
    expect(res.status).toBe(201);

    const all = await listProjectTasks(projectId, admin.token, "?parentTaskId=null");
    const copyIds = all
      .filter((t) => ![outside.id, t0.id, t1.id].includes(t.id))
      .map((t) => t.id);
    expect(copyIds.length).toBe(2);

    const deps = await prisma.taskDependency.findMany({
      where: {
        projectId,
        OR: [{ predecessorTaskId: { in: copyIds } }, { successorTaskId: { in: copyIds } }],
      },
    });
    expect(deps).toEqual([]);

    const afterCount = await prisma.taskDependency.count({ where: { projectId } });
    expect(afterCount).toBe(2);
  });

  it("comments are never copied", async () => {
    const projectId = await createProject(admin.userId);
    const source = await createSection(projectId, admin.token, "Kickoff");
    const t0 = await createTask(projectId, admin.token, { title: "T0", sectionId: source.id });

    const commentRes = await post(`/tasks/${t0.id}/comments`, admin.token, { body: "hello" });
    expect(commentRes.status).toBe(201);

    const res = await duplicateSection(source.id, admin.token);
    expect(res.status).toBe(201);

    const all = await listProjectTasks(projectId, admin.token, "?parentTaskId=null");
    const copy = all.find((t) => t.id !== t0.id && t.title === "T0")!;
    expect(copy._count.comments).toBe(0);
  });

  it("an empty section copies as an empty section with taskCount 0", async () => {
    const projectId = await createProject(admin.userId);
    const source = await createSection(projectId, admin.token, "Empty");

    const res = await duplicateSection(source.id, admin.token);
    expect(res.status).toBe(201);
    expect(res.body.taskCount).toBe(0);
    expect(res.body.section.name).toBe("Empty");

    const copyId = (res.body.section as SectionRow).id;
    const tasksInCopy = await listProjectTasks(projectId, admin.token, "?parentTaskId=null").then(
      (all) => all.filter((t) => t.sectionId === copyId),
    );
    expect(tasksInCopy).toEqual([]);
  });

  it("404s for a section in a project the caller cannot see", async () => {
    const projectId = await createProject(admin.userId);
    const source = await createSection(projectId, admin.token, "Hidden from others");

    const otherTam = await createUserWithRole("TAM");
    const res = await duplicateSection(source.id, otherTam.token);
    expect(res.status).toBe(404);
  });

  it("403s without project:write", async () => {
    const projectId = await createProject(admin.userId);
    const source = await createSection(projectId, admin.token, "Section");

    // STAKEHOLDER has project:read + project:view-all but no project:write,
    // so this exercises the permission gate independent of visibility.
    const stakeholder = await createUserWithRole("STAKEHOLDER");
    const res = await duplicateSection(source.id, stakeholder.token);
    expect(res.status).toBe(403);
  });
});
