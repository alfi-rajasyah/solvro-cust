// Hardening of the incoming webhook URL (docs/archive/plans/webhooks.md, Phase 2):
// id bounds, author hand-over on rotate/secret/enable, the author's permission,
// the per-project caps, a long webhook-id, and the disabled-reason codes.
import "../env.js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/prisma.js";
import { seal } from "../../src/lib/secretBox.js";
import { generateInboundToken } from "../../src/lib/inbound/token.js";
import { signStandardWebhook } from "../../src/lib/webhooks/sign.js";
import { resetInboundWebhookStateForTests } from "../../src/routes/webhook.js";
import { createUserWithRole, seedRoles } from "../testAuth.js";
import { SID } from "../statusFixtures.js";

const app = createApp();
const APP = "http://localhost:5173";
const SECRET = ["whsec", "MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"].join("_");
const uniq = (l: string) => `${l} ${Date.now()}-${Math.random()}`;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const taskUrl = (id: number) => `${APP}/tasks/${id}`;

const makeTask = (projectId: number) =>
  prisma.task.create({ data: { statusId: SID.TODO, projectId, title: uniq("Task"), status: "TODO", priority: "MEDIUM", position: 0 } });

async function fixture(opts: { signed?: boolean; creatorId?: number } = {}) {
  const tam = await createUserWithRole("TAM");
  const project = await prisma.project.create({ data: { name: uniq("Project"), tamId: tam.userId, status: "ACTIVE" } });
  const task = await makeTask(project.id);
  const { token, hash, preview } = generateInboundToken();
  const hook = await prisma.inboundHook.create({
    data: {
      projectId: project.id,
      createdById: opts.creatorId ?? tam.userId,
      name: "CI",
      tokenHash: hash,
      tokenPreview: preview,
      signingSecretEnc: opts.signed ? seal(SECRET) : null,
    },
  });
  return { tam, project, task, token, hook };
}

const post = (token: string) => request(app).post(`/webhook/in/${token}`);

beforeAll(async () => {
  await seedRoles();
});
beforeEach(() => resetInboundWebhookStateForTests());

describe("Solvro JSON task bounds", () => {
  it("answers 400 for an id above INT4 instead of a 500", async () => {
    const f = await fixture();
    for (const task of [2147483648, 99999999999, "2147483648", 0, -3, 1.5]) {
      const res = await post(f.token).send({ solvro: { task, text: "x" } });
      expect(res.status, String(task)).toBe(400);
      expect(res.body.code).toBe("invalid_solvro_body");
    }
    expect((await post(f.token).send({ solvro: { task: f.task.id, text: "x" } })).status).toBe(200);
  });
});

describe("caps count only the project's own tasks", () => {
  it("comments on the own task even after 25 links to other projects", async () => {
    const f = await fixture();
    const other = await fixture();
    const foreign: number[] = [];
    for (let i = 0; i < 25; i += 1) foreign.push((await makeTask(other.project.id)).id);
    const commits = [
      ...foreign.map((id, i) => ({ message: `f${i} ${taskUrl(id)}`, url: `https://git.example.com/f/${i}` })),
      { message: `mine ${taskUrl(f.task.id)}`, url: "https://git.example.com/mine" },
    ];
    const res = await post(f.token).send({ commits });
    expect(res.body).toEqual({ linked: 1 });
    expect(await prisma.comment.count({ where: { taskId: f.task.id } })).toBe(1);
  });

  it("writes 100 comments (20 tasks x 5 commit messages) in one request", async () => {
    const f = await fixture();
    const tasks = [f.task];
    for (let i = 0; i < 19; i += 1) tasks.push(await makeTask(f.project.id));
    const commits = tasks.flatMap((t, i) =>
      Array.from({ length: 5 }, (_, j) => ({ message: `c${i}-${j} ${taskUrl(t.id)}`, url: `https://git.example.com/c/${i}/${j}` })),
    );
    const res = await post(f.token).send({ commits });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ linked: 100 });
    expect(await prisma.comment.count({ where: { inboundHookId: f.hook.id } })).toBe(100);
  });
});

describe("author checks", () => {
  it("disables a URL whose author lost the task:comment permission, with a code", async () => {
    const role = await prisma.role.create({ data: { roleName: `NOCOMMENT_${Date.now()}`, permissions: ["project:read"] } });
    const author = await createUserWithRole("TAM");
    await prisma.user.update({ where: { id: author.userId }, data: { roleId: role.id } });
    const f = await fixture({ creatorId: author.userId });
    await prisma.projectMember.create({ data: { projectId: f.project.id, userId: author.userId, addedById: f.tam.userId } });
    const res = await post(f.token).send({ solvro: { task: f.task.id, text: "x" } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ linked: 0 });
    expect(await prisma.comment.count({ where: { taskId: f.task.id } })).toBe(0);
    expect(await prisma.inboundHook.findUniqueOrThrow({ where: { id: f.hook.id } })).toMatchObject({
      active: false,
      disabledReason: "creator_lost_permission",
    });
  });

  it("uses creator_lost_access when the author can no longer see the project", async () => {
    const author = await createUserWithRole("TAM");
    const f = await fixture({ creatorId: author.userId });
    const res = await post(f.token).send({ solvro: { task: f.task.id, text: "x" } });
    expect(res.body).toEqual({ linked: 0 });
    expect((await prisma.inboundHook.findUniqueOrThrow({ where: { id: f.hook.id } })).disabledReason).toBe("creator_lost_access");
  });
});

describe("webhook-id length", () => {
  it("answers 400 for an id over 200 characters instead of cutting it", async () => {
    const f = await fixture({ signed: true });
    const raw = JSON.stringify({ solvro: { task: f.task.id, text: "x" } });
    const ts = Math.floor(Date.now() / 1000);
    const send = (id: string) =>
      post(f.token)
        .set("Content-Type", "application/json")
        .set({ "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": signStandardWebhook(SECRET, id, ts, raw) })
        .send(raw);
    const long = await send("m".repeat(201));
    expect(long.status).toBe(400);
    expect(long.body.code).toBe("invalid_webhook_id");
    expect(await prisma.inboundHookMessage.count({ where: { hookId: f.hook.id } })).toBe(0);
    expect((await send("m".repeat(200))).status).toBe(200);
  });
});

describe("a second owner takes over the URL", () => {
  async function twoOwners() {
    const f = await fixture();
    const second = await createUserWithRole("TAM");
    const customer = await prisma.customer.create({ data: { name: uniq("Customer"), description: "d", tamId: second.userId } });
    await prisma.projectCustomer.create({ data: { projectId: f.project.id, customerId: customer.id } });
    return { ...f, second, base: `/projects/${f.project.id}/inbound-hooks/${f.hook.id}` };
  }

  it("makes the caller the author on rotate, signing secret and enable", async () => {
    const f = await twoOwners();
    const rotate = await request(app).post(`${f.base}/rotate-token`).set(auth(f.second.token));
    expect(rotate.status).toBe(200);
    expect((await prisma.inboundHook.findUniqueOrThrow({ where: { id: f.hook.id } })).createdById).toBe(f.second.userId);

    await prisma.inboundHook.update({ where: { id: f.hook.id }, data: { createdById: f.tam.userId } });
    expect((await request(app).post(`${f.base}/signing-secret`).set(auth(f.second.token))).status).toBe(200);
    expect((await prisma.inboundHook.findUniqueOrThrow({ where: { id: f.hook.id } })).createdById).toBe(f.second.userId);
  });

  it("lets a new owner enable a URL turned off for a lost author, and it writes on the next request", async () => {
    const f = await twoOwners();
    await prisma.inboundHook.update({ where: { id: f.hook.id }, data: { createdById: (await createUserWithRole("TAM")).userId } });
    // The stranger author cannot see the project: the first delivery turns the URL off.
    expect((await post(f.token).send({ solvro: { task: f.task.id, text: "first" } })).body).toEqual({ linked: 0 });
    expect((await prisma.inboundHook.findUniqueOrThrow({ where: { id: f.hook.id } })).active).toBe(false);

    const enable = await request(app).patch(f.base).set(auth(f.second.token)).send({ active: true });
    expect(enable.status).toBe(200);
    expect(enable.body.hook).toMatchObject({ active: true, disabledReason: null });
    const next = await post(f.token).send({ solvro: { task: f.task.id, text: "second" } });
    expect(next.body).toEqual({ linked: 1 });
    expect((await prisma.comment.findFirstOrThrow({ where: { taskId: f.task.id } })).authorId).toBe(f.second.userId);
  });
});
