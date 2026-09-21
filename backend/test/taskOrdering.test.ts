import "./env.js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { seedRoles, createAdminAndToken } from "./testAuth.js";
import { insertManyAfter, type SiblingKey } from "../src/lib/taskOrdering.js";

const app = createApp();

let token: string;
let projectId: number;

async function createProject(): Promise<number> {
  const { userId } = await createAdminAndToken();
  const project = await prisma.project.create({
    data: {
      name: `Project ${Date.now()}-${Math.random()}`,
      saId: userId,
      tamId: userId,
      status: "ACTIVE",
    },
  });
  return project.id;
}

interface TaskRow {
  id: number;
  title: string;
  status: string;
  parentTaskId: number | null;
  position: number;
}

async function createTask(
  overrides: Partial<{
    title: string;
    status: string;
    parentTaskId: number | null;
  }> = {},
): Promise<TaskRow> {
  const res = await request(app)
    .post(`/projects/${projectId}/tasks`)
    .set("Authorization", `Bearer ${token}`)
    .send({ title: overrides.title ?? "Task", status: overrides.status, parentTaskId: overrides.parentTaskId });
  expect(res.status).toBe(201);
  return res.body as TaskRow;
}

async function patchTask(id: number, body: Record<string, unknown>) {
  return request(app).patch(`/tasks/${id}`).set("Authorization", `Bearer ${token}`).send(body);
}

async function listProjectTasks(query = ""): Promise<TaskRow[]> {
  const res = await request(app)
    .get(`/projects/${projectId}/tasks${query}`)
    .set("Authorization", `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body as TaskRow[];
}

async function createSection(inProjectId: number, name: string): Promise<number> {
  const res = await request(app)
    .post(`/projects/${inProjectId}/sections`)
    .set("Authorization", `Bearer ${token}`)
    .send({ name });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

async function createLabel(inProjectId: number, name: string): Promise<number> {
  const res = await request(app)
    .post(`/projects/${inProjectId}/labels`)
    .set("Authorization", `Bearer ${token}`)
    .send({ name });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

beforeAll(async () => {
  await seedRoles();
});

beforeEach(async () => {
  const admin = await createAdminAndToken();
  token = admin.token;
  projectId = await createProject();
});

describe("task creation appends to sibling list", () => {
  it("assigns positions 0, 1, 2 to three top-level tasks created in the same status column", async () => {
    const t0 = await createTask({ title: "A" });
    const t1 = await createTask({ title: "B" });
    const t2 = await createTask({ title: "C" });

    expect(t0.position).toBe(0);
    expect(t1.position).toBe(1);
    expect(t2.position).toBe(2);

    const listed = await listProjectTasks();
    expect(listed.map((t) => t.id)).toEqual([t0.id, t1.id, t2.id]);
  });

  it("orders GET /tasks (cross-project) by position asc, then id asc", async () => {
    const t0 = await createTask({ title: "A" });
    const t1 = await createTask({ title: "B" });

    // Move t1 in front of t0 to prove the global list follows position, not id.
    const patchRes = await patchTask(t1.id, { position: 0 });
    expect(patchRes.status).toBe(200);

    const res = await request(app).get("/tasks").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ids = (res.body as TaskRow[]).map((t) => t.id).filter((id) => id === t0.id || id === t1.id);
    expect(ids).toEqual([t1.id, t0.id]);
  });
});

describe("reorder within the same column", () => {
  it("re-packs positions densely after moving the last task to the front", async () => {
    const t0 = await createTask({ title: "A" });
    const t1 = await createTask({ title: "B" });
    const t2 = await createTask({ title: "C" });

    const res = await patchTask(t2.id, { position: 0 });
    expect(res.status).toBe(200);
    expect(res.body.position).toBe(0);

    const listed = await listProjectTasks();
    const relevant = listed.filter((t) => [t0.id, t1.id, t2.id].includes(t.id));
    expect(relevant.map((t) => t.id)).toEqual([t2.id, t0.id, t1.id]);
    expect(relevant.map((t) => t.position)).toEqual([0, 1, 2]);
  });

  it("clamps an out-of-range position to the end of the list", async () => {
    const t0 = await createTask({ title: "A" });
    const t1 = await createTask({ title: "B" });

    const res = await patchTask(t0.id, { position: 999 });
    expect(res.status).toBe(200);
    expect(res.body.position).toBe(1);

    const listed = await listProjectTasks();
    const relevant = listed.filter((t) => [t0.id, t1.id].includes(t.id));
    expect(relevant.map((t) => t.id)).toEqual([t1.id, t0.id]);
  });
});

describe("move across columns (status change)", () => {
  // A status-only change (no explicit position) is no longer a "move across
  // columns" for top-level tasks: status left the sibling key, so every
  // sibling — including the one being patched — keeps its exact slot in the
  // single per-project list. This is the same invariant the "status does not
  // partition" describe block below asserts on the patched row alone; this
  // test additionally proves the *other* siblings are untouched (no gap
  // close, no re-pack, no append to a destination "column").
  it("does not move or re-pack any sibling on a status-only change", async () => {
    const a0 = await createTask({ title: "A0", status: "TODO" });
    const a1 = await createTask({ title: "A1", status: "TODO" });
    const a2 = await createTask({ title: "A2", status: "TODO" });
    const b0 = await createTask({ title: "B0", status: "IN_PROGRESS" });

    const res = await patchTask(a1.id, { status: "IN_PROGRESS" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("IN_PROGRESS");
    expect(res.body.position).toBe(1); // unchanged: a1 was created second

    const listed = await listProjectTasks("?parentTaskId=null");
    const relevant = listed.filter((t) =>
      [a0.id, a1.id, a2.id, b0.id].includes(t.id),
    );
    // Creation order preserved, positions untouched by the status change.
    expect(relevant.map((t) => t.id)).toEqual([a0.id, a1.id, a2.id, b0.id]);
    expect(relevant.map((t) => t.position)).toEqual([0, 1, 2, 3]);
  });

  it("inserts at an explicit position in the destination column", async () => {
    const b0 = await createTask({ title: "B0", status: "IN_PROGRESS" });
    const b1 = await createTask({ title: "B1", status: "IN_PROGRESS" });
    const a0 = await createTask({ title: "A0", status: "TODO" });

    const res = await patchTask(a0.id, { status: "IN_PROGRESS", position: 1 });
    expect(res.status).toBe(200);
    expect(res.body.position).toBe(1);

    const listed = await listProjectTasks();
    const inProgress = listed.filter((t) => [b0.id, b1.id, a0.id].includes(t.id));
    expect(inProgress.map((t) => t.id)).toEqual([b0.id, a0.id, b1.id]);
    expect(inProgress.map((t) => t.position)).toEqual([0, 1, 2]);
  });
});

describe("re-parenting", () => {
  it("moves a top-level task into another task's subtask list (task -> subtask)", async () => {
    const parent = await createTask({ title: "Parent" });
    const child0 = await createTask({ title: "ExistingChild", parentTaskId: parent.id });
    const promotable = await createTask({ title: "WillBecomeSubtask" });

    const res = await patchTask(promotable.id, { parentTaskId: parent.id });
    expect(res.status).toBe(200);
    expect(res.body.parentTaskId).toBe(parent.id);
    expect(res.body.position).toBe(1); // appended after child0

    const subtasks = await listProjectTasks(`?parentTaskId=${parent.id}`);
    expect(subtasks.map((t) => t.id)).toEqual([child0.id, promotable.id]);
    expect(subtasks.map((t) => t.position)).toEqual([0, 1]);
  });

  it("promotes a subtask to top-level with an explicit position, keeping its status", async () => {
    const parent = await createTask({ title: "Parent" });
    const sub0 = await createTask({ title: "Sub0", parentTaskId: parent.id, status: "IN_PROGRESS" });
    const sub1 = await createTask({ title: "Sub1", parentTaskId: parent.id, status: "IN_PROGRESS" });

    const topLevelInProgress = await createTask({ title: "TL-IP-0", status: "IN_PROGRESS" });

    const res = await patchTask(sub0.id, { parentTaskId: null, position: 0 });
    expect(res.status).toBe(200);
    expect(res.body.parentTaskId).toBeNull();
    // Subtasks carry their own status; promoting keeps it unless the caller
    // also passes a new status. sub0 was IN_PROGRESS.
    expect(res.body.status).toBe("IN_PROGRESS");
    expect(res.body.position).toBe(0);

    const topLevel = await listProjectTasks("?status=IN_PROGRESS");
    const relevant = topLevel.filter((t) => t.parentTaskId === null);
    expect(relevant.map((t) => t.id)).toEqual([sub0.id, topLevelInProgress.id]);

    // Remaining subtask re-packed to position 0.
    const remainingSubtasks = await listProjectTasks(`?parentTaskId=${parent.id}`);
    expect(remainingSubtasks.map((t) => t.id)).toEqual([sub1.id]);
    expect(remainingSubtasks.map((t) => t.position)).toEqual([0]);
  });
});

describe("depth and parent validation", () => {
  it("rejects giving a parent to a task that already has subtasks (depth > 1)", async () => {
    const parent = await createTask({ title: "Parent" });
    await createTask({ title: "Child", parentTaskId: parent.id });
    const other = await createTask({ title: "Other" });

    const res = await patchTask(parent.id, { parentTaskId: other.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("max_depth_exceeded");
  });

  it("rejects setting a parent that itself has a parent (depth > 1)", async () => {
    const grandparent = await createTask({ title: "GP" });
    const parent = await createTask({ title: "P", parentTaskId: grandparent.id });
    const orphan = await createTask({ title: "Orphan" });

    const res = await patchTask(orphan.id, { parentTaskId: parent.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("max_depth_exceeded");
  });

  it("rejects a task being its own parent", async () => {
    const task = await createTask({ title: "Solo" });
    const res = await patchTask(task.id, { parentTaskId: task.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_parent");
  });

  it("rejects a parentTaskId that belongs to a different project", async () => {
    const otherProjectId = await createProject();
    const foreignParentRes = await request(app)
      .post(`/projects/${otherProjectId}/tasks`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "ForeignParent" });
    expect(foreignParentRes.status).toBe(201);
    const foreignParent = foreignParentRes.body as TaskRow;

    const task = await createTask({ title: "Local" });
    const res = await patchTask(task.id, { parentTaskId: foreignParent.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_parent");
  });

  it("rejects cross-project parentTaskId on create", async () => {
    const otherProjectId = await createProject();
    const foreignParentRes = await request(app)
      .post(`/projects/${otherProjectId}/tasks`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "ForeignParent" });
    const foreignParent = foreignParentRes.body as TaskRow;

    const res = await request(app)
      .post(`/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Bad", parentTaskId: foreignParent.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_parent");
  });
});

describe("status-only change and sibling ordering", () => {
  it("keeps a subtask's position when only its status changes (checkbox toggle)", async () => {
    const parent = await createTask({ title: "Parent" });
    const s0 = await createTask({ title: "S0", parentTaskId: parent.id });
    const s1 = await createTask({ title: "S1", parentTaskId: parent.id });
    const s2 = await createTask({ title: "S2", parentTaskId: parent.id });

    // Ticking the first subtask done must NOT bounce it to the bottom: a
    // subtask's sibling list is keyed on parentTaskId only, so status is not
    // an ordering change here.
    const res = await patchTask(s0.id, { status: "DONE" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("DONE");
    expect(res.body.position).toBe(0);

    const subtasks = await listProjectTasks(`?parentTaskId=${parent.id}`);
    expect(subtasks.map((t) => t.id)).toEqual([s0.id, s1.id, s2.id]);
    expect(subtasks.map((t) => t.position)).toEqual([0, 1, 2]);
  });

  it("keeps a top-level task's slot on a status-only change, same as a subtask", async () => {
    // Status left the top-level sibling key too: a top-level task's status
    // change now behaves exactly like the subtask case above, not like a
    // Kanban-column append. There is no per-status "destination column" to
    // move into or gap to close.
    const a0 = await createTask({ title: "A0", status: "TODO" });
    const a1 = await createTask({ title: "A1", status: "TODO" });

    const res = await patchTask(a0.id, { status: "DONE" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("DONE");
    expect(res.body.position).toBe(0); // unchanged: a0 was created first

    const all = await listProjectTasks("?parentTaskId=null");
    const relevant = all.filter((t) => [a0.id, a1.id].includes(t.id));
    expect(relevant.map((t) => t.id)).toEqual([a0.id, a1.id]);
    expect(relevant.map((t) => t.position)).toEqual([0, 1]);
  });
});

describe("global top-level ordering (status does not partition)", () => {
  it("creates append to one per-project list regardless of status", async () => {
    const a = await createTask({ title: "A", status: "TODO" });
    const b = await createTask({ title: "B", status: "DONE" });
    const c = await createTask({ title: "C", status: "TODO" });
    expect([a.position, b.position, c.position]).toEqual([0, 1, 2]);
  });

  it("a status-only patch keeps the slot", async () => {
    await createTask({ title: "A", status: "TODO" });
    const b = await createTask({ title: "B", status: "TODO" });
    await createTask({ title: "C", status: "TODO" });
    const res = await patchTask(b.id, { status: "DONE" });
    expect(res.status).toBe(200);
    expect(res.body.position).toBe(1);
    const all = await listProjectTasks("?parentTaskId=null");
    expect(all.map((t) => t.title)).toEqual(["A", "B", "C"]);
  });

  it("an explicit position patch reorders across statuses", async () => {
    const a = await createTask({ title: "A", status: "DONE" });
    const b = await createTask({ title: "B", status: "TODO" });
    const c = await createTask({ title: "C", status: "IN_PROGRESS" });
    const res = await patchTask(c.id, { position: 0 });
    expect(res.status).toBe(200);
    const all = await listProjectTasks("?parentTaskId=null");
    expect(all.map((t) => t.title)).toEqual(["C", "A", "B"]);
    expect(all.map((t) => t.position)).toEqual([0, 1, 2]);
  });

  it("status + position combined lands at the requested global index", async () => {
    await createTask({ title: "A", status: "TODO" });
    await createTask({ title: "B", status: "TODO" });
    const c = await createTask({ title: "C", status: "TODO" });
    const res = await patchTask(c.id, { status: "IN_PROGRESS", position: 1 });
    expect(res.status).toBe(200);
    const all = await listProjectTasks("?parentTaskId=null");
    expect(all.map((t) => t.title)).toEqual(["A", "C", "B"]);
  });
});

describe("insertManyAfter", () => {
  it("inserts new ids directly after the given task, re-packing the rest densely", async () => {
    const a = await createTask({ title: "A" });
    const b = await createTask({ title: "B" });
    const c = await createTask({ title: "C" });
    const n1 = await createTask({ title: "N1" });
    const n2 = await createTask({ title: "N2" });

    const key: SiblingKey = { projectId, parentTaskId: null };
    await insertManyAfter(prisma, key, a.id, [n1.id, n2.id]);

    const listed = await listProjectTasks();
    const relevant = listed.filter((t) => [a.id, b.id, c.id, n1.id, n2.id].includes(t.id));
    expect(relevant.map((t) => t.id)).toEqual([a.id, n1.id, n2.id, b.id, c.id]);
    expect(relevant.map((t) => t.position)).toEqual([0, 1, 2, 3, 4]);
  });

  it("appends at the end when afterTaskId is null", async () => {
    const a = await createTask({ title: "A" });
    const b = await createTask({ title: "B" });
    const n1 = await createTask({ title: "N1" });

    const key: SiblingKey = { projectId, parentTaskId: null };
    await insertManyAfter(prisma, key, null, [n1.id]);

    const listed = await listProjectTasks();
    const relevant = listed.filter((t) => [a.id, b.id, n1.id].includes(t.id));
    expect(relevant.map((t) => t.id)).toEqual([a.id, b.id, n1.id]);
    expect(relevant.map((t) => t.position)).toEqual([0, 1, 2]);
  });

  it("falls back to append-at-end when afterTaskId isn't a member of this sibling list", async () => {
    const a = await createTask({ title: "A" });
    const parent = await createTask({ title: "Parent" });
    // `sub` belongs to parent's subtask list, not the top-level list `key`
    // below — so it's not a member of that list even though it's a real id.
    const sub = await createTask({ title: "Sub", parentTaskId: parent.id });
    const n1 = await createTask({ title: "N1" });

    const key: SiblingKey = { projectId, parentTaskId: null };
    await insertManyAfter(prisma, key, sub.id, [n1.id]);

    const listed = await listProjectTasks();
    const relevant = listed.filter((t) => [a.id, parent.id, n1.id].includes(t.id));
    expect(relevant.map((t) => t.id)).toEqual([a.id, parent.id, n1.id]);
  });

  it("does nothing when newIds is empty", async () => {
    const a = await createTask({ title: "A" });
    const b = await createTask({ title: "B" });

    const key: SiblingKey = { projectId, parentTaskId: null };
    await insertManyAfter(prisma, key, a.id, []);

    const listed = await listProjectTasks();
    const relevant = listed.filter((t) => [a.id, b.id].includes(t.id));
    expect(relevant.map((t) => t.id)).toEqual([a.id, b.id]);
    expect(relevant.map((t) => t.position)).toEqual([0, 1]);
  });

  it("works on a subtask sibling list too", async () => {
    const parent = await createTask({ title: "Parent" });
    const s0 = await createTask({ title: "S0", parentTaskId: parent.id });
    const s1 = await createTask({ title: "S1", parentTaskId: parent.id });
    const n1 = await createTask({ title: "N1", parentTaskId: parent.id });

    const key: SiblingKey = { projectId, parentTaskId: parent.id };
    await insertManyAfter(prisma, key, s0.id, [n1.id]);

    const subtasks = await listProjectTasks(`?parentTaskId=${parent.id}`);
    expect(subtasks.map((t) => t.id)).toEqual([s0.id, n1.id, s1.id]);
    expect(subtasks.map((t) => t.position)).toEqual([0, 1, 2]);
  });

  it("throws when a newId isn't already a member of the sibling list", async () => {
    const a = await createTask({ title: "A" });
    const otherProjectId = await createProject();
    const foreignRes = await request(app)
      .post(`/projects/${otherProjectId}/tasks`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Foreign" });
    expect(foreignRes.status).toBe(201);
    const foreignId = (foreignRes.body as TaskRow).id;

    const key: SiblingKey = { projectId, parentTaskId: null };
    await expect(insertManyAfter(prisma, key, a.id, [foreignId])).rejects.toThrow(
      "insertManyAfter: every newId must already belong to the sibling list",
    );

    // Rejected call must not have touched the list.
    const listed = await listProjectTasks();
    const relevant = listed.filter((t) => t.id === a.id);
    expect(relevant.map((t) => t.position)).toEqual([0]);
  });
});

describe("cross-project section / label validation", () => {
  it("rejects a sectionId from another project on create", async () => {
    const otherProjectId = await createProject();
    const foreignSection = await createSection(otherProjectId, "Foreign");

    const res = await request(app)
      .post(`/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Bad", sectionId: foreignSection });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_section");
  });

  it("rejects a sectionId from another project on update", async () => {
    const otherProjectId = await createProject();
    const foreignSection = await createSection(otherProjectId, "Foreign");
    const task = await createTask({ title: "Local" });

    const res = await patchTask(task.id, { sectionId: foreignSection });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_section");
  });

  it("accepts a sectionId from the same project", async () => {
    const section = await createSection(projectId, "Local Section");
    const task = await createTask({ title: "Local" });

    const res = await patchTask(task.id, { sectionId: section });
    expect(res.status).toBe(200);
    expect(res.body.sectionId).toBe(section);
  });

  it("rejects a labelId from another project on create", async () => {
    const otherProjectId = await createProject();
    const foreignLabel = await createLabel(otherProjectId, "foreign");

    const res = await request(app)
      .post(`/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Bad", labelIds: [foreignLabel] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_label");
  });

  it("rejects a labelId from another project on update", async () => {
    const otherProjectId = await createProject();
    const foreignLabel = await createLabel(otherProjectId, "foreign");
    const task = await createTask({ title: "Local" });

    const res = await patchTask(task.id, { labelIds: [foreignLabel] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_label");
  });
});
