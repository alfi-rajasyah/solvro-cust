// Custom task statuses, phase A (docs/archive/plans/custom-task-statuses.md):
// Task.status stays the CATEGORY of Task.statusDef and both are written in
// lockstep; GET /task-statuses; the admin whole-list save; the migration's
// WIP-limit re-keying.
import "./env.js";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { createUserWithRole, seedRoles } from "./testAuth.js";
import { resetStatusDefs, SID } from "./statusFixtures.js";

const app = createApp();

beforeAll(async () => {
  await seedRoles();
});

// Every test that edits the list puts it back (tasks first: Restrict FK).
afterEach(async () => {
  await resetStatusDefs();
});

const uniq = (label: string) => `${label} ${Date.now()}-${Math.random()}`;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

type Def = { id?: number; name: string; category: "TODO" | "IN_PROGRESS" | "DONE"; color: string; isDefault: boolean };
const BASE: Def[] = [
  { id: 1, name: "To do", category: "TODO", color: "gray", isDefault: true },
  { id: 2, name: "In progress", category: "IN_PROGRESS", color: "primary", isDefault: true },
  { id: 3, name: "Done", category: "DONE", color: "emerald", isDefault: true },
];

async function setup() {
  const admin = await createUserWithRole("ADMIN");
  const tam = await createUserWithRole("TAM");
  const project = await prisma.project.create({
    data: { name: uniq("Project"), tamId: tam.userId, customerId: null, status: "ACTIVE" },
  });
  return { admin, tam, project };
}

const put = (token: string, body: unknown) =>
  request(app).put("/admin/task-statuses").set(auth(token)).send(body as object);

async function makeTask(projectId: number, statusId: number, status: "TODO" | "IN_PROGRESS" | "DONE") {
  return prisma.task.create({ data: { projectId, title: uniq("T"), status, statusId } });
}

describe("GET /task-statuses", () => {
  it("returns the seeded list in order for any user with project:read; 401 without a session", async () => {
    const { tam } = await setup();
    const res = await request(app).get("/task-statuses").set(auth(tam.token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 1, name: "To do", category: "TODO", color: "gray", position: 0, isDefault: true },
      { id: 2, name: "In progress", category: "IN_PROGRESS", color: "primary", position: 1, isDefault: true },
      { id: 3, name: "Done", category: "DONE", color: "emerald", position: 2, isDefault: true },
    ]);
    expect((await request(app).get("/task-statuses")).status).toBe(401);
  });
});

describe("task writes keep status and statusId in sync", () => {
  it("a legacy `status` write maps to that category's default status", async () => {
    const { tam, project } = await setup();
    // Make a custom DONE-category status the default, so the mapping is visible.
    const admin = await createUserWithRole("ADMIN");
    const saved = await put(admin.token, {
      statuses: [
        ...BASE.slice(0, 2),
        { name: "Shipped", category: "DONE", color: "emerald", isDefault: true },
        { id: 3, name: "Done", category: "DONE", color: "emerald", isDefault: false },
      ],
    });
    expect(saved.status).toBe(200);
    const shipped = saved.body.find((d: { name: string }) => d.name === "Shipped");
    const task = await makeTask(project.id, SID.TODO, "TODO");

    const res = await request(app).patch(`/tasks/${task.id}`).set(auth(tam.token)).send({ status: "DONE" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("DONE");
    expect(res.body.statusId).toBe(shipped.id);
    expect(res.body.statusDef).toEqual({
      id: shipped.id,
      name: "Shipped",
      color: "emerald",
      category: "DONE",
      position: shipped.position,
    });
    await prisma.task.delete({ where: { id: task.id } });
  });

  it("a statusId write sets the category; status and statusId always agree", async () => {
    const { admin, tam, project } = await setup();
    const saved = await put(admin.token, {
      statuses: [
        BASE[0],
        { name: "Backlog", category: "TODO", color: "violet", isDefault: false },
        { name: "QA", category: "IN_PROGRESS", color: "amber", isDefault: false },
        BASE[1],
        BASE[2],
      ],
    });
    expect(saved.status).toBe(200);
    const qa = saved.body.find((d: { name: string }) => d.name === "QA");
    const task = await makeTask(project.id, SID.TODO, "TODO");

    const res = await request(app).patch(`/tasks/${task.id}`).set(auth(tam.token)).send({ statusId: qa.id });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "IN_PROGRESS", statusId: qa.id });
    const row = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row).toMatchObject({ status: "IN_PROGRESS", statusId: qa.id });

    // Same write together with the matching category is fine; a mismatch is 400.
    const ok = await request(app)
      .patch(`/tasks/${task.id}`)
      .set(auth(tam.token))
      .send({ statusId: qa.id, status: "IN_PROGRESS" });
    expect(ok.status).toBe(200);
    const bad = await request(app)
      .patch(`/tasks/${task.id}`)
      .set(auth(tam.token))
      .send({ statusId: qa.id, status: "DONE" });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("status_mismatch");
    const unknown = await request(app).patch(`/tasks/${task.id}`).set(auth(tam.token)).send({ statusId: 99999 });
    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe("status_not_found");
    await prisma.task.delete({ where: { id: task.id } });
  });

  it("a drag that sends statusId and position together writes both", async () => {
    const { admin, tam, project } = await setup();
    const saved = await put(admin.token, {
      statuses: [BASE[0], BASE[1], { name: "Review", category: "IN_PROGRESS", color: "violet", isDefault: false }, BASE[2]],
    });
    const review = saved.body.find((d: { name: string }) => d.name === "Review");
    const a = await makeTask(project.id, SID.TODO, "TODO");
    const b = await makeTask(project.id, SID.TODO, "TODO");
    const res = await request(app)
      .patch(`/tasks/${b.id}`)
      .set(auth(tam.token))
      .send({ statusId: review.id, position: 0 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "IN_PROGRESS", statusId: review.id, position: 0 });
    await prisma.task.deleteMany({ where: { id: { in: [a.id, b.id] } } });
  });

  it("POST /projects/:id/tasks defaults to the TODO default status and accepts statusId or legacy status", async () => {
    const { admin, tam, project } = await setup();
    const saved = await put(admin.token, {
      statuses: [
        { id: 1, name: "To do", category: "TODO", color: "gray", isDefault: false },
        { name: "Backlog", category: "TODO", color: "violet", isDefault: true },
        BASE[1],
        BASE[2],
      ],
    });
    const backlog = saved.body.find((d: { name: string }) => d.name === "Backlog");

    const plain = await request(app).post(`/projects/${project.id}/tasks`).set(auth(tam.token)).send({ title: "x" });
    expect(plain.status).toBe(201);
    expect(plain.body).toMatchObject({ status: "TODO", statusId: backlog.id });
    expect(plain.body.statusDef.name).toBe("Backlog");

    const legacy = await request(app)
      .post(`/projects/${project.id}/tasks`)
      .set(auth(tam.token))
      .send({ title: "y", status: "IN_PROGRESS" });
    expect(legacy.body).toMatchObject({ status: "IN_PROGRESS", statusId: 2 });

    const byId = await request(app)
      .post(`/projects/${project.id}/tasks`)
      .set(auth(tam.token))
      .send({ title: "z", statusId: 3 });
    expect(byId.body).toMatchObject({ status: "DONE", statusId: 3 });
    await prisma.task.deleteMany({ where: { projectId: project.id } });
  });

  it("a duplicate resets to the TODO default status, not a literal TODO row", async () => {
    const { admin, tam, project } = await setup();
    const saved = await put(admin.token, {
      statuses: [
        { id: 1, name: "To do", category: "TODO", color: "gray", isDefault: false },
        { name: "Backlog", category: "TODO", color: "violet", isDefault: true },
        BASE[1],
        BASE[2],
      ],
    });
    const backlog = saved.body.find((d: { name: string }) => d.name === "Backlog");
    const src = await makeTask(project.id, SID.DONE, "DONE");
    const sub = await prisma.task.create({
      data: { projectId: project.id, title: "sub", status: "DONE", statusId: SID.DONE, parentTaskId: src.id },
    });
    const res = await request(app).post(`/tasks/${src.id}/duplicate`).set(auth(tam.token));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "TODO", statusId: backlog.id });
    const copies = await prisma.task.findMany({ where: { projectId: project.id, id: { notIn: [src.id, sub.id] } } });
    expect(copies).toHaveLength(2);
    expect(copies.every((c) => c.statusId === backlog.id && c.status === "TODO")).toBe(true);
    await prisma.task.deleteMany({ where: { projectId: project.id, parentTaskId: { not: null } } });
    await prisma.task.deleteMany({ where: { projectId: project.id } });
  });
});

describe("S1: a bare category equal to the current one is no change", () => {
  it("PATCH {status: <current category>, position} keeps a custom status; a changed category maps to the default", async () => {
    const { admin, tam, project } = await setup();
    const saved = await put(admin.token, {
      statuses: [BASE[0], BASE[1], { name: "QA", category: "IN_PROGRESS", color: "amber", isDefault: false }, BASE[2]],
    });
    const qa = saved.body.find((d: { name: string }) => d.name === "QA");
    const a = await makeTask(project.id, qa.id, "IN_PROGRESS");
    const b = await makeTask(project.id, SID.TODO, "TODO");

    const reorder = await request(app)
      .patch(`/tasks/${a.id}`)
      .set(auth(tam.token))
      .send({ status: "IN_PROGRESS", position: 1 });
    expect(reorder.status).toBe(200);
    expect(reorder.body.statusId).toBe(qa.id);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: a.id } })).statusId).toBe(qa.id);

    const toggle = await request(app).patch(`/tasks/${a.id}`).set(auth(tam.token)).send({ status: "DONE" });
    expect(toggle.body).toMatchObject({ status: "DONE", statusId: SID.DONE });
    await prisma.task.deleteMany({ where: { id: { in: [a.id, b.id] } } });
  });
});

describe("S3: deleting a status drops its WIP limit", () => {
  it("a project PATCH with the old limits object still succeeds after the status is deleted", async () => {
    const { admin, tam } = await setup();
    const saved = await put(admin.token, {
      statuses: [BASE[0], BASE[1], { name: "QA", category: "IN_PROGRESS", color: "amber", isDefault: false }, BASE[2]],
    });
    const qa = saved.body.find((d: { name: string }) => d.name === "QA");
    const limits = { [SID.TODO]: 4, [qa.id]: 2 };
    const project = await prisma.project.create({
      data: { name: uniq("WIP"), tamId: tam.userId, wipLimits: limits },
    });
    expect((await put(admin.token, { statuses: BASE })).status).toBe(200);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).wipLimits).toEqual({
      [SID.TODO]: 4,
    });
    const res = await request(app)
      .patch(`/projects/${project.id}`)
      .set(auth(tam.token))
      .send({ wipLimits: { [SID.TODO]: 5 } });
    expect(res.status).toBe(200);
    // The old object (with the dead key) is what is refused.
    const stale = await request(app).patch(`/projects/${project.id}`).set(auth(tam.token)).send({ wipLimits: limits });
    expect(stale.status).toBe(400);
  });
});

describe("filters", () => {
  it("?status= keeps category semantics; ?statusId= narrows to one status (cross-project and per-project)", async () => {
    const { admin, tam, project } = await setup();
    const saved = await put(admin.token, {
      statuses: [BASE[0], { name: "Backlog", category: "TODO", color: "violet", isDefault: false }, BASE[1], BASE[2]],
    });
    const backlog = saved.body.find((d: { name: string }) => d.name === "Backlog");
    const plain = await makeTask(project.id, SID.TODO, "TODO");
    const bl = await makeTask(project.id, backlog.id, "TODO");
    const done = await makeTask(project.id, SID.DONE, "DONE");
    const ids = (r: { body: { id: number }[] }) => r.body.map((t) => t.id).sort((x, y) => x - y);
    const mine = { customerId: undefined, tamId: tam.userId };

    const byCat = await request(app).get("/tasks").set(auth(tam.token)).query({ ...mine, status: "TODO" });
    expect(ids(byCat)).toEqual([plain.id, bl.id].sort((x, y) => x - y));
    const byId = await request(app).get("/tasks").set(auth(tam.token)).query({ ...mine, statusId: backlog.id });
    expect(ids(byId)).toEqual([bl.id]);
    expect(byId.body[0].statusDef.name).toBe("Backlog");
    const none = await request(app)
      .get("/tasks")
      .set(auth(tam.token))
      .query({ ...mine, statusId: SID.TODO, status: "DONE" });
    expect(none.body).toEqual([]);

    const proj = await request(app).get(`/projects/${project.id}/tasks`).set(auth(tam.token)).query({ statusId: SID.DONE });
    expect(ids(proj)).toEqual([done.id]);
    const projCat = await request(app).get(`/projects/${project.id}/tasks`).set(auth(tam.token)).query({ status: "TODO" });
    expect(ids(projCat)).toEqual([plain.id, bl.id].sort((x, y) => x - y));
    await prisma.task.deleteMany({ where: { projectId: project.id } });
  });
});

describe("stale write on statusId", () => {
  it("expected.statusId conflicts after a same-category move, and passes when current", async () => {
    const { admin, tam, project } = await setup();
    const saved = await put(admin.token, {
      statuses: [BASE[0], { name: "Backlog", category: "TODO", color: "violet", isDefault: false }, BASE[1], BASE[2]],
    });
    const backlog = saved.body.find((d: { name: string }) => d.name === "Backlog");
    const task = await makeTask(project.id, SID.TODO, "TODO");
    await prisma.task.update({ where: { id: task.id }, data: { statusId: backlog.id } }); // same category

    const stale = await request(app)
      .patch(`/tasks/${task.id}`)
      .set(auth(tam.token))
      .send({ statusId: SID.IN_PROGRESS, expected: { statusId: SID.TODO } });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("stale_write");
    expect(stale.body.details.conflicts).toEqual([{ field: "statusId", expected: SID.TODO, current: backlog.id }]);
    expect(stale.body.details.task.statusDef.name).toBe("Backlog");

    const ok = await request(app)
      .patch(`/tasks/${task.id}`)
      .set(auth(tam.token))
      .send({ statusId: SID.IN_PROGRESS, expected: { statusId: backlog.id } });
    expect(ok.status).toBe(200);
    await prisma.task.delete({ where: { id: task.id } });
  });
});

describe("GET /admin/task-statuses", () => {
  it("is admin-only and returns the list with per-status task counts", async () => {
    const { admin, tam, project } = await setup();
    expect((await request(app).get("/admin/task-statuses").set(auth(tam.token))).status).toBe(403);
    const counts = async () => {
      const r = await request(app).get("/admin/task-statuses").set(auth(admin.token));
      expect(r.status).toBe(200);
      return { res: r, byId: Object.fromEntries(r.body.map((d: { id: number; taskCount: number }) => [d.id, d.taskCount])) as Record<number, number> };
    };
    const before = (await counts()).byId;
    await makeTask(project.id, 2, "IN_PROGRESS");
    await makeTask(project.id, 2, "IN_PROGRESS");
    await makeTask(project.id, 3, "DONE");
    const { res, byId } = await counts();
    expect(byId[1]).toBe(before[1]);
    expect(byId[2]).toBe(before[2] + 2);
    expect(byId[3]).toBe(before[3] + 1);
    expect(res.body[0]).toMatchObject({ id: 1, name: "To do", category: "TODO", color: "gray", position: 0, isDefault: true });
  });
});

describe("PUT /admin/task-statuses", () => {
  it("is admin-only", async () => {
    const { tam } = await setup();
    expect((await put(tam.token, { statuses: BASE })).status).toBe(403);
  });

  it("saves the whole list: add, rename, recolour, reorder; array order is position", async () => {
    const { admin } = await setup();
    const res = await put(admin.token, {
      statuses: [
        { id: 2, name: "Development", category: "IN_PROGRESS", color: "violet", isDefault: true },
        { id: 1, name: "Backlog", category: "TODO", color: "violet", isDefault: true },
        { id: 3, name: "Done", category: "DONE", color: "emerald", isDefault: true },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.map((d: { id: number; name: string; position: number }) => [d.id, d.name, d.position])).toEqual([
      [2, "Development", 0],
      [1, "Backlog", 1],
      [3, "Done", 2],
    ]);
    expect((await request(app).get("/task-statuses").set(auth(admin.token))).body).toEqual(res.body);
  });

  it("can swap two names in one save", async () => {
    const { admin } = await setup();
    const res = await put(admin.token, {
      statuses: [
        { id: 1, name: "X", category: "TODO", color: "gray", isDefault: true },
        { id: 2, name: "To do", category: "IN_PROGRESS", color: "primary", isDefault: true },
        { id: 3, name: "Done", category: "DONE", color: "emerald", isDefault: true },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.map((d: { name: string }) => d.name)).toEqual(["X", "To do", "Done"]);
  });

  it("409 when a category has no status, or does not have exactly one default", async () => {
    const { admin } = await setup();
    const empty = await put(admin.token, { statuses: [BASE[0], { ...BASE[1], category: "TODO", isDefault: false }, BASE[2]] });
    expect(empty.status).toBe(409);
    expect(empty.body.code).toBe("status_category_empty");

    const noDefault = await put(admin.token, { statuses: [BASE[0], { ...BASE[1], isDefault: false }, BASE[2]] });
    expect(noDefault.status).toBe(409);
    expect(noDefault.body.code).toBe("status_default_invalid");

    const twoDefaults = await put(admin.token, {
      statuses: [...BASE, { name: "Backlog", category: "TODO", color: "violet", isDefault: true }],
    });
    expect(twoDefaults.status).toBe(409);
    expect(twoDefaults.body.code).toBe("status_default_invalid");
    // Nothing was written.
    expect(await prisma.taskStatusDef.count()).toBe(3);
  });

  it("409 on duplicate names (case-insensitive); 400 on a tone outside the fixed set (a hex, rose) or an unknown id", async () => {
    const { admin } = await setup();
    const dup = await put(admin.token, {
      statuses: [...BASE, { name: "to DO", category: "TODO", color: "violet", isDefault: false }],
    });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("status_name_taken");

    const color = await put(admin.token, { statuses: [{ ...BASE[0], color: "rose" }, BASE[1], BASE[2]] });
    expect(color.status).toBe(400);
    const hex = await put(admin.token, { statuses: [{ ...BASE[0], color: "#64748b" }, BASE[1], BASE[2]] });
    expect(hex.status).toBe(400);
    const unknown = await put(admin.token, { statuses: [BASE[0], BASE[1], BASE[2], { ...BASE[0], id: 404, name: "Ghost", isDefault: false }] });
    expect(unknown.status).toBe(400);
  });

  it("deleting a status with tasks needs moveTo (409), then moves them in one go and follows the target's category", async () => {
    const { admin, project } = await setup();
    const saved = await put(admin.token, {
      statuses: [BASE[0], BASE[1], { name: "QA", category: "IN_PROGRESS", color: "amber", isDefault: false }, BASE[2]],
    });
    const qa = saved.body.find((d: { name: string }) => d.name === "QA");
    const t1 = await makeTask(project.id, qa.id, "IN_PROGRESS");
    const t2 = await makeTask(project.id, qa.id, "IN_PROGRESS");
    const without = [BASE[0], BASE[1], BASE[2]];

    const refused = await put(admin.token, { statuses: without });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("status_move_required");
    expect(await prisma.taskStatusDef.count()).toBe(4);

    const badTarget = await put(admin.token, { statuses: without, moveTo: { [qa.id]: 777 } });
    expect(badTarget.status).toBe(409);
    expect(badTarget.body.code).toBe("status_move_invalid");

    const ok = await put(admin.token, { statuses: without, moveTo: { [qa.id]: SID.DONE } });
    expect(ok.status).toBe(200);
    expect(ok.body).toHaveLength(3);
    const rows = await prisma.task.findMany({ where: { id: { in: [t1.id, t2.id] } } });
    expect(rows.every((r) => r.statusId === SID.DONE && r.status === "DONE")).toBe(true);
    await prisma.task.deleteMany({ where: { projectId: project.id } });
  });

  it("the last status of a category cannot be deleted, even with moveTo", async () => {
    const { admin, project } = await setup();
    const t = await makeTask(project.id, SID.DONE, "DONE");
    const res = await put(admin.token, { statuses: [BASE[0], BASE[1]], moveTo: { 3: 1 } });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("status_category_empty");
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).statusId).toBe(SID.DONE);
    await prisma.task.delete({ where: { id: t.id } });
  });

  it("moving a status to another category carries its tasks' category along", async () => {
    const { admin, project } = await setup();
    const saved = await put(admin.token, {
      statuses: [BASE[0], BASE[1], { name: "Parked", category: "TODO", color: "gray", isDefault: false }, BASE[2]],
    });
    const parked = saved.body.find((d: { name: string }) => d.name === "Parked");
    const t = await makeTask(project.id, parked.id, "TODO");
    const res = await put(admin.token, {
      statuses: [BASE[0], BASE[1], { id: parked.id, name: "Parked", category: "DONE", color: "gray", isDefault: false }, BASE[2]],
    });
    expect(res.status).toBe(200);
    expect(await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({
      status: "DONE",
      statusId: parked.id,
    });
    await prisma.task.delete({ where: { id: t.id } });
  });

  it("an unused status deletes without moveTo", async () => {
    const { admin } = await setup();
    const saved = await put(admin.token, {
      statuses: [BASE[0], BASE[1], { name: "Spare", category: "DONE", color: "gray", isDefault: false }, BASE[2]],
    });
    expect(saved.body).toHaveLength(4);
    expect((await put(admin.token, { statuses: BASE })).body).toHaveLength(3);
  });
});

describe("payloads", () => {
  it("search hits carry statusDef", async () => {
    const { tam, project } = await setup();
    const title = uniq("StatusDefSearchable");
    await prisma.task.create({ data: { projectId: project.id, title, status: "DONE", statusId: SID.DONE } });
    const res = await request(app).get("/search").set(auth(tam.token)).query({ q: title });
    expect(res.status).toBe(200);
    expect(res.body.tasks[0].statusDef).toMatchObject({ id: SID.DONE, name: "Done", category: "DONE" });
    await prisma.task.deleteMany({ where: { projectId: project.id } });
  });
});

describe("migration: WIP limits re-keyed by status id", () => {
  it("rewrites TODO/IN_PROGRESS/DONE keys to the default status ids and leaves other shapes alone", async () => {
    const sql = readFileSync(
      new URL("../prisma/migrations/20261103120000_task_status_defs/migration.sql", import.meta.url),
      "utf8",
    );
    const update = sql.slice(sql.indexOf('UPDATE "projects" p')).trim();
    expect(update.endsWith(";")).toBe(true);

    const { tam } = await setup();
    const mk = (name: string, wipLimits: unknown) =>
      prisma.project.create({
        data: { name: uniq(name), tamId: tam.userId, wipLimits: wipLimits as object },
      });
    const full = await mk("full", { TODO: 3, IN_PROGRESS: 2, DONE: null });
    const partial = await mk("partial", { IN_PROGRESS: 5 });
    const empty = await mk("empty", {});
    const noLimits = await prisma.project.create({ data: { name: uniq("none"), tamId: tam.userId } });

    // Default ids on this database are 1-3, as in the migration's own seed.
    // Scoped to this test's projects so other files' rows are not rewritten.
    const ids = [full.id, partial.id, empty.id, noLimits.id].join(", ");
    await prisma.$executeRawUnsafe(`${update.slice(0, -1)} AND p."id" IN (${ids});`);
    const get = async (id: number) => (await prisma.project.findUniqueOrThrow({ where: { id } })).wipLimits;
    expect(await get(full.id)).toEqual({ "1": 3, "2": 2, "3": null });
    expect(await get(partial.id)).toEqual({ "2": 5 });
    expect(await get(empty.id)).toEqual({});
    expect(await get(noLimits.id)).toBeNull();
  });
});
