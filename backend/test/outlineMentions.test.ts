// GET /tasks/:id/outline-mentions and GET /projects/:id/outline-mentions
// (docs/archive/plans/outline-integration.md, D5 / B5): a title is shown only when
// the VIEWER's own Outline token can open the page (200, not trashed, not
// archived); everything else is a count. Outline itself is faked through the
// doc-info seam; verdicts are cached per user + doc for 5 minutes.
import "./env.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { seal } from "../src/lib/secretBox.js";
import {
  clearDocVisibilityCacheForTests,
  setOutlineDocInfoFetcher,
  VISIBILITY_TTL_MS,
  type OutlineDocInfo,
} from "../src/lib/outline/mentionsAccess.js";
import {
  outlineForbidden,
  outlineNotConnected,
  outlineNotFound,
  outlineRateLimited,
  outlineReconnectRequired,
  outlineUnavailable,
} from "../src/lib/outline/errors.js";
import { createUserWithRole, seedRoles } from "./testAuth.js";

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const BASE = "https://docs.example.com";

type Answer = OutlineDocInfo | Error;
let answers: Map<string, Answer>;
let calls: Array<{ userId: number; docId: string }>;

beforeAll(async () => {
  await seedRoles();
});

beforeEach(async () => {
  clearDocVisibilityCacheForTests();
  answers = new Map();
  calls = [];
  setOutlineDocInfoFetcher(async (userId, docId) => {
    calls.push({ userId, docId });
    const a = answers.get(docId);
    if (a === undefined) return { deletedAt: null, archivedAt: null };
    if (a instanceof Error) throw a;
    return a;
  });
  await prisma.outlineConfig.deleteMany();
  await prisma.outlineConfig.create({ data: { id: "default", baseUrl: `${BASE}/` } });
});

afterEach(() => {
  vi.restoreAllMocks();
  setOutlineDocInfoFetcher(null);
});

let n = 0;
const uniq = (label: string) => `${label} ${Date.now()}-${++n}-${Math.random()}`;

/** A TAM who owns a project with one task, and has connected Outline (unless told not to). */
async function fixture(opts: { connected?: boolean } = {}) {
  const tam = await createUserWithRole("TAM");
  if (opts.connected !== false) await connect(tam.userId);
  const project = await prisma.project.create({ data: { name: uniq("P"), tamId: tam.userId, status: "ACTIVE" } });
  const task = await prisma.task.create({
    data: { projectId: project.id, title: "T", status: "TODO", priority: "MEDIUM", position: 0 },
  });
  return { tam, project, task };
}

async function connect(userId: number) {
  await prisma.user.update({
    where: { id: userId },
    data: { outlineAccessTokenEnc: seal("ol_at_test"), outlineRefreshTokenEnc: seal("ol_rt_test") },
  });
}

async function mention(docId: string, anchor: { projectId?: number; taskId?: number }, title = `Title of ${docId}`) {
  await prisma.outlineMention.create({
    data: {
      outlineDocId: docId,
      docTitle: title,
      docPath: `/doc/${docId}-slug`,
      projectId: anchor.projectId ?? null,
      taskId: anchor.taskId ?? null,
    },
  });
}

const getTask = (id: number, token: string) => request(app).get(`/tasks/${id}/outline-mentions`).set(auth(token));
const getProject = (id: number, token: string) => request(app).get(`/projects/${id}/outline-mentions`).set(auth(token));

describe("visible / hidden / count", () => {
  it("shows a page only when the viewer's token can open it; everything else is a count", async () => {
    const { tam, task } = await fixture();
    for (const id of ["d-open", "d-403", "d-404", "d-trashed", "d-archived"]) await mention(id, { taskId: task.id });
    answers.set("d-403", outlineForbidden());
    answers.set("d-404", outlineNotFound());
    // F7: a trashed doc still answers 200 with deletedAt set.
    answers.set("d-trashed", { deletedAt: new Date().toISOString(), archivedAt: null });
    answers.set("d-archived", { deletedAt: null, archivedAt: new Date().toISOString() });

    const res = await getTask(task.id, tam.token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      connected: true,
      visible: [{ docId: "d-open", title: "Title of d-open", url: `${BASE}/doc/d-open-slug` }],
      hiddenCount: 4,
    });
    // Hidden pages' titles never leave the server.
    const text = JSON.stringify(res.body);
    for (const id of ["d-403", "d-404", "d-trashed", "d-archived"]) expect(text).not.toContain(id);
  });

  it("asks Outline under the VIEWER's id, one call per page", async () => {
    const { tam, task } = await fixture();
    await mention("d-1", { taskId: task.id });
    await mention("d-2", { taskId: task.id });
    await getTask(task.id, tam.token);
    expect(calls.map((c) => c.userId)).toEqual([tam.userId, tam.userId]);
    expect(calls.map((c) => c.docId).sort()).toEqual(["d-1", "d-2"]);
  });

  it("a task with no mentions is an empty connected answer", async () => {
    const { tam, task } = await fixture();
    const res = await getTask(task.id, tam.token);
    expect(res.body).toEqual({ connected: true, visible: [], hiddenCount: 0 });
    expect(calls).toHaveLength(0);
  });

  it("a rate-limited / unreachable Outline fails closed (hidden) and is not remembered", async () => {
    const { tam, task } = await fixture();
    await mention("d-1", { taskId: task.id });
    answers.set("d-1", outlineRateLimited(30));
    const first = await getTask(task.id, tam.token);
    expect(first.body).toEqual({ connected: true, visible: [], hiddenCount: 1 });

    answers.set("d-1", outlineUnavailable());
    expect((await getTask(task.id, tam.token)).body.hiddenCount).toBe(1);

    answers.delete("d-1");
    const recovered = await getTask(task.id, tam.token);
    expect(recovered.body.visible).toHaveLength(1);
    expect(calls).toHaveLength(3);
  });

  it("caps the pages checked per request; the rest count as hidden", async () => {
    const { tam, task } = await fixture();
    await prisma.outlineMention.createMany({
      data: Array.from({ length: 53 }, (_, i) => ({
        outlineDocId: `bulk-${i}`,
        docTitle: `Bulk ${i}`,
        docPath: `/doc/bulk-${i}`,
        taskId: task.id,
      })),
    });
    const res = await getTask(task.id, tam.token);
    expect(calls).toHaveLength(50);
    expect(res.body.visible).toHaveLength(50);
    expect(res.body.hiddenCount).toBe(3);
  });
});

describe("a viewer without a usable Outline connection", () => {
  it("gets only the total - no titles - and Outline is never called", async () => {
    const { tam, task } = await fixture({ connected: false });
    await mention("d-1", { taskId: task.id }, "Secret roadmap");
    await mention("d-2", { taskId: task.id }, "Another page");
    const res = await getTask(task.id, tam.token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false, total: 2 });
    expect(JSON.stringify(res.body)).not.toContain("Secret roadmap");
    expect(calls).toHaveLength(0);
  });

  it("a token Outline refuses (reconnect required) reads as not connected, not as hidden", async () => {
    const { tam, task } = await fixture();
    await mention("d-1", { taskId: task.id });
    answers.set("d-1", outlineReconnectRequired());
    expect((await getTask(task.id, tam.token)).body).toEqual({ connected: false, total: 1 });
    answers.set("d-1", outlineNotConnected());
    clearDocVisibilityCacheForTests();
    expect((await getTask(task.id, tam.token)).body).toEqual({ connected: false, total: 1 });
  });

  it("is not connected while the admin has not set the Outline address", async () => {
    const { tam, task } = await fixture();
    await mention("d-1", { taskId: task.id });
    await prisma.outlineConfig.deleteMany();
    expect((await getTask(task.id, tam.token)).body).toEqual({ connected: false, total: 1 });
    expect(calls).toHaveLength(0);
  });
});

describe("project-level read", () => {
  it("includes project-level and task-level mentions, one entry per page", async () => {
    const { tam, project, task } = await fixture();
    const otherTask = await prisma.task.create({
      data: { projectId: project.id, title: "T2", status: "TODO", priority: "MEDIUM", position: 1 },
    });
    const elsewhere = await prisma.project.create({ data: { name: uniq("Q"), tamId: tam.userId, status: "ACTIVE" } });
    await mention("d-project", { projectId: project.id });
    await mention("d-task", { taskId: task.id });
    await mention("d-both", { projectId: project.id });
    await mention("d-both", { taskId: otherTask.id });
    await mention("d-elsewhere", { projectId: elsewhere.id });

    const res = await getProject(project.id, tam.token);
    expect(res.status).toBe(200);
    expect((res.body.visible as Array<{ docId: string }>).map((d) => d.docId).sort()).toEqual([
      "d-both",
      "d-project",
      "d-task",
    ]);
    expect(res.body.hiddenCount).toBe(0);
    expect(calls.map((c) => c.docId)).not.toContain("d-elsewhere");
  });

  it("the task endpoint returns only that task's own mentions", async () => {
    const { tam, project, task } = await fixture();
    await mention("d-project", { projectId: project.id });
    await mention("d-task", { taskId: task.id });
    const res = await getTask(task.id, tam.token);
    expect((res.body.visible as Array<{ docId: string }>).map((d) => d.docId)).toEqual(["d-task"]);
  });
});

describe("visibility and auth", () => {
  it("404s for a task or project the caller cannot see, before any Outline call", async () => {
    const { project, task } = await fixture();
    await mention("d-1", { taskId: task.id });
    await mention("d-2", { projectId: project.id });
    const stranger = await createUserWithRole("TAM");
    await connect(stranger.userId);

    expect((await getTask(task.id, stranger.token)).status).toBe(404);
    expect((await getProject(project.id, stranger.token)).status).toBe(404);
    expect((await getTask(999_999_999, stranger.token)).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("a project member can read; a view-all auditor can read", async () => {
    const { project, task } = await fixture();
    await mention("d-1", { taskId: task.id });
    const member = await createUserWithRole("TAM");
    await connect(member.userId);
    await prisma.projectMember.create({ data: { projectId: project.id, userId: member.userId } });
    const auditor = await createUserWithRole("AUDITOR");
    await connect(auditor.userId);

    expect((await getTask(task.id, member.token)).body.visible).toHaveLength(1);
    expect((await getProject(project.id, auditor.token)).body.visible).toHaveLength(1);
  });

  it("requires a signed-in user and marks the answer private", async () => {
    const { tam, task, project } = await fixture();
    expect((await request(app).get(`/tasks/${task.id}/outline-mentions`)).status).toBe(401);
    expect((await request(app).get(`/projects/${project.id}/outline-mentions`)).status).toBe(401);
    const res = await getTask(task.id, tam.token);
    expect(res.headers["cache-control"]).toContain("no-store");
  });

  it("rejects a malformed id", async () => {
    const { tam } = await fixture();
    expect((await getTask(0, tam.token)).status).toBe(400);
    expect((await request(app).get("/projects/abc/outline-mentions").set(auth(tam.token))).status).toBe(400);
  });
});

describe("per-user visibility cache (5 minutes)", () => {
  it("answers a repeat read from the cache, per user and doc", async () => {
    const { tam, project, task } = await fixture();
    await mention("d-1", { taskId: task.id });
    await getTask(task.id, tam.token);
    await getTask(task.id, tam.token);
    await getProject(project.id, tam.token);
    expect(calls).toHaveLength(1);

    // Another viewer has their own verdict.
    const member = await createUserWithRole("TAM");
    await connect(member.userId);
    await prisma.projectMember.create({ data: { projectId: project.id, userId: member.userId } });
    await getTask(task.id, member.token);
    expect(calls).toHaveLength(2);
    expect(calls[1].userId).toBe(member.userId);
  });

  it("remembers a hidden verdict too, then re-asks after the TTL", async () => {
    const { tam, task } = await fixture();
    await mention("d-1", { taskId: task.id });
    answers.set("d-1", outlineForbidden());
    expect((await getTask(task.id, tam.token)).body.hiddenCount).toBe(1);

    // The viewer is granted access in Outline: still hidden until the cache expires.
    answers.delete("d-1");
    expect((await getTask(task.id, tam.token)).body.hiddenCount).toBe(1);
    expect(calls).toHaveLength(1);

    const real = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(real + VISIBILITY_TTL_MS + 1000);
    const later = await getTask(task.id, tam.token);
    expect(later.body.visible).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });
});
