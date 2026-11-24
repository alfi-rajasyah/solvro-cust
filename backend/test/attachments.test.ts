import "./env.js";
import { readdirSync } from "node:fs";
import { mkdir, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { getStorage } from "../src/lib/attachments/storage.js";
import { sweepOrphanAttachments } from "../src/lib/attachments/sweep.js";
import { SID } from "./statusFixtures.js";
import { createUserWithRole, seedRoles } from "./testAuth.js";

const app = createApp();
const dir = process.env.ATTACHMENTS_DIR!;

beforeAll(async () => {
  await seedRoles();
});

async function setup() {
  const owner = await createUserWithRole("TAM");
  const project = await prisma.project.create({
    data: { name: `Att ${Date.now()}-${Math.random()}`, tamId: owner.userId, status: "ACTIVE" },
  });
  const task = await prisma.task.create({ data: { statusId: SID.TODO, status: "TODO", title: "t", projectId: project.id } });
  return { owner, project, task };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

function upload(token: string, taskId: number, name: string, content: Buffer | string) {
  return request(app)
    .post(`/tasks/${taskId}/attachments`)
    .set(auth(token))
    .attach("file", Buffer.from(content), name);
}

// The delete routes remove stored files after answering, in the background.
async function eventually(check: () => Promise<void>) {
  for (let i = 0; ; i++) {
    try {
      return await check();
    } catch (err) {
      if (i >= 40) throw err;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

async function stored(): Promise<string[]> {
  const keys: string[] = [];
  for await (const o of getStorage().list()) keys.push(o.key);
  return keys;
}

describe("attachments", () => {
  it("uploads, lists, downloads and deletes", async () => {
    const { owner, task } = await setup();
    const up = await upload(owner.token, task.id, "Zażółć plan.txt", "hello");
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({
      fileName: "Zażółć plan.txt",
      mimeType: "text/plain; charset=utf-8",
      sizeBytes: 5,
    });
    expect(up.body.uploadedBy).toEqual({ id: owner.userId, name: expect.any(String) });
    expect(up.body).not.toHaveProperty("storageKey");

    const row = await prisma.taskAttachment.findUniqueOrThrow({ where: { id: up.body.id } });
    expect(row.storageKey).toMatch(new RegExp(`^tasks/${task.id}/[0-9a-f-]{36}$`));

    const list = await request(app).get(`/tasks/${task.id}/attachments`).set(auth(owner.token));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(Object.keys(list.body[0]).sort()).toEqual(
      ["createdAt", "fileName", "id", "mimeType", "sizeBytes", "uploadedBy"].sort(),
    );

    const dl = await request(app).get(`/attachments/${up.body.id}`).set(auth(owner.token));
    expect(dl.status).toBe(200);
    expect(dl.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(dl.headers["content-length"]).toBe("5");
    expect(dl.headers["x-content-type-options"]).toBe("nosniff");
    expect(dl.headers["cache-control"]).toBe("private, no-store");
    expect(dl.headers["content-disposition"]).toMatch(/^attachment;/);
    expect(dl.headers["content-disposition"]).toContain("filename*=UTF-8''Za%C5%BC%C3%B3%C5%82%C4%87%20plan.txt");
    expect(dl.text).toBe("hello");

    const del = await request(app).delete(`/attachments/${up.body.id}`).set(auth(owner.token));
    expect(del.status).toBe(204);
    expect(await prisma.taskAttachment.count({ where: { taskId: task.id } })).toBe(0);
    expect(await stored()).not.toContain(row.storageKey);
    expect((await request(app).get(`/attachments/${up.body.id}`).set(auth(owner.token))).status).toBe(404);
  });

  it("lists newest first", async () => {
    const { owner, task } = await setup();
    const a = await upload(owner.token, task.id, "a.txt", "1");
    const b = await upload(owner.token, task.id, "b.txt", "2");
    const list = await request(app).get(`/tasks/${task.id}/attachments`).set(auth(owner.token));
    expect(list.body.map((r: { id: number }) => r.id)).toEqual([b.body.id, a.body.id]);
  });

  it("serves the config in bytes", async () => {
    const { owner } = await setup();
    const res = await request(app).get("/attachments/config").set(auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      maxFileBytes: 1024,
      maxFilesPerTask: 3,
      maxTaskBytes: 2048,
      allowedExtensions: ["png", "pdf", "txt"],
    });
  });

  it("answers 413 for a file over the limit, with the limit in the message", async () => {
    const { owner, task } = await setup();
    const res = await upload(owner.token, task.id, "big.txt", Buffer.alloc(1025, "x"));
    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/Files can be up to/);
    expect(await prisma.taskAttachment.count({ where: { taskId: task.id } })).toBe(0);
  });

  it("answers 404, not 413, for an oversized body sent to a hidden task", async () => {
    const { task } = await setup();
    const stranger = await createUserWithRole("TAM");
    const res = await upload(stranger.token, task.id, "big.txt", Buffer.alloc(5000, "x"));
    expect(res.status).toBe(404);
  });

  it("reads a UTF-8 filename* parameter", async () => {
    const { owner, task } = await setup();
    const boundary = "----solvrotest";
    const body =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename*=UTF-8''%E4%B8%8A.txt\r\n` +
      `Content-Type: text/plain\r\n\r\nhi\r\n--${boundary}--\r\n`;
    const res = await request(app)
      .post(`/tasks/${task.id}/attachments`)
      .set(auth(owner.token))
      .set("Content-Type", `multipart/form-data; boundary=${boundary}`)
      .send(body);
    expect(res.status).toBe(201);
    expect(res.body.fileName).toBe("上.txt");
  });

  it("answers 415 for a type off the allowlist, including a disguised one", async () => {
    const { owner, task } = await setup();
    for (const name of ["run.exe", "page.html", "noext", "a.pdf.exe"]) {
      const res = await upload(owner.token, task.id, name, "x");
      expect(res.status).toBe(415);
      expect(res.body.error).toMatch(/not allowed/);
    }
  });

  it("answers 400 without a file or with a text field", async () => {
    const { owner, task } = await setup();
    const none = await request(app).post(`/tasks/${task.id}/attachments`).set(auth(owner.token));
    expect(none.status).toBe(400);
    const field = await request(app)
      .post(`/tasks/${task.id}/attachments`)
      .set(auth(owner.token))
      .field("x", "y")
      .attach("file", Buffer.from("a"), "a.txt");
    expect(field.status).toBe(400);
  });

  it("answers 409 at the file-count limit", async () => {
    const { owner, task } = await setup();
    for (let i = 0; i < 3; i++) {
      expect((await upload(owner.token, task.id, `f${i}.txt`, "x")).status).toBe(201);
    }
    const res = await upload(owner.token, task.id, "f4.txt", "x");
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/up to 3 files/);
  });

  it("answers 409 at the total-size limit and leaves no stored file", async () => {
    const { owner, task } = await setup();
    const big = Buffer.alloc(1000, "x");
    expect((await upload(owner.token, task.id, "a.txt", big)).status).toBe(201);
    expect((await upload(owner.token, task.id, "b.txt", big)).status).toBe(201);
    const before = (await stored()).length;
    const res = await upload(owner.token, task.id, "c.txt", big);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/total up to/);
    expect((await stored()).length).toBe(before);
  });

  it("holds the count limit under concurrent uploads", async () => {
    const { owner, task } = await setup();
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => upload(owner.token, task.id, `c${i}.txt`, "x")),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    expect(await prisma.taskAttachment.count({ where: { taskId: task.id } })).toBe(3);
  });

  it("leaves no temp file in the OS temp folder after a refused upload", async () => {
    const { owner, task } = await setup();
    const tmp = (await import("node:os")).tmpdir();
    // Only entries this test adds count. The handler removes an accepted
    // upload's temp file after the 201 is sent, so an earlier test's file can
    // still vanish from the folder while this one runs.
    const before = new Set(readdirSync(tmp));
    const added = () => readdirSync(tmp).filter((name) => !before.has(name));
    await upload(owner.token, task.id, "big.txt", Buffer.alloc(1025, "x"));
    for (let i = 0; i < 3; i++) await upload(owner.token, task.id, `k${i}.txt`, "x");
    await upload(owner.token, task.id, "over.txt", "x");
    await expect.poll(added, { timeout: 2000 }).toEqual([]);
  });

  it("answers 404 on every route for a hidden task", async () => {
    const { owner, task } = await setup();
    const own = await upload(owner.token, task.id, "a.txt", "x");
    const stranger = await createUserWithRole("TAM");
    for (const res of [
      await request(app).get(`/tasks/${task.id}/attachments`).set(auth(stranger.token)),
      await upload(stranger.token, task.id, "b.txt", "x"),
      await request(app).get(`/attachments/${own.body.id}`).set(auth(stranger.token)),
      await request(app).delete(`/attachments/${own.body.id}`).set(auth(stranger.token)),
    ]) {
      expect(res.status).toBe(404);
    }
    expect(await prisma.taskAttachment.count({ where: { taskId: task.id } })).toBe(1);
    expect((await request(app).get("/attachments/999999").set(auth(owner.token))).status).toBe(404);
  });

  it("lets a reader list and download but not upload or delete", async () => {
    const { owner, task } = await setup();
    const own = await upload(owner.token, task.id, "a.txt", "x");
    const reader = await createUserWithRole("AUDITOR");
    expect((await request(app).get(`/tasks/${task.id}/attachments`).set(auth(reader.token))).status).toBe(200);
    expect((await request(app).get(`/attachments/${own.body.id}`).set(auth(reader.token))).status).toBe(200);
    expect((await upload(reader.token, task.id, "b.txt", "x")).status).toBe(403);
    expect((await request(app).delete(`/attachments/${own.body.id}`).set(auth(reader.token))).status).toBe(403);
  });

  it("requires a session and rejects a bad id", async () => {
    const { owner } = await setup();
    expect((await request(app).get("/attachments/1")).status).toBe(401);
    expect((await request(app).get("/attachments/abc").set(auth(owner.token))).status).toBe(400);
  });

  it("removes files when a task (and its subtask) is deleted", async () => {
    const { owner, project, task } = await setup();
    const sub = await prisma.task.create({
      data: { statusId: SID.TODO, status: "TODO", title: "s", projectId: project.id, parentTaskId: task.id },
    });
    await upload(owner.token, task.id, "a.txt", "x");
    await upload(owner.token, sub.id, "b.txt", "y");
    const keys = (
      await prisma.taskAttachment.findMany({ where: { taskId: { in: [task.id, sub.id] } } })
    ).map((r) => r.storageKey);
    expect(keys).toHaveLength(2);
    expect(await stored()).toEqual(expect.arrayContaining(keys));

    const res = await request(app).delete(`/tasks/${task.id}`).set(auth(owner.token));
    expect(res.status).toBe(204);
    await eventually(async () => {
      const left = await stored();
      for (const k of keys) expect(left).not.toContain(k);
    });
  });

  it("removes files when a project is deleted", async () => {
    const { owner, project, task } = await setup();
    await upload(owner.token, task.id, "a.txt", "x");
    const key = (await prisma.taskAttachment.findFirstOrThrow({ where: { taskId: task.id } })).storageKey;
    expect(await stored()).toContain(key);
    const res = await request(app).delete(`/projects/${project.id}`).set(auth(owner.token));
    expect(res.status).toBe(204);
    await eventually(async () => expect(await stored()).not.toContain(key));
  });
});

describe("orphan sweep", () => {
  it("deletes an old orphan, keeps a young one and a referenced one", async () => {
    const { owner, task } = await setup();
    const kept = await upload(owner.token, task.id, "ref.txt", "x");
    const refKey = (await prisma.taskAttachment.findUniqueOrThrow({ where: { id: kept.body.id } })).storageKey;

    const old = path.join(dir, "tasks", "0", "old-orphan");
    const young = path.join(dir, "tasks", "0", "young-orphan");
    await mkdir(path.dirname(old), { recursive: true });
    await writeFile(old, "o");
    await writeFile(young, "y");
    const longAgo = new Date(Date.now() - 48 * 3600 * 1000);
    await utimes(old, longAgo, longAgo);
    // The referenced object is old too: only the missing row spares an orphan.
    await utimes(path.join(dir, refKey), longAgo, longAgo);

    const removed = await sweepOrphanAttachments();
    expect(removed).toBeGreaterThanOrEqual(1);
    const left = await stored();
    expect(left).not.toContain("tasks/0/old-orphan");
    expect(left).toContain("tasks/0/young-orphan");
    expect(left).toContain(refKey);
  });
});
