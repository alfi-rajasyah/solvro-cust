// POST /webhook/outline (docs/archive/plans/outline-integration.md, B5): signature
// verification (millisecond timestamps), rate limiting / warn coalescing, which
// events write or remove mentions, link validation against the database, D4 (no
// page text is ever stored or logged) and that a delivery stamps lastWebhookAt
// without moving the admin audit stamp.
import "./env.js";
import crypto from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { pino } from "pino";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { logger } from "../src/logger.js";
import { seal } from "../src/lib/secretBox.js";
import { errorHandler } from "../src/http/errors.js";
import {
  getOutlineWebhookWarnCallsForTests,
  webhookRouter,
  resetOutlineWebhookStateForTests,
} from "../src/routes/webhook.js";
import { createUserWithRole, seedRoles } from "./testAuth.js";

const lines: string[] = [];
const app = createApp({ logger: pino({ level: "trace" }, { write: (chunk: string) => void lines.push(chunk) }) });

const SECRET = "whsec-outline-test-secret";
const APP_ORIGIN = "http://localhost:5173"; // APP_URL pinned in test/env.ts
// Distinctive page text that must never reach the database or a log line.
const PAGE_TEXT_MARKER = "CONFIDENTIAL-PAGE-TEXT-9f3a1c";

function sign(body: string, secret = SECRET, t: number | string = Date.now()): string {
  return `t=${t},s=${crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

function delivery(event: string, model: Record<string, unknown>): string {
  return JSON.stringify({
    id: crypto.randomUUID(),
    actorId: crypto.randomUUID(),
    webhookSubscriptionId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    event,
    payload: { id: model.id, model },
  });
}

function post(body: string, signature?: string) {
  const req = request(app).post("/webhook/outline").set("Content-Type", "application/json");
  return (signature === undefined ? req : req.set("Outline-Signature", signature)).send(body);
}

const signed = (body: string) => post(body, sign(body));

let docCounter = 0;
const newDocId = () => `00000000-0000-4000-8000-${String(++docCounter).padStart(4, "0")}${Date.now().toString(16).slice(-8)}`;

function pageModel(id: string, text: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    urlId: "AbC123",
    title: "Plan page",
    text,
    url: "/doc/plan-page-AbC123",
    publishedAt: new Date().toISOString(),
    archivedAt: null,
    deletedAt: null,
    ...extra,
  };
}

async function fixture() {
  const tam = await createUserWithRole("TAM");
  const project = await prisma.project.create({
    data: { name: `P ${Date.now()}-${Math.random()}`, tamId: tam.userId, status: "ACTIVE" },
  });
  const other = await prisma.project.create({
    data: { name: `Q ${Date.now()}-${Math.random()}`, tamId: tam.userId, status: "ACTIVE" },
  });
  const task = await prisma.task.create({
    data: { projectId: project.id, title: "T", status: "TODO", priority: "MEDIUM", position: 0 },
  });
  const otherTask = await prisma.task.create({
    data: { projectId: other.id, title: "U", status: "TODO", priority: "MEDIUM", position: 0 },
  });
  return { tam, project, other, task, otherTask };
}

const projectLink = (id: number) => `${APP_ORIGIN}/projects/${id}`;
const taskLink = (projectId: number, taskId: number) => `${APP_ORIGIN}/projects/${projectId}?task=${taskId}`;
const mentions = (docId: string) =>
  prisma.outlineMention.findMany({ where: { outlineDocId: docId }, orderBy: { id: "asc" } });

beforeAll(async () => {
  await seedRoles();
});

beforeEach(async () => {
  resetOutlineWebhookStateForTests();
  lines.length = 0;
  await prisma.outlineConfig.deleteMany();
  await prisma.outlineConfig.create({
    data: { id: "default", baseUrl: "https://docs.example.com", webhookSecretEnc: seal(SECRET) },
  });
});

afterEach(() => vi.restoreAllMocks());

describe("signature", () => {
  const body = delivery("documents.update", pageModel("doc-sig", "hello"));

  it("rejects a delivery without the Outline-Signature header (Outline sends none when no secret is set)", async () => {
    const res = await post(body);
    expect(res.status).toBe(401);
  });

  it("rejects when no webhook secret is configured, even with a well-formed signature", async () => {
    await prisma.outlineConfig.update({ where: { id: "default" }, data: { webhookSecretEnc: null } });
    expect((await post(body, sign(body))).status).toBe(401);
    await prisma.outlineConfig.deleteMany();
    expect((await post(body, sign(body))).status).toBe(401);
  });

  it("rejects an undecryptable stored secret the same way", async () => {
    await prisma.outlineConfig.update({ where: { id: "default" }, data: { webhookSecretEnc: "v1:garbage" } });
    expect((await post(body, sign(body))).status).toBe(401);
  });

  it("rejects a wrong secret, a tampered body and a malformed header", async () => {
    expect((await post(body, sign(body, "another-secret"))).status).toBe(401);
    expect((await post(body + " ", sign(body))).status).toBe(401);
    expect((await post(body, "t=abc,s=xyz")).status).toBe(401);
    expect((await post(body, "garbage")).status).toBe(401);
  });

  it("rejects a stale or future timestamp (t is in milliseconds)", async () => {
    expect((await post(body, sign(body, SECRET, Date.now() - 6 * 60_000))).status).toBe(401);
    expect((await post(body, sign(body, SECRET, Date.now() + 6 * 60_000))).status).toBe(401);
    // A seconds-resolution timestamp (the Stripe habit) reads as 1970 in milliseconds.
    expect((await post(body, sign(body, SECRET, Math.floor(Date.now() / 1000)))).status).toBe(401);
  });

  it("accepts a valid millisecond-timestamp signature within the window", async () => {
    expect((await post(body, sign(body, SECRET, Date.now() - 4 * 60_000))).status).toBe(200);
    expect((await signed(body)).status).toBe(200);
  });

  it("a rejected delivery writes nothing and does not stamp lastWebhookAt", async () => {
    const docId = newDocId();
    const { project } = await fixture();
    const b = delivery("documents.update", pageModel(docId, projectLink(project.id)));
    expect((await post(b, sign(b, "another-secret"))).status).toBe(401);
    expect(await mentions(docId)).toHaveLength(0);
    const row = await prisma.outlineConfig.findUniqueOrThrow({ where: { id: "default" } });
    expect(row.lastWebhookAt).toBeNull();
  });
});

describe("rate limiting and warn coalescing", () => {
  it("coalesces rejection warns to one line per window", async () => {
    const body = delivery("documents.update", pageModel("doc-warn", "x"));
    for (let i = 0; i < 5; i++) expect((await post(body, sign(body, "wrong"))).status).toBe(401);
    for (let i = 0; i < 3; i++) expect((await post(body)).status).toBe(401);
    expect(getOutlineWebhookWarnCallsForTests()).toBe(1);
  });

  it("caps every call (valid or not) with the all-calls window before any decrypt", async () => {
    const body = delivery("documents.update", pageModel("doc-flood", "x"));
    const statuses: number[] = [];
    for (let i = 0; i < 305; i++) statuses.push((await post(body)).status);
    expect(statuses.slice(0, 300).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(300)).toEqual([429, 429, 429, 429, 429]);
  });

  it("keys the all-calls window per client IP: one flooding client cannot starve another", async () => {
    // The real app trusts the proxy hops configured by TRUST_PROXY; pin one hop here.
    const proxied = express();
    proxied.set("trust proxy", 1);
    proxied.use("/webhook", webhookRouter);
    proxied.use(errorHandler);
    const body = delivery("documents.update", pageModel("doc-ip", "x"));
    const from = (ip: string, signature?: string) => {
      const req = request(proxied)
        .post("/webhook/outline")
        .set("Content-Type", "application/json")
        .set("X-Forwarded-For", ip);
      return (signature ? req.set("Outline-Signature", signature) : req).send(body);
    };
    for (let i = 0; i < 300; i++) await from("198.51.100.7");
    const flooded = await from("198.51.100.7");
    expect(flooded.status).toBe(429);
    expect(flooded.headers["retry-after"]).toBeDefined();
    // A different client, and the genuine delivery, still get through.
    expect((await from("203.0.113.9")).status).toBe(401);
    expect((await from("203.0.113.9", sign(body))).status).toBe(200);
  });

  it("caps accepted deliveries per minute", async () => {
    const body = delivery("documents.update", pageModel("doc-accepted", "x"));
    const sig = sign(body);
    const statuses: number[] = [];
    for (let i = 0; i < 125; i++) statuses.push((await post(body, sig)).status);
    expect(statuses.slice(0, 120).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(120)).toEqual([429, 429, 429, 429, 429]);
  });
});

describe("writing mentions", () => {
  it("creates a project-level and a task-level row from a published page", async () => {
    const { project, task } = await fixture();
    const docId = newDocId();
    const text = `Kickoff ${projectLink(project.id)} and [the task](${taskLink(project.id, task.id)})`;
    const res = await signed(delivery("documents.publish", pageModel(docId, text)));
    expect(res.status).toBe(200);

    const rows = await mentions(docId);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.taskId === null)).toMatchObject({
      projectId: project.id,
      docTitle: "Plan page",
      docPath: "/doc/plan-page-AbC123",
    });
    expect(rows.find((r) => r.projectId === null)).toMatchObject({ taskId: task.id });
  });

  it("a link added later gets a row; a link removed later loses its row", async () => {
    const { project, other } = await fixture();
    const docId = newDocId();
    await signed(delivery("documents.update", pageModel(docId, projectLink(project.id))));
    expect((await mentions(docId)).map((r) => r.projectId)).toEqual([project.id]);

    await signed(delivery("documents.update", pageModel(docId, `${projectLink(project.id)} ${projectLink(other.id)}`)));
    expect((await mentions(docId)).map((r) => r.projectId).sort()).toEqual([project.id, other.id].sort());

    await signed(delivery("documents.update", pageModel(docId, projectLink(other.id))));
    expect((await mentions(docId)).map((r) => r.projectId)).toEqual([other.id]);

    await signed(delivery("documents.update", pageModel(docId, "no links any more")));
    expect(await mentions(docId)).toHaveLength(0);
  });

  it("repeating the same delivery is idempotent (no duplicate rows, ids kept)", async () => {
    const { project, task } = await fixture();
    const docId = newDocId();
    const body = delivery("documents.update", pageModel(docId, `${projectLink(project.id)} ${taskLink(project.id, task.id)}`));
    await signed(body);
    const first = await mentions(docId);
    await signed(body);
    await signed(body);
    const again = await mentions(docId);
    expect(again.map((r) => r.id)).toEqual(first.map((r) => r.id));
    expect(again).toHaveLength(2);
  });

  it("a retitled page updates the stored title and path on its existing rows", async () => {
    const { project } = await fixture();
    const docId = newDocId();
    await signed(delivery("documents.update", pageModel(docId, projectLink(project.id))));
    await signed(
      delivery("documents.title_change", pageModel(docId, projectLink(project.id), { title: "Renamed", url: "/doc/renamed-AbC123" })),
    );
    const rows = await mentions(docId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ docTitle: "Renamed", docPath: "/doc/renamed-AbC123" });
  });

  it.each(["documents.publish", "documents.update", "documents.title_change", "documents.create", "documents.unarchive"])(
    "%s recomputes the page's mentions",
    async (event) => {
      const { project } = await fixture();
      const docId = newDocId();
      expect((await signed(delivery(event, pageModel(docId, projectLink(project.id))))).status).toBe(200);
      expect(await mentions(docId)).toHaveLength(1);
    },
  );

  it.each(["documents.delete", "documents.archive", "documents.unpublish"])(
    "%s removes the page's mentions",
    async (event) => {
      const { project, task } = await fixture();
      const docId = newDocId();
      await signed(delivery("documents.update", pageModel(docId, `${projectLink(project.id)} ${taskLink(project.id, task.id)}`)));
      expect(await mentions(docId)).toHaveLength(2);
      // The text still holds the links: removal must not depend on it.
      expect(
        (await signed(delivery(event, pageModel(docId, projectLink(project.id), { archivedAt: null })))).status,
      ).toBe(200);
      expect(await mentions(docId)).toHaveLength(0);
    },
  );

  it("a page that is trashed, archived or an unpublished draft has no mentions even on an update event", async () => {
    const { project } = await fixture();
    for (const state of [
      { deletedAt: new Date().toISOString() },
      { archivedAt: new Date().toISOString() },
      { publishedAt: null },
    ]) {
      const docId = newDocId();
      await signed(delivery("documents.update", pageModel(docId, projectLink(project.id))));
      expect(await mentions(docId)).toHaveLength(1);
      await signed(delivery("documents.update", pageModel(docId, projectLink(project.id), state)));
      expect(await mentions(docId)).toHaveLength(0);
    }
  });

  it("a draft created with links writes nothing", async () => {
    const { project } = await fixture();
    const docId = newDocId();
    await signed(delivery("documents.create", pageModel(docId, projectLink(project.id), { publishedAt: null })));
    expect(await mentions(docId)).toHaveLength(0);
  });

  it("only touches the delivered page's rows", async () => {
    const { project } = await fixture();
    const a = newDocId();
    const b = newDocId();
    await signed(delivery("documents.update", pageModel(a, projectLink(project.id))));
    await signed(delivery("documents.update", pageModel(b, projectLink(project.id))));
    await signed(delivery("documents.delete", pageModel(a, "")));
    expect(await mentions(a)).toHaveLength(0);
    expect(await mentions(b)).toHaveLength(1);
  });

  it("ignores other events with a 200 and writes nothing", async () => {
    const { project } = await fixture();
    for (const event of ["documents.restore", "documents.move", "collections.create", "users.signin", "comments.create"]) {
      const docId = newDocId();
      expect((await signed(delivery(event, pageModel(docId, projectLink(project.id))))).status).toBe(200);
      expect(await mentions(docId)).toHaveLength(0);
    }
  });

  it("a verified delivery without a model or id is acknowledged and ignored", async () => {
    const body = JSON.stringify({ event: "documents.update", payload: {} });
    expect((await signed(body)).status).toBe(200);
  });

  it("a verified delivery that is not JSON answers 400 without echoing the body", async () => {
    const body = `{"event": "${PAGE_TEXT_MARKER}"`;
    const res = await signed(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_json");
    expect(JSON.stringify(res.body)).not.toContain(PAGE_TEXT_MARKER);
  });
});

describe("link validation against the database", () => {
  it("ignores a task that belongs to another project, a missing task and a missing project", async () => {
    const { project, task, otherTask } = await fixture();
    const docId = newDocId();
    const text = [
      taskLink(project.id, otherTask.id), // task of ANOTHER project
      taskLink(project.id, 2_000_000_000), // no such task
      projectLink(2_000_000_001), // no such project
      taskLink(2_000_000_002, task.id), // right task, wrong (missing) project
    ].join("\n");
    expect((await signed(delivery("documents.update", pageModel(docId, text)))).status).toBe(200);
    expect(await mentions(docId)).toHaveLength(0);
  });

  it("keeps the valid links when some are invalid, and ignores other origins", async () => {
    const { project, task, otherTask } = await fixture();
    const docId = newDocId();
    const text = [
      taskLink(project.id, task.id),
      taskLink(project.id, otherTask.id),
      `https://evil.example.com/projects/${project.id}`,
    ].join("\n");
    await signed(delivery("documents.update", pageModel(docId, text)));
    const rows = await mentions(docId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ taskId: task.id, projectId: null });
  });

  it("deleting a project or task cascades its mentions away", async () => {
    const { project, task } = await fixture();
    const docId = newDocId();
    await signed(delivery("documents.update", pageModel(docId, `${projectLink(project.id)} ${taskLink(project.id, task.id)}`)));
    await prisma.task.delete({ where: { id: task.id } });
    expect(await mentions(docId)).toHaveLength(1);
    await prisma.project.delete({ where: { id: project.id } });
    expect(await mentions(docId)).toHaveLength(0);
  });

  it("falls back to /doc/<id> when Outline sends no usable url", async () => {
    const { project } = await fixture();
    const docId = newDocId();
    await signed(delivery("documents.update", { ...pageModel(docId, projectLink(project.id)), url: undefined, urlId: undefined }));
    expect((await mentions(docId))[0].docPath).toBe(`/doc/${docId}`);
  });
});

describe("D4: no page text is stored or logged", () => {
  it("stores only ids, title and the relative path - scanned across every stored value", async () => {
    const { project, task } = await fixture();
    const docId = newDocId();
    const text = `${PAGE_TEXT_MARKER} secret roadmap. ${projectLink(project.id)} ${taskLink(project.id, task.id)} more ${PAGE_TEXT_MARKER}`;
    await signed(delivery("documents.update", pageModel(docId, text)));

    const rows = await mentions(docId);
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toContain(PAGE_TEXT_MARKER);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        ["docPath", "docTitle", "id", "outlineDocId", "projectId", "taskId", "updatedAt"].sort(),
      );
      expect(row.docPath.startsWith("/")).toBe(true);
      expect(row.docPath).not.toMatch(/^https?:/);
    }
    // And nowhere else in the config / mention tables.
    const config = await prisma.outlineConfig.findUniqueOrThrow({ where: { id: "default" } });
    expect(JSON.stringify(config)).not.toContain(PAGE_TEXT_MARKER);
  });

  it("never logs the body or the secret, accepted or rejected", async () => {
    const { project } = await fixture();
    const spies = (["trace", "debug", "info", "warn", "error"] as const).map((level) => vi.spyOn(logger, level));
    const accepted = delivery("documents.update", pageModel(newDocId(), `${PAGE_TEXT_MARKER} ${projectLink(project.id)}`));
    const rejected = delivery("documents.update", pageModel(newDocId(), `${PAGE_TEXT_MARKER} rejected`));
    const malformed = `{"event": "${PAGE_TEXT_MARKER}"`;
    expect((await signed(accepted)).status).toBe(200);
    expect((await post(rejected, sign(rejected, "wrong"))).status).toBe(401);
    expect((await post(rejected)).status).toBe(401);
    expect((await signed(malformed)).status).toBe(400);

    const text =
      JSON.stringify(spies.flatMap((s) => s.mock.calls), (_k, v) =>
        v instanceof Error ? { message: v.message, stack: v.stack } : v,
      ) + lines.join("\n");
    expect(text).not.toContain(PAGE_TEXT_MARKER);
    expect(text).not.toContain(SECRET);
  });

  it("never writes the signature to the request log", async () => {
    const body = delivery("documents.update", pageModel(newDocId(), "x"));
    const signature = sign(body);
    expect((await post(body, signature)).status).toBe(200);
    const hex = signature.split("s=")[1];
    expect(lines.join("\n")).not.toContain(hex);
  });
});

describe("lastWebhookAt", () => {
  it("is stamped by a verified delivery without touching updatedAt / updatedById", async () => {
    const admin = await createUserWithRole("ADMIN");
    const stamp = new Date("2026-01-01T00:00:00.000Z");
    await prisma.outlineConfig.update({
      where: { id: "default" },
      data: { updatedAt: stamp, updatedById: admin.userId },
    });
    const before = Date.now();
    expect((await signed(delivery("documents.update", pageModel(newDocId(), "x")))).status).toBe(200);

    const row = await prisma.outlineConfig.findUniqueOrThrow({ where: { id: "default" } });
    expect(row.lastWebhookAt).not.toBeNull();
    expect(row.lastWebhookAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(row.updatedAt.toISOString()).toBe(stamp.toISOString());
    expect(row.updatedById).toBe(admin.userId);
  });

  it("is stamped even for an ignored event", async () => {
    expect((await signed(delivery("collections.create", pageModel(newDocId(), "x")))).status).toBe(200);
    const row = await prisma.outlineConfig.findUniqueOrThrow({ where: { id: "default" } });
    expect(row.lastWebhookAt).not.toBeNull();
  });
});
