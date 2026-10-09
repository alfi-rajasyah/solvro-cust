import "./env.js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { createAdminAndToken, createUserWithRole, seedRoles } from "./testAuth.js";
import { duplicateTaskTree } from "../src/lib/duplicate.js";

// POST /tasks/:id/duplicate — docs/plans/duplicate-tasks-sections.md §3-4.
// Settled rules: title copied verbatim; status resets to TODO for the copy
// AND every copied subtask; baselineStartDate/baselineDueDate reset to
// null; no TaskDependency rows for the copy or its subtasks; comments never
// copied; the copy lands at source.position + 1 in the same sibling list,
// dense 0..n-1.

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

interface TaskRow {
  id: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  startDate: string | null;
  dueDate: string | null;
  isMilestone: boolean;
  isCriticalPath: boolean;
  baselineStartDate: string | null;
  baselineDueDate: string | null;
  assignedToId: number | null;
  parentTaskId: number | null;
  sectionId: number | null;
  epicId: number | null;
  position: number;
  labels: { id: number; name: string }[];
  assignedTo: { id: number; username: string; email: string } | null;
  section: { id: number; name: string; position: number; color: string } | null;
  _count: { subtasks: number; comments: number };
}

function post(path: string, token: string, body?: Record<string, unknown>) {
  const req = request(app).post(path).set("Authorization", `Bearer ${token}`);
  return body ? req.send(body) : req.send();
}

async function createTask(
  projectId: number,
  token: string,
  overrides: Partial<{
    title: string;
    description: string;
    status: string;
    priority: string;
    startDate: string;
    dueDate: string;
    isMilestone: boolean;
    isCriticalPath: boolean;
    assignedToId: number;
    parentTaskId: number;
    sectionId: number;
    labelIds: number[];
    epicId: number;
  }> = {},
): Promise<TaskRow> {
  const res = await post(`/projects/${projectId}/tasks`, token, {
    title: overrides.title ?? "Task",
    ...overrides,
  });
  expect(res.status).toBe(201);
  return res.body as TaskRow;
}

async function createSection(projectId: number, token: string, name: string): Promise<number> {
  const res = await post(`/projects/${projectId}/sections`, token, { name });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

async function createLabel(projectId: number, token: string, name: string): Promise<number> {
  const res = await post(`/projects/${projectId}/labels`, token, { name });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

async function createEpic(projectId: number, token: string, title: string): Promise<number> {
  const res = await post(`/projects/${projectId}/epics`, token, { title });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

async function duplicateTask(id: number, token: string) {
  return request(app).post(`/tasks/${id}/duplicate`).set("Authorization", `Bearer ${token}`).send();
}

async function listProjectTasks(projectId: number, token: string, query = "") {
  const res = await request(app)
    .get(`/projects/${projectId}/tasks${query}`)
    .set("Authorization", `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body as TaskRow[];
}

describe("POST /tasks/:id/duplicate", () => {
  it("copies every field verbatim (title included), resetting status and baseline", async () => {
    const projectId = await createProject(admin.userId);
    const section = await createSection(projectId, admin.token, "Kickoff");
    const label = await createLabel(projectId, admin.token, "urgent-copy");
    const other = await createUserWithRole("TAM");

    const source = await createTask(projectId, admin.token, {
      title: "Same Title Every Time",
      description: "Detailed description",
      priority: "URGENT",
      startDate: "2026-09-10",
      dueDate: "2026-09-20",
      isCriticalPath: true,
      assignedToId: other.userId,
      sectionId: section,
      labelIds: [label],
    });
    // Move the source to DONE and lock a baseline so we can assert the copy
    // resets both — DONE requires a PATCH since create doesn't accept it
    // together with a milestone/date refine oddity; plain status patch is fine.
    const doneRes = await request(app)
      .patch(`/tasks/${source.id}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ status: "DONE" });
    expect(doneRes.status).toBe(200);

    const baselineRes = await request(app)
      .post(`/projects/${projectId}/baseline`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({});
    expect(baselineRes.status).toBe(200);

    const withBaseline = await request(app)
      .get(`/projects/${projectId}/tasks?parentTaskId=null`)
      .set("Authorization", `Bearer ${admin.token}`);
    const sourceWithBaseline = (withBaseline.body as TaskRow[]).find((t) => t.id === source.id)!;
    expect(sourceWithBaseline.baselineStartDate).not.toBeNull();
    expect(sourceWithBaseline.baselineDueDate).not.toBeNull();
    expect(sourceWithBaseline.status).toBe("DONE");

    const res = await duplicateTask(source.id, admin.token);
    expect(res.status).toBe(201);
    const copy = res.body as TaskRow;

    expect(copy.id).not.toBe(source.id);
    expect(copy.title).toBe("Same Title Every Time");
    expect(copy.description).toBe("Detailed description");
    expect(copy.priority).toBe("URGENT");
    expect(new Date(copy.startDate!).toISOString().slice(0, 10)).toBe("2026-09-10");
    expect(new Date(copy.dueDate!).toISOString().slice(0, 10)).toBe("2026-09-20");
    expect(copy.isCriticalPath).toBe(true);
    expect(copy.assignedToId).toBe(other.userId);
    expect(copy.sectionId).toBe(section);
    expect(copy.labels.map((l) => l.id)).toEqual([label]);

    // Reset fields:
    expect(copy.status).toBe("TODO");
    expect(copy.baselineStartDate).toBeNull();
    expect(copy.baselineDueDate).toBeNull();

    // The 201 body carries the full related objects (same include shape as
    // POST /projects/:id/tasks), not just the foreign-key columns.
    const otherUser = await prisma.user.findUniqueOrThrow({ where: { id: other.userId } });
    expect(copy.assignedTo).toEqual({
      id: other.userId,
      username: otherUser.username,
      email: otherUser.email,
    });
    expect(copy.section).toEqual({ id: section, name: "Kickoff", position: 0, color: "#94a3b8" });
  });

  // docs/archive/plans/epics-spec.md §4: "lib/duplicate.ts copies keep epicId (same
  // project)." Covered separately from the big verbatim test above so a
  // failure here reads unambiguously as an epic-copy regression.
  it("keeps epicId on the copy", async () => {
    const projectId = await createProject(admin.userId);
    const epic = await createEpic(projectId, admin.token, "Sprint 1");
    const source = await createTask(projectId, admin.token, {
      title: "Has an epic",
      epicId: epic,
    });
    expect(source.epicId).toBe(epic);

    const res = await duplicateTask(source.id, admin.token);
    expect(res.status).toBe(201);
    const copy = res.body as TaskRow;
    expect(copy.epicId).toBe(epic);
  });

  it("comments are never copied", async () => {
    const projectId = await createProject(admin.userId);
    const source = await createTask(projectId, admin.token, { title: "Has comments" });

    const commentRes = await post(`/tasks/${source.id}/comments`, admin.token, { body: "hello" });
    expect(commentRes.status).toBe(201);

    const res = await duplicateTask(source.id, admin.token);
    expect(res.status).toBe(201);
    expect(res.body._count.comments).toBe(0);

    const commentsList = await request(app)
      .get(`/tasks/${res.body.id}/comments`)
      .set("Authorization", `Bearer ${admin.token}`);
    expect(commentsList.status).toBe(200);
    expect(commentsList.body).toEqual([]);
  });

  it("copies subtasks in source order, under the new task, all TODO", async () => {
    const projectId = await createProject(admin.userId);
    const parent = await createTask(projectId, admin.token, { title: "Parent" });
    const s0 = await createTask(projectId, admin.token, { title: "S0", parentTaskId: parent.id });
    const s1 = await createTask(projectId, admin.token, { title: "S1", parentTaskId: parent.id });
    const s2 = await createTask(projectId, admin.token, { title: "S2", parentTaskId: parent.id });

    // Put s1 into DONE to prove subtask status resets too.
    const patchRes = await request(app)
      .patch(`/tasks/${s1.id}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ status: "DONE" });
    expect(patchRes.status).toBe(200);

    const res = await duplicateTask(parent.id, admin.token);
    expect(res.status).toBe(201);
    const copyParentId = res.body.id as number;
    expect(res.body._count.subtasks).toBe(3);

    const copiedSubtasks = await listProjectTasks(projectId, admin.token, `?parentTaskId=${copyParentId}`);
    expect(copiedSubtasks.map((t) => t.title)).toEqual(["S0", "S1", "S2"]);
    expect(copiedSubtasks.map((t) => t.position)).toEqual([0, 1, 2]);
    for (const t of copiedSubtasks) {
      expect(t.status).toBe("TODO");
      expect(t.parentTaskId).toBe(copyParentId);
    }
  });

  it("places the copy at source.position + 1 and keeps the sibling list dense", async () => {
    const projectId = await createProject(admin.userId);
    const a = await createTask(projectId, admin.token, { title: "A" });
    const b = await createTask(projectId, admin.token, { title: "B" });
    const c = await createTask(projectId, admin.token, { title: "C" });
    expect([a.position, b.position, c.position]).toEqual([0, 1, 2]);

    const res = await duplicateTask(a.id, admin.token);
    expect(res.status).toBe(201);
    expect(res.body.position).toBe(1);

    const all = await listProjectTasks(projectId, admin.token, "?parentTaskId=null");
    const relevant = all.filter((t) => [a.id, b.id, c.id, res.body.id].includes(t.id));
    expect(relevant.map((t) => t.id)).toEqual([a.id, res.body.id, b.id, c.id]);
    expect(relevant.map((t) => t.position)).toEqual([0, 1, 2, 3]);
  });

  it("creates zero TaskDependency rows referencing the copy or its subtasks", async () => {
    const projectId = await createProject(admin.userId);
    const other = await createTask(projectId, admin.token, { title: "Other" });
    const source = await createTask(projectId, admin.token, { title: "Source" });
    const b1 = await createTask(projectId, admin.token, { title: "B1", parentTaskId: source.id });
    const b2 = await createTask(projectId, admin.token, { title: "B2", parentTaskId: source.id });

    // Incoming edge into the source: other -> source.
    const incoming = await post(`/projects/${projectId}/dependencies`, admin.token, {
      predecessorTaskId: other.id,
      successorTaskId: source.id,
    });
    expect(incoming.status).toBe(201);

    // Internal edge between the source's own subtasks: b1 -> b2.
    const internal = await post(`/projects/${projectId}/dependencies`, admin.token, {
      predecessorTaskId: b1.id,
      successorTaskId: b2.id,
    });
    expect(internal.status).toBe(201);

    const beforeCount = await prisma.taskDependency.count({ where: { projectId } });
    expect(beforeCount).toBe(2);

    const res = await duplicateTask(source.id, admin.token);
    expect(res.status).toBe(201);
    const copyId = res.body.id as number;

    const copiedSubtasks = await listProjectTasks(projectId, admin.token, `?parentTaskId=${copyId}`);
    expect(copiedSubtasks.length).toBe(2);
    const relevantIds = [copyId, ...copiedSubtasks.map((t) => t.id)];

    const deps = await prisma.taskDependency.findMany({
      where: {
        projectId,
        OR: [
          { predecessorTaskId: { in: relevantIds } },
          { successorTaskId: { in: relevantIds } },
        ],
      },
    });
    expect(deps).toEqual([]);

    // Original edges untouched.
    const afterCount = await prisma.taskDependency.count({ where: { projectId } });
    expect(afterCount).toBe(2);
  });

  it("a subtask source copies under the same parent right after itself", async () => {
    const projectId = await createProject(admin.userId);
    const parent = await createTask(projectId, admin.token, { title: "Parent" });
    const s0 = await createTask(projectId, admin.token, { title: "S0", parentTaskId: parent.id });
    const s1 = await createTask(projectId, admin.token, { title: "S1", parentTaskId: parent.id });
    const s2 = await createTask(projectId, admin.token, { title: "S2", parentTaskId: parent.id });

    const res = await duplicateTask(s1.id, admin.token);
    expect(res.status).toBe(201);
    const copy = res.body as TaskRow;
    expect(copy.parentTaskId).toBe(parent.id);
    expect(copy.title).toBe("S1");
    // No grandchildren: subtasks don't get subtasks of their own.
    expect(copy._count.subtasks).toBe(0);

    const siblings = await listProjectTasks(projectId, admin.token, `?parentTaskId=${parent.id}`);
    expect(siblings.map((t) => t.id)).toEqual([s0.id, s1.id, copy.id, s2.id]);
    expect(siblings.map((t) => t.position)).toEqual([0, 1, 2, 3]);
  });

  it("places the copy right after the source even when an earlier sibling was deleted (no re-pack)", async () => {
    const projectId = await createProject(admin.userId);
    const a = await createTask(projectId, admin.token, { title: "A" });
    const b = await createTask(projectId, admin.token, { title: "B" });
    const c = await createTask(projectId, admin.token, { title: "C" });
    expect([a.position, b.position, c.position]).toEqual([0, 1, 2]);

    // DELETE /tasks/:id is a bare delete with no re-pack: after this, B and C
    // keep their stale stored positions (1 and 2) even though the list now
    // has only two members — regression coverage for placement that used to
    // treat `source.position + 1` as a list INDEX instead of finding the
    // source by identity.
    const deleteRes = await request(app)
      .delete(`/tasks/${a.id}`)
      .set("Authorization", `Bearer ${admin.token}`);
    expect(deleteRes.status).toBe(204);

    const res = await duplicateTask(b.id, admin.token);
    expect(res.status).toBe(201);

    const all = await listProjectTasks(projectId, admin.token, "?parentTaskId=null");
    const relevant = all.filter((t) => [b.id, c.id, res.body.id].includes(t.id));
    expect(relevant.map((t) => t.id)).toEqual([b.id, res.body.id, c.id]);
    expect(relevant.map((t) => t.position)).toEqual([0, 1, 2]);
  });

  it("404s for a task in a project the caller cannot see", async () => {
    const projectId = await createProject(admin.userId);
    const source = await createTask(projectId, admin.token, { title: "Hidden from others" });

    const otherTam = await createUserWithRole("TAM");
    const res = await duplicateTask(source.id, otherTam.token);
    expect(res.status).toBe(404);
  });

  it("403s without task:write", async () => {
    const projectId = await createProject(admin.userId);
    const source = await createTask(projectId, admin.token, { title: "Task" });

    // AUDITOR has project:read + project:view-all but no task:write, so
    // this exercises the permission gate independent of visibility.
    const stakeholder = await createUserWithRole("AUDITOR");
    const res = await duplicateTask(source.id, stakeholder.token);
    expect(res.status).toBe(403);
  });
});

// duplicateTaskTree's overrides.sectionId isn't reachable through
// POST /tasks/:id/duplicate (that route never passes overrides) — it's
// exercised here directly the way the future section-duplicate route will
// use it: relocate every top-level copy, and follow subtasks that shared
// the parent's original section, while leaving subtasks with their own
// different (or no) section untouched.
describe("duplicateTaskTree overrides.sectionId", () => {
  it("moves the top-level copy and same-section subtasks into the override section, leaving other subtasks as-is", async () => {
    const projectId = await createProject(admin.userId);
    const oldSection = await createSection(projectId, admin.token, "Old");
    const newSection = await createSection(projectId, admin.token, "New");
    const otherSection = await createSection(projectId, admin.token, "Other");

    const parent = await createTask(projectId, admin.token, {
      title: "Parent",
      sectionId: oldSection,
    });
    const sameSectionChild = await createTask(projectId, admin.token, {
      title: "SameSection",
      parentTaskId: parent.id,
      sectionId: oldSection,
    });
    const differentSectionChild = await createTask(projectId, admin.token, {
      title: "DifferentSection",
      parentTaskId: parent.id,
      sectionId: otherSection,
    });
    const noSectionChild = await createTask(projectId, admin.token, {
      title: "NoSection",
      parentTaskId: parent.id,
    });

    const idMap = await prisma.$transaction((tx) =>
      duplicateTaskTree(tx, [parent.id], { sectionId: newSection }),
    );

    const copyParent = await prisma.task.findUniqueOrThrow({
      where: { id: idMap.get(parent.id)! },
    });
    const copySame = await prisma.task.findUniqueOrThrow({
      where: { id: idMap.get(sameSectionChild.id)! },
    });
    const copyDifferent = await prisma.task.findUniqueOrThrow({
      where: { id: idMap.get(differentSectionChild.id)! },
    });
    const copyNoSection = await prisma.task.findUniqueOrThrow({
      where: { id: idMap.get(noSectionChild.id)! },
    });

    expect(copyParent.sectionId).toBe(newSection);
    // Shared the parent's original section -> follows it into the override.
    expect(copySame.sectionId).toBe(newSection);
    // Had its own different section -> keeps it, untouched by the override.
    expect(copyDifferent.sectionId).toBe(otherSection);
    // Had no section of its own -> keeps that (null), untouched too.
    expect(copyNoSection.sectionId).toBeNull();
  });
});
