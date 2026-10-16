// Outline Phase B, task B2 (docs/archive/plans/outline-integration.md): the
// schema (OutlineMention uniqueness and cascades, OutlineOAuthState purge),
// APP_URL validation, and the admin OAuth-client / webhook-secret settings.
import "./env.js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { open } from "../src/lib/secretBox.js";
import { env } from "../src/env.js";
import {
  appUrlWarning,
  outlineRedirectUri,
  outlineWebhookUrl,
  parseAppUrl,
  resolveAppUrl,
} from "../src/lib/outline/appUrl.js";
import { requireAppUrl } from "../src/lib/outline/requireAppUrl.js";
import { purgeExpiredOutlineStates } from "../src/lib/outline/oauthState.js";
import { createAdminAndToken, createUserWithRole, seedRoles } from "./testAuth.js";

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const uniq = (label: string) => `${label} ${Date.now()}-${Math.random()}`;

beforeAll(async () => {
  await seedRoles();
});

beforeEach(async () => {
  await prisma.outlineConfig.deleteMany();
});

describe("parseAppUrl (APP_URL)", () => {
  it("accepts a bare http(s) origin and normalises it", () => {
    expect(parseAppUrl("https://solvro.acme.com")).toBe("https://solvro.acme.com");
    expect(parseAppUrl(" https://solvro.acme.com/ ")).toBe("https://solvro.acme.com");
    expect(parseAppUrl("http://localhost:5173")).toBe("http://localhost:5173");
    expect(parseAppUrl("HTTPS://Solvro.Acme.com:8443")).toBe("https://solvro.acme.com:8443");
  });

  it("rejects paths, queries, fragments, logins and other schemes", () => {
    for (const bad of [
      "https://solvro.acme.com/app",
      "https://solvro.acme.com/?a=b",
      "https://solvro.acme.com/#x",
      "https://user:pw@solvro.acme.com",
      "ftp://solvro.acme.com",
      "javascript:alert(1)",
      "solvro.acme.com",
      "",
      "*",
      "https://a.com,https://b.com",
    ]) {
      expect(parseAppUrl(bad), bad).toBeNull();
    }
  });

  it("derives the browser-facing redirect and webhook URLs (the /api prefix is stripped by the proxy)", () => {
    expect(outlineRedirectUri("https://solvro.acme.com")).toBe("https://solvro.acme.com/api/outline/oauth/callback");
    expect(outlineWebhookUrl("https://solvro.acme.com")).toBe("https://solvro.acme.com/api/webhook/outline");
  });
});

describe("APP_URL resolution", () => {
  it("defaults to the dev address outside production and stays unset (null) in production", () => {
    expect(resolveAppUrl(undefined, "development")).toBe("http://localhost:5173");
    expect(resolveAppUrl("  ", "test")).toBe("http://localhost:5173");
    expect(resolveAppUrl(undefined, "production")).toBeNull();
    expect(resolveAppUrl("", "production")).toBeNull();
    expect(resolveAppUrl("https://solvro.acme.com/", "production")).toBe("https://solvro.acme.com");
    expect(resolveAppUrl("https://solvro.acme.com/x", "production")).toBeUndefined();
  });

  it("warns for http on a non-loopback host only", () => {
    expect(appUrlWarning("http://solvro.acme.com")).toMatch(/https/);
    expect(appUrlWarning("http://10.0.0.5:5173")).toMatch(/https/);
    expect(appUrlWarning("https://solvro.acme.com")).toBeNull();
    expect(appUrlWarning("http://localhost:5173")).toBeNull();
    expect(appUrlWarning("http://127.0.0.1:5173")).toBeNull();
    expect(appUrlWarning("http://[::1]:5173")).toBeNull();
    expect(appUrlWarning(null)).toBeNull();
  });

  it("requireAppUrl throws 409 outline_app_url_unset when unset", () => {
    const mutable = env as { APP_URL: string | null };
    const saved = mutable.APP_URL;
    try {
      mutable.APP_URL = null;
      expect(() => requireAppUrl()).toThrowError(
        expect.objectContaining({ status: 409, code: "outline_app_url_unset" }),
      );
      mutable.APP_URL = "https://solvro.acme.com";
      expect(requireAppUrl()).toBe("https://solvro.acme.com");
    } finally {
      mutable.APP_URL = saved;
    }
  });
});

describe("OutlineOAuthState purge", () => {
  it("deletes only expired rows and reports the count", async () => {
    const { userId } = await createUserWithRole("TAM");
    const now = new Date();
    const data = (id: string, expiresAt: Date) => ({ id, userId, codeVerifierEnc: "v1:x:y:z", expiresAt });
    await prisma.outlineOAuthState.createMany({
      data: [
        data(`old-${Math.random()}`, new Date(now.getTime() - 60_000)),
        data(`old-${Math.random()}`, new Date(now.getTime() - 1)),
        data(`live-${Math.random()}`, new Date(now.getTime() + 60_000)),
      ],
    });
    expect(await purgeExpiredOutlineStates(now)).toBe(2);
    const left = await prisma.outlineOAuthState.findMany({ where: { userId } });
    expect(left).toHaveLength(1);
    expect(left[0].id.startsWith("live-")).toBe(true);
    expect(await purgeExpiredOutlineStates(now)).toBe(0);
  });

  it("cascades with the user", async () => {
    const { userId } = await createUserWithRole("TAM");
    await prisma.outlineOAuthState.create({
      data: { id: `s-${Math.random()}`, userId, codeVerifierEnc: "v1:x:y:z", expiresAt: new Date(Date.now() + 60_000) },
    });
    await prisma.user.delete({ where: { id: userId } });
    expect(await prisma.outlineOAuthState.count({ where: { userId } })).toBe(0);
  });
});

describe("OutlineMention", () => {
  async function fixture() {
    const tam = await createUserWithRole("TAM");
    const project = await prisma.project.create({
      data: { name: uniq("Proj"), tamId: tam.userId, status: "ACTIVE" },
    });
    const task = await prisma.task.create({ data: { projectId: project.id, title: "T" } });
    const task2 = await prisma.task.create({ data: { projectId: project.id, title: "T2" } });
    return { project, task, task2 };
  }
  const mention = (outlineDocId: string, rest: { projectId?: number | null; taskId?: number | null }) => ({
    outlineDocId,
    docTitle: "Page",
    docPath: "/doc/page-abc",
    ...rest,
  });

  it("rejects a duplicate project-level mention even though task_id is NULL", async () => {
    const { project } = await fixture();
    const doc = uniq("doc");
    await prisma.outlineMention.create({ data: mention(doc, { projectId: project.id }) });
    await expect(prisma.outlineMention.create({ data: mention(doc, { projectId: project.id }) })).rejects.toMatchObject({
      code: "P2002",
    });
    // skipDuplicates (what the webhook upsert uses) really skips it.
    const res = await prisma.outlineMention.createMany({
      data: [mention(doc, { projectId: project.id })],
      skipDuplicates: true,
    });
    expect(res.count).toBe(0);
    expect(await prisma.outlineMention.count({ where: { outlineDocId: doc } })).toBe(1);
  });

  it("rejects a duplicate task-level mention (NULL project_id), but allows other docs/tasks and the project-level row", async () => {
    const { project, task, task2 } = await fixture();
    const doc = uniq("doc");
    await prisma.outlineMention.create({ data: mention(doc, { taskId: task.id }) });
    await expect(prisma.outlineMention.create({ data: mention(doc, { taskId: task.id }) })).rejects.toMatchObject({
      code: "P2002",
    });
    await prisma.outlineMention.create({ data: mention(doc, { taskId: task2.id }) });
    await prisma.outlineMention.create({ data: mention(uniq("other"), { taskId: task.id }) });
    await prisma.outlineMention.create({ data: mention(doc, { projectId: project.id }) });
  });

  it("is EITHER project-level OR task-level: neither and both are refused by the CHECK", async () => {
    const { project, task } = await fixture();
    await expect(prisma.outlineMention.create({ data: mention(uniq("doc"), {}) })).rejects.toThrow(
      /outline_mentions_anchor_check/,
    );
    await expect(
      prisma.outlineMention.create({ data: mention(uniq("doc"), { projectId: project.id, taskId: task.id }) }),
    ).rejects.toThrow(/outline_mentions_anchor_check/);
  });

  it("cascades when the task or the project is deleted", async () => {
    const { project, task, task2 } = await fixture();
    const doc = uniq("doc");
    await prisma.outlineMention.create({ data: mention(doc, { taskId: task.id }) });
    await prisma.outlineMention.create({ data: mention(doc, { taskId: task2.id }) });
    await prisma.outlineMention.create({ data: mention(doc, { projectId: project.id }) });

    await prisma.task.delete({ where: { id: task.id } });
    expect(await prisma.outlineMention.count({ where: { outlineDocId: doc } })).toBe(2);

    // Deleting the project cascades its project-level row and (via the tasks) the task-level ones.
    await prisma.project.delete({ where: { id: project.id } });
    expect(await prisma.outlineMention.count({ where: { outlineDocId: doc } })).toBe(0);
  });

  it("has an index on project_id and task_id", async () => {
    const rows = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'outline_mentions'`;
    const names = rows.map((r) => r.indexname);
    expect(names).toContain("outline_mentions_project_id_idx");
    expect(names).toContain("outline_mentions_task_id_idx");
  });
});

describe("admin Outline settings: OAuth client and webhook secret", () => {
  it("GET returns the new shape with derived URLs and no secrets", async () => {
    const admin = await createAdminAndToken();
    const res = await request(app).get("/admin/settings/outline").set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      baseUrl: null,
      oauthClientId: null,
      oauthClientSecretSet: false,
      webhookSecretSet: false,
      lastWebhookAt: null,
      appUrlConfigured: true,
      appUrlWarning: null,
      redirectUri: `${env.APP_URL}/api/outline/oauth/callback`,
      webhookUrl: `${env.APP_URL}/api/webhook/outline`,
      updatedBy: null,
    });
    expect(env.APP_URL).toBe("http://localhost:5173");
    expect(typeof res.body.updatedAt).toBe("string");
  });

  it("PATCH sets the client id and a write-only secret, sealed in the database", async () => {
    const admin = await createAdminAndToken();
    const saved = await request(app)
      .patch("/admin/settings/outline")
      .set(auth(admin.token))
      .send({ oauthClientId: "  client-123 ", oauthClientSecret: " s3cret-value " });
    expect(saved.status).toBe(200);
    expect(saved.body.oauthClientId).toBe("client-123");
    expect(saved.body.oauthClientSecretSet).toBe(true);
    expect(saved.body.updatedBy).toEqual({ id: admin.userId, username: expect.any(String) });
    expect(JSON.stringify(saved.body)).not.toContain("s3cret-value");

    const read = await request(app).get("/admin/settings/outline").set(auth(admin.token));
    expect(read.body.oauthClientSecretSet).toBe(true);
    expect(JSON.stringify(read.body)).not.toContain("s3cret-value");

    const row = await prisma.outlineConfig.findUniqueOrThrow({ where: { id: "default" } });
    expect(row.oauthClientSecretEnc).not.toBeNull();
    expect(row.oauthClientSecretEnc).not.toContain("s3cret-value");
    expect(row.oauthClientSecretEnc!.startsWith("v1:")).toBe(true);
    expect(open(row.oauthClientSecretEnc!)).toBe("s3cret-value");
  });

  it("PATCH is partial: omitted fields are kept, null clears, baseUrl is unaffected", async () => {
    const admin = await createAdminAndToken();
    await request(app)
      .patch("/admin/settings/outline")
      .set(auth(admin.token))
      .send({ baseUrl: "https://docs.example.com", oauthClientId: "cid", oauthClientSecret: "sec" })
      .expect(200);

    const idOnly = await request(app).patch("/admin/settings/outline").set(auth(admin.token)).send({ oauthClientId: "cid2" });
    expect(idOnly.body).toMatchObject({
      baseUrl: "https://docs.example.com",
      oauthClientId: "cid2",
      oauthClientSecretSet: true,
    });

    const cleared = await request(app)
      .patch("/admin/settings/outline")
      .set(auth(admin.token))
      .send({ oauthClientId: null, oauthClientSecret: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({
      baseUrl: "https://docs.example.com",
      oauthClientId: null,
      oauthClientSecretSet: false,
    });
    const row = await prisma.outlineConfig.findUniqueOrThrow({ where: { id: "default" } });
    expect(row.oauthClientSecretEnc).toBeNull();

    // An empty client id also clears.
    await request(app).patch("/admin/settings/outline").set(auth(admin.token)).send({ oauthClientId: "x" }).expect(200);
    const empty = await request(app).patch("/admin/settings/outline").set(auth(admin.token)).send({ oauthClientId: "" });
    expect(empty.body.oauthClientId).toBeNull();
  });

  it("PATCH rejects an empty body, an empty or non-string secret, and a bad client id", async () => {
    const admin = await createAdminAndToken();
    const send = (body: unknown) => request(app).patch("/admin/settings/outline").set(auth(admin.token)).send(body as object);
    expect((await send({})).status).toBe(400);
    expect((await send({ oauthClientSecret: "" })).status).toBe(400);
    expect((await send({ oauthClientSecret: "   " })).status).toBe(400);
    expect((await send({ oauthClientSecret: 5 })).status).toBe(400);
    expect((await send({ oauthClientId: 5 })).status).toBe(400);
    expect((await send({ oauthClientId: "a".repeat(256) })).status).toBe(400);
    expect((await send({ oauthClientId: "bad\u0001id" })).status).toBe(400);
    // No refused PATCH created or changed the singleton.
    expect(await prisma.outlineConfig.findUnique({ where: { id: "default" } })).toBeNull();
  });

  it("rotate returns a fresh 64-hex secret once, stores it sealed, and replaces the old one", async () => {
    const admin = await createAdminAndToken();
    const first = await request(app).post("/admin/settings/outline/webhook-secret/rotate").set(auth(admin.token));
    expect(first.status).toBe(200);
    expect(first.body.webhookSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(first.headers["cache-control"]).toContain("no-store");

    const row = await prisma.outlineConfig.findUniqueOrThrow({ where: { id: "default" } });
    expect(row.webhookSecretEnc).not.toBeNull();
    expect(row.webhookSecretEnc).not.toContain(first.body.webhookSecret);
    expect(open(row.webhookSecretEnc!)).toBe(first.body.webhookSecret);

    // GET never reveals it — only that one is set.
    const read = await request(app).get("/admin/settings/outline").set(auth(admin.token));
    expect(read.body.webhookSecretSet).toBe(true);
    expect(JSON.stringify(read.body)).not.toContain(first.body.webhookSecret);
    expect(read.body).not.toHaveProperty("webhookSecret");

    const second = await request(app).post("/admin/settings/outline/webhook-secret/rotate").set(auth(admin.token));
    expect(second.body.webhookSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(second.body.webhookSecret).not.toBe(first.body.webhookSecret);
    const after = await prisma.outlineConfig.findUniqueOrThrow({ where: { id: "default" } });
    expect(open(after.webhookSecretEnc!)).toBe(second.body.webhookSecret);
  });

  it("is admin-only: a TAM gets 403 on PATCH and rotate, no token gets 401, and nothing changes", async () => {
    const tam = await createUserWithRole("TAM");
    const patch = await request(app)
      .patch("/admin/settings/outline")
      .set(auth(tam.token))
      .send({ oauthClientId: "x", oauthClientSecret: "y" });
    expect(patch.status).toBe(403);
    expect((await request(app).post("/admin/settings/outline/webhook-secret/rotate").set(auth(tam.token))).status).toBe(403);
    expect((await request(app).post("/admin/settings/outline/webhook-secret/rotate")).status).toBe(401);
    expect(await prisma.outlineConfig.findUnique({ where: { id: "default" } })).toBeNull();
  });
});

describe("User.outlineUserId", () => {
  it("is unique across users (one Outline identity, one Solvro account)", async () => {
    const a = await createUserWithRole("TAM");
    const b = await createUserWithRole("TAM");
    const id = uniq("outline-user");
    await prisma.user.update({ where: { id: a.userId }, data: { outlineUserId: id } });
    await expect(prisma.user.update({ where: { id: b.userId }, data: { outlineUserId: id } })).rejects.toMatchObject({
      code: "P2002",
    });
  });
});

describe("admin Outline settings: unset / warned APP_URL", () => {
  it("GET answers appUrlConfigured false with null URLs when APP_URL is unset, and a warning for http on a public host", async () => {
    const admin = await createAdminAndToken();
    const mutable = env as { APP_URL: string | null };
    const saved = mutable.APP_URL;
    try {
      mutable.APP_URL = null;
      const unset = await request(app).get("/admin/settings/outline").set(auth(admin.token));
      expect(unset.body).toMatchObject({
        appUrlConfigured: false,
        appUrlWarning: null,
        redirectUri: null,
        webhookUrl: null,
      });
      mutable.APP_URL = "http://solvro.acme.com";
      const warned = await request(app).get("/admin/settings/outline").set(auth(admin.token));
      expect(warned.body.appUrlConfigured).toBe(true);
      expect(warned.body.appUrlWarning).toMatch(/https/);
      expect(warned.body.redirectUri).toBe("http://solvro.acme.com/api/outline/oauth/callback");
    } finally {
      mutable.APP_URL = saved;
    }
  });
});

describe("admin Outline settings: audit stamp", () => {
  it("PATCH and rotate move updatedAt/updatedBy; a system write to lastWebhookAt does not", async () => {
    const admin = await createAdminAndToken();
    const patched = await request(app)
      .patch("/admin/settings/outline")
      .set(auth(admin.token))
      .send({ baseUrl: "https://docs.example.com" });
    const first = new Date(patched.body.updatedAt).getTime();
    await new Promise((r) => setTimeout(r, 15));

    await prisma.outlineConfig.update({ where: { id: "default" }, data: { lastWebhookAt: new Date() } });
    const afterWebhook = await prisma.outlineConfig.findUniqueOrThrow({ where: { id: "default" } });
    expect(afterWebhook.updatedAt.getTime()).toBe(first);
    expect(afterWebhook.lastWebhookAt).not.toBeNull();

    await request(app).post("/admin/settings/outline/webhook-secret/rotate").set(auth(admin.token)).expect(200);
    const afterRotate = await prisma.outlineConfig.findUniqueOrThrow({ where: { id: "default" } });
    expect(afterRotate.updatedAt.getTime()).toBeGreaterThan(first);
    expect(afterRotate.updatedById).toBe(admin.userId);
  });
});

describe("admin Outline settings: re-pointing disconnects everyone", () => {
  async function connected() {
    const admin = await createAdminAndToken();
    await request(app)
      .patch("/admin/settings/outline")
      .set(auth(admin.token))
      .send({ baseUrl: "https://docs.example.com", oauthClientId: "cid", oauthClientSecret: "sec" })
      .expect(200);
    const user = await createUserWithRole("TAM");
    await prisma.user.update({
      where: { id: user.userId },
      data: {
        outlineAccessTokenEnc: "v1:a:b:c",
        outlineRefreshTokenEnc: "v1:d:e:f",
        outlineTokenExpiresAt: new Date(Date.now() + 3600_000),
        outlineUserId: uniq("ou"),
        outlineEmail: "someone@example.com",
      },
    });
    await prisma.outlineOAuthState.create({
      data: { id: uniq("st"), userId: user.userId, codeVerifierEnc: "v1:x:y:z", expiresAt: new Date(Date.now() + 60_000) },
    });
    const project = await prisma.project.create({ data: { name: uniq("P"), tamId: user.userId, status: "ACTIVE" } });
    await prisma.outlineMention.create({
      data: { outlineDocId: uniq("d"), docTitle: "T", docPath: "/doc/x", projectId: project.id },
    });
    return { admin, user };
  }
  const state = async (userId: number) => ({
    user: await prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    states: await prisma.outlineOAuthState.count(),
    mentions: await prisma.outlineMention.count(),
  });
  const patch = (token: string, body: object) =>
    request(app).patch("/admin/settings/outline").set(auth(token)).send(body).expect(200);

  it("a changed baseUrl wipes every user's Outline fields, all OAuth states and all mentions", async () => {
    const { admin, user } = await connected();
    await patch(admin.token, { baseUrl: "https://docs.evil.example" });
    const after = await state(user.userId);
    expect(after.user).toMatchObject({
      outlineAccessTokenEnc: null,
      outlineRefreshTokenEnc: null,
      outlineTokenExpiresAt: null,
      outlineUserId: null,
      outlineEmail: null,
    });
    expect(after.states).toBe(0);
    expect(after.mentions).toBe(0);
  });

  it("a changed oauthClientId wipes tokens and states but keeps mentions", async () => {
    const { admin, user } = await connected();
    await patch(admin.token, { oauthClientId: "other-client" });
    const after = await state(user.userId);
    expect(after.user.outlineAccessTokenEnc).toBeNull();
    expect(after.user.outlineEmail).toBeNull();
    expect(after.states).toBe(0);
    expect(after.mentions).toBe(1);
  });

  it("clearing baseUrl or the client id (to null) also counts as a change", async () => {
    const { admin, user } = await connected();
    await patch(admin.token, { oauthClientId: null });
    expect((await state(user.userId)).user.outlineAccessTokenEnc).toBeNull();
    const second = await connected();
    await patch(second.admin.token, { baseUrl: "" });
    const after = await state(second.user.userId);
    expect(after.user.outlineAccessTokenEnc).toBeNull();
    expect(after.mentions).toBe(0);
  });

  it("a same-value re-save (including a trailing slash / padding) keeps everything", async () => {
    const { admin, user } = await connected();
    await patch(admin.token, { baseUrl: " https://docs.example.com/ ", oauthClientId: " cid " });
    const after = await state(user.userId);
    expect(after.user.outlineAccessTokenEnc).toBe("v1:a:b:c");
    expect(after.user.outlineRefreshTokenEnc).toBe("v1:d:e:f");
    expect(after.user.outlineEmail).toBe("someone@example.com");
    expect(after.states).toBe(1);
    expect(after.mentions).toBe(1);
  });

  it("a client-secret-only change keeps everything", async () => {
    const { admin, user } = await connected();
    await patch(admin.token, { oauthClientSecret: "new-secret" });
    const after = await state(user.userId);
    expect(after.user.outlineAccessTokenEnc).toBe("v1:a:b:c");
    expect(after.states).toBe(1);
    expect(after.mentions).toBe(1);
  });
});
