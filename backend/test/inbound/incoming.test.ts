// POST /webhook/in/:token (docs/archive/plans/webhooks.md, Phase 2): the token
// lookup, both body modes, the optional Standard Webhooks check, dedup, the
// project boundary, the author check and the log masking.
import "../env.js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { pino } from "pino";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/prisma.js";
import { seal } from "../../src/lib/secretBox.js";
import { generateInboundToken } from "../../src/lib/inbound/token.js";
import { signStandardWebhook } from "../../src/lib/webhooks/sign.js";
import { deleteExpiredInboundHookMessages } from "../../src/lib/activityCleanup.js";
import { resetInboundWebhookStateForTests } from "../../src/routes/webhook.js";
import { createUserWithRole, seedRoles } from "../testAuth.js";
import { SID } from "../statusFixtures.js";

const lines: string[] = [];
const app = createApp({ logger: pino({ level: "trace" }, { write: (chunk: string) => void lines.push(chunk) }) });
const APP = "http://localhost:5173"; // APP_URL pinned in test/env.ts
const SECRET = ["whsec", "MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"].join("_");
const uniq = (l: string) => `${l} ${Date.now()}-${Math.random()}`;

async function makeTask(projectId: number, title = uniq("Task")) {
  return prisma.task.create({
    data: { statusId: SID.TODO, projectId, title, status: "TODO", priority: "MEDIUM", position: 0 },
  });
}

async function fixture(opts: { signed?: boolean } = {}) {
  const creator = await createUserWithRole("TAM");
  const project = await prisma.project.create({ data: { name: uniq("Project"), tamId: creator.userId, status: "ACTIVE" } });
  const task = await makeTask(project.id);
  const { token, hash, preview } = generateInboundToken();
  const hook = await prisma.inboundHook.create({
    data: {
      projectId: project.id,
      createdById: creator.userId,
      name: "GitLab",
      tokenHash: hash,
      tokenPreview: preview,
      signingSecretEnc: opts.signed ? seal(SECRET) : null,
    },
  });
  return { creator, project, task, token, hook };
}

const taskUrl = (id: number) => `${APP}/tasks/${id}`;
const post = (token: string) => request(app).post(`/webhook/in/${token}`);
const commentsOf = (taskId: number) => prisma.comment.findMany({ where: { taskId }, orderBy: { id: "asc" } });

function signedHeaders(id: string, body: string, ts = Math.floor(Date.now() / 1000), secret = SECRET) {
  return { "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": signStandardWebhook(secret, id, ts, body) };
}

beforeAll(async () => {
  await seedRoles();
});
beforeEach(() => {
  resetInboundWebhookStateForTests();
  lines.length = 0;
});

describe("link scanner", () => {
  it("reads a GitLab push: first line of the commit message, the commit url as source", async () => {
    const f = await fixture();
    const body = {
      object_kind: "push",
      project: { web_url: "https://gitlab.example.com/acme/app" },
      commits: [
        { id: "a1", message: `Fix the export\n\nCloses ${taskUrl(f.task.id)}`, url: "https://gitlab.example.com/acme/app/-/commit/a1" },
        { id: "b2", message: "Unrelated commit", url: "https://gitlab.example.com/acme/app/-/commit/b2" },
      ],
    };
    const res = await post(f.token).send(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ linked: 1 });
    const comments = await commentsOf(f.task.id);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      body: "Fix the export · https://gitlab.example.com/acme/app/-/commit/a1",
      authorId: f.creator.userId,
      source: "incoming",
      inboundHookId: f.hook.id,
    });
    const activity = await prisma.activityEvent.findMany({ where: { entityType: "comment", entityId: comments[0].id } });
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ action: "created", projectId: f.project.id });
    expect((await prisma.inboundHook.findUniqueOrThrow({ where: { id: f.hook.id } })).lastReceivedAt).not.toBeNull();
  });

  it("reads a GitHub push as JSON and as a form `payload`", async () => {
    const f = await fixture();
    const g = await fixture();
    const payload = (id: number) => ({
      ref: "refs/heads/main",
      commits: [{ id: "c3", message: `Ship it ${taskUrl(id)}`, url: "https://github.com/acme/app/commit/c3" }],
    });
    const json = await post(f.token).send(payload(f.task.id));
    expect(json.body).toEqual({ linked: 1 });
    const form = await post(g.token).type("form").send({ payload: JSON.stringify(payload(g.task.id)) });
    expect(form.status).toBe(200);
    expect(form.body).toEqual({ linked: 1 });
    expect((await commentsOf(g.task.id))[0].body).toBe(`Ship it ${taskUrl(g.task.id)} · https://github.com/acme/app/commit/c3`);
  });

  it("scans text/plain as one string and uses the hash of its first line as the source", async () => {
    const f = await fixture();
    const text = `Deploy 41 finished\nsee ${taskUrl(f.task.id)}`;
    const res = await post(f.token).set("Content-Type", "text/plain").send(text);
    expect(res.body).toEqual({ linked: 1 });
    expect((await commentsOf(f.task.id))[0].body).toBe("Deploy 41 finished");
    // The same text again comments once.
    expect((await post(f.token).set("Content-Type", "text/plain").send(text)).body).toEqual({ linked: 0 });
    expect(await commentsOf(f.task.id)).toHaveLength(1);
  });

  it("answers 200 with linked 0 for a body without a task URL", async () => {
    const f = await fixture();
    const res = await post(f.token).send({ message: "nothing to see", url: "https://x.example.com" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ linked: 0 });
  });

  it("dedups a re-sent delivery per (task, source)", async () => {
    const f = await fixture();
    const body = { commits: [{ message: `Again ${taskUrl(f.task.id)}`, url: "https://git.example.com/c/1" }] };
    expect((await post(f.token).send(body)).body).toEqual({ linked: 1 });
    expect((await post(f.token).send(body)).body).toEqual({ linked: 0 });
    expect(await commentsOf(f.task.id)).toHaveLength(1);
  });

  it("ignores a task of another project", async () => {
    const f = await fixture();
    const other = await fixture();
    const res = await post(f.token).send({ text: `${taskUrl(other.task.id)} and ${taskUrl(f.task.id)}` });
    expect(res.body).toEqual({ linked: 1 });
    expect(await commentsOf(other.task.id)).toHaveLength(0);
    expect(await commentsOf(f.task.id)).toHaveLength(1);
  });

  it("caps one request at 20 tasks", async () => {
    const f = await fixture();
    const tasks = [f.task];
    for (let i = 0; i < 24; i += 1) tasks.push(await makeTask(f.project.id));
    const res = await post(f.token).send({ commits: tasks.map((t, i) => ({ message: `c${i} ${taskUrl(t.id)}`, url: `https://git.example.com/c/${i}` })) });
    expect(res.body).toEqual({ linked: 20 });
    expect(await prisma.comment.count({ where: { inboundHookId: f.hook.id } })).toBe(20);
  });

  it("does not match a look-alike host or a longer id", async () => {
    const f = await fixture();
    const res = await post(f.token).send({ text: `http://localhost:5173.evil.test/tasks/${f.task.id} ${taskUrl(f.task.id)}x` });
    expect(res.body).toEqual({ linked: 0 });
  });

  it("rejects an unsupported media type and malformed JSON", async () => {
    const f = await fixture();
    expect((await post(f.token).set("Content-Type", "application/xml").send("<a/>")).status).toBe(415);
    const bad = await post(f.token).set("Content-Type", "application/json").send("{nope");
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("invalid_json");
  });
});

describe("Solvro JSON", () => {
  it("writes one comment from a task id, with the url as the source", async () => {
    const f = await fixture();
    const res = await post(f.token).send({ solvro: { task: f.task.id, text: "Deployed to prod", url: "https://ci.example.com/run/88" } });
    expect(res.body).toEqual({ linked: 1 });
    expect((await commentsOf(f.task.id))[0]).toMatchObject({ body: "Deployed to prod · https://ci.example.com/run/88", source: "incoming" });
  });

  it("accepts a task URL and answers a bad body with 400 and a reason", async () => {
    const f = await fixture();
    expect((await post(f.token).send({ solvro: { task: taskUrl(f.task.id), text: "Hi" } })).body).toEqual({ linked: 1 });
    for (const solvro of [{ text: "x" }, { task: f.task.id }, { task: f.task.id, text: "x".repeat(2001) }, { task: f.task.id, text: "x", url: "javascript:alert(1)" }, { task: "nope", text: "x" }]) {
      const res = await post(f.token).send({ solvro });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("invalid_solvro_body");
      expect(typeof res.body.error).toBe("string");
    }
  });

  it("writes nothing for a task of another project", async () => {
    const f = await fixture();
    const other = await fixture();
    const res = await post(f.token).send({ solvro: { task: other.task.id, text: "Nope" } });
    expect(res.body).toEqual({ linked: 0 });
    expect(await commentsOf(other.task.id)).toHaveLength(0);
  });
});

describe("token and access", () => {
  it("answers the same 404 for an unknown, inactive and deleted URL", async () => {
    const f = await fixture();
    const dead = await fixture();
    await prisma.inboundHook.update({ where: { id: dead.hook.id }, data: { active: false } });
    const gone = await fixture();
    await prisma.inboundHook.delete({ where: { id: gone.hook.id } });
    const answers = [await post("not-a-real-token").send({}), await post(dead.token).send({}), await post(gone.token).send({})];
    for (const a of answers) expect(a.status).toBe(404);
    expect(new Set(answers.map((a) => JSON.stringify({ ...a.body, path: undefined }))).size).toBe(1);
    expect(f.token).not.toBe(dead.token);
  });

  it("turns the URL off when its creator is deactivated, and writes nothing", async () => {
    const f = await fixture();
    await prisma.user.update({ where: { id: f.creator.userId }, data: { active: false } });
    const res = await post(f.token).send({ solvro: { task: f.task.id, text: "Hello" } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ linked: 0 });
    expect(await commentsOf(f.task.id)).toHaveLength(0);
    const hook = await prisma.inboundHook.findUniqueOrThrow({ where: { id: f.hook.id } });
    expect(hook.active).toBe(false);
    expect(hook.disabledReason).toBe("creator_inactive");
    expect((await post(f.token).send({})).status).toBe(404);
  });

  it("limits a URL to 60 requests a minute", async () => {
    const f = await fixture();
    for (let i = 0; i < 60; i += 1) expect((await post(f.token).send({ i })).status).toBe(200);
    const res = await post(f.token).send({});
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBeDefined();
  });

  it("never writes the token to a log line", async () => {
    const f = await fixture();
    await post(f.token).send({ solvro: { task: f.task.id, text: "logged?" } });
    await post(f.token).set("Content-Type", "application/json").send("{bad");
    await post(f.token).set("Referer", `https://x.example.com/api/webhook/in/${f.token}`).send({});
    const out = lines.join("");
    expect(out).toContain("/webhook/in/[redacted]");
    expect(out).not.toContain(f.token);
  });
});

describe("signed URL", () => {
  const send = (f: { token: string }, body: object, headers: Record<string, string>) => {
    const raw = JSON.stringify(body);
    return post(f.token).set("Content-Type", "application/json").set(headers).send(raw);
  };

  it("accepts a valid signature, among several entries too", async () => {
    const f = await fixture({ signed: true });
    const body = { solvro: { task: f.task.id, text: "Signed" } };
    const raw = JSON.stringify(body);
    const ok = await send(f, body, signedHeaders("msg_1", raw));
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ linked: 1 });
    const h = signedHeaders("msg_2", raw);
    const many = await send(f, body, { ...h, "webhook-signature": `v1,AAAA v2,zzzz ${h["webhook-signature"]}` });
    expect(many.status).toBe(200);
  });

  it("answers 401 for a missing, wrong or stale signature, and writes nothing", async () => {
    const f = await fixture({ signed: true });
    const body = { solvro: { task: f.task.id, text: "Nope" } };
    const raw = JSON.stringify(body);
    expect((await post(f.token).send(body)).status).toBe(401);
    expect((await send(f, body, signedHeaders("m1", raw, undefined, ["whsec", "d3Jvbmc="].join("_")))).status).toBe(401);
    expect((await send(f, body, signedHeaders("m2", raw + " ")) ).status).toBe(401);
    const stale = Math.floor(Date.now() / 1000) - 6 * 60;
    expect((await send(f, body, signedHeaders("m3", raw, stale))).status).toBe(401);
    expect(await commentsOf(f.task.id)).toHaveLength(0);
  });

  it("still needs the path token", async () => {
    const f = await fixture({ signed: true });
    const raw = JSON.stringify({ solvro: { task: f.task.id, text: "x" } });
    const res = await post("wrong-token").set("Content-Type", "application/json").set(signedHeaders("m4", raw)).send(raw);
    expect(res.status).toBe(404);
  });

  it("writes nothing for a webhook-id it has seen, and forgets ids after 24 hours", async () => {
    const f = await fixture({ signed: true });
    const body = { solvro: { task: f.task.id, text: "Once", url: "https://ci.example.com/1" } };
    const raw = JSON.stringify(body);
    expect((await send(f, body, signedHeaders("dup_1", raw))).body).toEqual({ linked: 1 });
    const again = await send(f, body, signedHeaders("dup_1", raw));
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ linked: 0, duplicate: true });
    expect(await commentsOf(f.task.id)).toHaveLength(1);

    await prisma.inboundHookMessage.updateMany({ where: { hookId: f.hook.id }, data: { createdAt: new Date(Date.now() - 25 * 3600 * 1000) } });
    expect(await deleteExpiredInboundHookMessages()).toBeGreaterThanOrEqual(1);
    expect(await prisma.inboundHookMessage.count({ where: { hookId: f.hook.id } })).toBe(0);
  });
});
