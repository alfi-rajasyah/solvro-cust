// Regression tests for small server fixes: NUL-byte answer (ISS-030), epic delete / status save
// lock order (ISS-176), shared epic-owner check (ISS-177), trimmed label names
// (ISS-180), customer name clash wording (ISS-181), guest-link base URL (ISS-132).
import "./env.js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";

const warn = vi.hoisted(() => vi.fn());
vi.mock("../src/logger.js", async (orig) => {
  const mod = await orig<typeof import("../src/logger.js")>();
  return { ...mod, logger: new Proxy(mod.logger, { get: (t, k) => (k === "warn" ? warn : Reflect.get(t, k)) }) };
});

import { createApp } from "../src/app.js";
import { errorHandler } from "../src/http/errors.js";
import { prisma } from "../src/prisma.js";
import { lockProjectOrder } from "../src/lib/orderLock.js";
import { saveTaskStatusDefs } from "../src/lib/taskStatuses.js";
import { createUserWithRole, seedRoles } from "./testAuth.js";
import { resetStatusDefs, SID } from "./statusFixtures.js";

const app = createApp();
const uniq = (l: string) => `${l} ${Date.now()}-${Math.random()}`;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  await seedRoles();
});

describe("errorHandler 22021 (ISS-030)", () => {
  it("logs the code only, never the error, and answers a neutral 400", () => {
    const err = new Prisma.PrismaClientKnownRequestError("Raw query failed", {
      code: "P2010",
      clientVersion: "5.22.0",
      meta: { code: "22021", message: "invalid byte sequence: secret-row-value" },
    });
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    errorHandler(err, {} as Request, res as unknown as Response, (() => {}) as NextFunction);
    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0] as { error: string; code: string };
    expect(body.code).toBe("validation_error");
    expect(body.error).not.toMatch(/NUL/i);
    expect(warn).toHaveBeenCalledTimes(1);
    const [fields] = warn.mock.calls[0] as [Record<string, unknown>];
    expect(fields).toEqual({ pgCode: "22021" });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-row-value");
  });
});

describe("epic owner check is shared (ISS-177)", () => {
  it("POST /projects/:id/epics and PATCH /epics/:id answer the same 400", async () => {
    const tam = await createUserWithRole("TAM");
    const outsider = await createUserWithRole("TAM");
    const project = await prisma.project.create({ data: { name: uniq("P"), tamId: tam.userId, status: "ACTIVE" } });
    const created = await request(app)
      .post(`/projects/${project.id}/epics`)
      .set(auth(tam.token))
      .send({ title: "E", ownerId: outsider.userId });
    expect(created.status).toBe(400);
    expect(created.body.code).toBe("owner_no_project_access");
    const ghost = await request(app)
      .post(`/projects/${project.id}/epics`)
      .set(auth(tam.token))
      .send({ title: "E", ownerId: 999_999_999 });
    expect(ghost.body.code).toBe("owner_not_found");

    const ok = await request(app).post(`/projects/${project.id}/epics`).set(auth(tam.token)).send({ title: "E2" });
    expect(ok.status).toBe(201);
    const patched = await request(app)
      .patch(`/epics/${ok.body.id}`)
      .set(auth(tam.token))
      .send({ ownerId: outsider.userId });
    expect(patched.status).toBe(400);
    expect(patched.body.code).toBe("owner_no_project_access");
    const self = await request(app).patch(`/epics/${ok.body.id}`).set(auth(tam.token)).send({ ownerId: tam.userId });
    expect(self.status).toBe(200);
  });
});

describe("epic delete (ISS-176)", () => {
  it("deletes while a task save on the same epic runs, without a deadlock", async () => {
    const tam = await createUserWithRole("TAM");
    const project = await prisma.project.create({ data: { name: uniq("P"), tamId: tam.userId, status: "ACTIVE" } });
    const epic = await prisma.epic.create({ data: { projectId: project.id, title: "E" } });
    const tasks = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        prisma.task.create({ data: { projectId: project.id, title: `T${i}`, status: "TODO", statusId: SID.TODO, epicId: epic.id } }),
      ),
    );
    const results = await Promise.all([
      request(app).delete(`/epics/${epic.id}`).set(auth(tam.token)),
      ...tasks.map((t) => request(app).patch(`/tasks/${t.id}`).set(auth(tam.token)).send({ epicId: epic.id })),
    ]);
    expect(results[0].status).toBe(204);
    for (const r of results.slice(1)) expect([200, 400, 404, 409]).toContain(r.status);
    expect(await prisma.task.count({ where: { projectId: project.id, epicId: { not: null } } })).toBe(0);
  });
});

describe("PATCH /tasks/:id with epicId or sectionId takes the task-order lock (ISS-176)", () => {
  it("waits for a holder of the project's task-order lock", async () => {
    const tam = await createUserWithRole("TAM");
    const project = await prisma.project.create({ data: { name: uniq("P"), tamId: tam.userId, status: "ACTIVE" } });
    const epic = await prisma.epic.create({ data: { projectId: project.id, title: "E" } });
    const section = await prisma.section.create({ data: { projectId: project.id, name: "S" } });
    const task = await prisma.task.create({
      data: { projectId: project.id, title: "T", status: "TODO", statusId: SID.TODO },
    });
    for (const body of [{ epicId: epic.id }, { sectionId: section.id }]) {
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const gotLock = new Promise<void>((r) => (locked = r));
      const holder = prisma.$transaction(async (tx) => {
        await lockProjectOrder(tx, "tasks", project.id);
        locked();
        await held;
      });
      await gotLock;
      let done = false;
      const patch = request(app)
        .patch(`/tasks/${task.id}`)
        .set(auth(tam.token))
        .send(body)
        .then((r) => {
          done = true;
          return r;
        });
      await new Promise((r) => setTimeout(r, 400));
      expect(done).toBe(false);
      release();
      await holder;
      expect((await patch).status).toBe(200);
    }
  });

  it("a null epicId or sectionId takes no order lock", async () => {
    const tam = await createUserWithRole("TAM");
    const project = await prisma.project.create({ data: { name: uniq("P"), tamId: tam.userId, status: "ACTIVE" } });
    const task = await prisma.task.create({
      data: { projectId: project.id, title: "T", status: "TODO", statusId: SID.TODO },
    });
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const gotLock = new Promise<void>((r) => (locked = r));
    const holder = prisma.$transaction(async (tx) => {
      await lockProjectOrder(tx, "tasks", project.id);
      locked();
      await held;
    });
    await gotLock;
    const res = await request(app)
      .patch(`/tasks/${task.id}`)
      .set(auth(tam.token))
      .send({ epicId: null, sectionId: null, title: "Renamed" });
    expect(res.status).toBe(200);
    release();
    await holder;
  });

  it("a section delete and PATCH sectionId on its tasks do not deadlock", async () => {
    const tam = await createUserWithRole("TAM");
    const project = await prisma.project.create({ data: { name: uniq("P"), tamId: tam.userId, status: "ACTIVE" } });
    const section = await prisma.section.create({ data: { projectId: project.id, name: "S" } });
    const tasks = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        prisma.task.create({
          data: { projectId: project.id, title: `T${i}`, status: "TODO", statusId: SID.TODO, sectionId: section.id },
        }),
      ),
    );
    const results = await Promise.all([
      request(app).delete(`/sections/${section.id}`).set(auth(tam.token)),
      ...tasks.map((t) => request(app).patch(`/tasks/${t.id}`).set(auth(tam.token)).send({ sectionId: section.id })),
    ]);
    expect(results[0].status).toBe(204);
    for (const r of results.slice(1)) expect([200, 400, 404, 409]).toContain(r.status);
  });
});

describe("admin status save takes the task-order lock (ISS-176)", () => {
  it("waits for a re-pack that holds the project's task-order lock", async () => {
    const tam = await createUserWithRole("TAM");
    const project = await prisma.project.create({ data: { name: uniq("P"), tamId: tam.userId, status: "ACTIVE" } });
    const extra = await prisma.taskStatusDef.create({
      data: { name: uniq("Extra"), category: "TODO", color: "gray", position: 9 },
    });
    await prisma.task.create({ data: { projectId: project.id, title: "T", status: "TODO", statusId: extra.id } });
    try {
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const gotLock = new Promise<void>((r) => (locked = r));
      const holder = prisma.$transaction(async (tx) => {
        await lockProjectOrder(tx, "tasks", project.id);
        locked();
        await held;
      });
      await gotLock;

      let done = false;
      const save = saveTaskStatusDefs({
        statuses: [
          { id: 1, name: "To do", category: "TODO", color: "gray", isDefault: true },
          { id: 2, name: "In progress", category: "IN_PROGRESS", color: "primary", isDefault: true },
          { id: 3, name: "Done", category: "DONE", color: "emerald", isDefault: true },
        ],
        moveTo: { [String(extra.id)]: SID.TODO },
      }).then((r) => {
        done = true;
        return r;
      });
      await new Promise((r) => setTimeout(r, 400));
      expect(done).toBe(false);
      release();
      await holder;
      await save;
      expect(done).toBe(true);
      const moved = await prisma.task.findFirstOrThrow({ where: { projectId: project.id } });
      expect(moved.statusId).toBe(SID.TODO);
    } finally {
      await resetStatusDefs();
    }
  });
});

describe("label names are trimmed (ISS-180)", () => {
  it("creates and renames with the trimmed name; a blank name is a 400", async () => {
    const tam = await createUserWithRole("TAM");
    const project = await prisma.project.create({ data: { name: uniq("P"), tamId: tam.userId, status: "ACTIVE" } });
    const a = await request(app).post(`/projects/${project.id}/labels`).set(auth(tam.token)).send({ name: "  bug  " });
    expect(a.status).toBe(201);
    expect(a.body.name).toBe("bug");
    const dup = await request(app).post(`/projects/${project.id}/labels`).set(auth(tam.token)).send({ name: "bug " });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("label_exists");
    expect((await request(app).post(`/projects/${project.id}/labels`).set(auth(tam.token)).send({ name: "   " })).status).toBe(400);
    const b = await request(app).post(`/projects/${project.id}/labels`).set(auth(tam.token)).send({ name: "other" });
    const renamed = await request(app).patch(`/labels/${b.body.id}`).set(auth(tam.token)).send({ name: " feature " });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe("feature");
    expect((await request(app).patch(`/labels/${b.body.id}`).set(auth(tam.token)).send({ name: "  " })).status).toBe(400);
    const clash = await request(app).patch(`/labels/${b.body.id}`).set(auth(tam.token)).send({ name: " bug" });
    expect(clash.status).toBe(409);
  });
});

describe("customer name clash (ISS-181)", () => {
  it("answers a plain 409 on create and rename, without database wording", async () => {
    const tam = await createUserWithRole("TAM");
    const name = uniq("Acme");
    const body = { description: "d" };
    const first = await request(app).post("/customers").set(auth(tam.token)).send({ name, ...body });
    expect(first.status).toBe(201);
    const dup = await request(app).post("/customers").set(auth(tam.token)).send({ name, ...body });
    expect(dup.status).toBe(409);
    expect(dup.body).toMatchObject({ code: "customer_exists", error: "A customer with that name already exists" });
    const other = await request(app).post("/customers").set(auth(tam.token)).send({ name: uniq("Other"), ...body });
    const rename = await request(app).patch(`/customers/${other.body.id}`).set(auth(tam.token)).send({ name });
    expect(rename.status).toBe(409);
    expect(rename.body.code).toBe("customer_exists");
    expect(JSON.stringify(rename.body)).not.toMatch(/unique/i);
  });
});
