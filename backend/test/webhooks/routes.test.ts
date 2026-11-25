import "../env.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/prisma.js";
import { open } from "../../src/lib/secretBox.js";
import { createUserWithRole, seedRoles } from "../testAuth.js";
import { allowLocalTargets, projectFixture, startReceiver, uniq, type Receiver } from "./helpers.js";

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const PUBLIC_URL = "https://203.0.113.7/hook";
const body = (extra: Record<string, unknown> = {}) => ({
  name: "Ops channel",
  url: PUBLIC_URL,
  format: "STANDARD",
  eventTypes: ["task.created", "comment.created"],
  projectIds: [],
  ...extra,
});

beforeAll(async () => {
  await seedRoles();
});

describe("POST /webhooks", () => {
  it("creates a webhook, returns the secret once and never in reads, and seals it", async () => {
    const tam = await createUserWithRole("TAM");
    const created = await request(app).post("/webhooks").set(auth(tam.token)).send(body());
    expect(created.status).toBe(201);
    expect(created.body.secret).toMatch(/^whsec_[A-Za-z0-9+/]{32}$/);
    expect(created.body.webhook).toMatchObject({
      name: "Ops channel",
      url: PUBLIC_URL,
      format: "STANDARD",
      eventTypes: ["task.created", "comment.created"],
      projectIds: [],
      active: true,
      disabledReason: null,
      consecutiveFailures: 0,
      lastDelivery: null,
    });
    const row = await prisma.webhookSubscription.findUniqueOrThrow({ where: { id: created.body.webhook.id } });
    expect(row.secretEnc).not.toContain(created.body.secret);
    expect(open(row.secretEnc!)).toBe(created.body.secret);

    const list = await request(app).get("/webhooks").set(auth(tam.token));
    expect(list.status).toBe(200);
    expect(list.body.webhooks).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toMatch(/whsec_|secret/i);
  });

  it("gives Google Chat no secret", async () => {
    const tam = await createUserWithRole("TAM");
    const created = await request(app).post("/webhooks").set(auth(tam.token)).send(body({ format: "GOOGLE_CHAT" }));
    expect(created.status).toBe(201);
    expect(created.body.secret).toBeNull();
    expect((await prisma.webhookSubscription.findUniqueOrThrow({ where: { id: created.body.webhook.id } })).secretEnc).toBeNull();
  });

  it("allows 10 webhooks per user and answers 409 webhook_limit on the 11th", async () => {
    const tam = await createUserWithRole("TAM");
    for (let i = 0; i < 10; i++) {
      expect((await request(app).post("/webhooks").set(auth(tam.token)).send(body())).status).toBe(201);
    }
    const over = await request(app).post("/webhooks").set(auth(tam.token)).send(body());
    expect(over.status).toBe(409);
    expect(over.body.code).toBe("webhook_limit");
    // Another user is unaffected.
    const other = await createUserWithRole("TAM");
    expect((await request(app).post("/webhooks").set(auth(other.token)).send(body())).status).toBe(201);
  });

  it("refuses a target that fails the address policy", async () => {
    const tam = await createUserWithRole("TAM");
    for (const url of ["http://203.0.113.7/hook", "https://127.0.0.1/hook", "https://user:pw@203.0.113.7/hook", "https://10.0.0.5/hook"]) {
      const res = await request(app).post("/webhooks").set(auth(tam.token)).send(body({ url }));
      expect(res.status, url).toBe(400);
      expect(res.body.code).toBe("webhook_target_refused");
    }
  });

  it("validates the body", async () => {
    const tam = await createUserWithRole("TAM");
    for (const bad of [
      { name: "  " },
      { name: "x".repeat(81) },
      { eventTypes: [] },
      { eventTypes: ["task.created", "task.created"] },
      { eventTypes: ["note.created"] },
      { format: "SLACK" },
      { projectIds: [0] },
      { projectIds: Array.from({ length: 51 }, (_, i) => i + 1) },
    ]) {
      const res = await request(app).post("/webhooks").set(auth(tam.token)).send(body(bad));
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("answers 400 project_not_found for a project the caller cannot see", async () => {
    const f = await projectFixture();
    const outsider = await createUserWithRole("TAM");
    const hidden = await request(app).post("/webhooks").set(auth(outsider.token)).send(body({ projectIds: [f.project.id] }));
    expect(hidden.status).toBe(400);
    expect(hidden.body.code).toBe("project_not_found");
    const missing = await request(app).post("/webhooks").set(auth(f.owner.token)).send(body({ projectIds: [f.project.id, 99999999] }));
    expect(missing.body.code).toBe("project_not_found");
    const ok = await request(app).post("/webhooks").set(auth(f.owner.token)).send(body({ projectIds: [f.project.id] }));
    expect(ok.status).toBe(201);
    expect(ok.body.webhook.projectIds).toEqual([f.project.id]);
  });

  it("needs webhook:manage: 403 without it, 401 without a session, and admins pass through *", async () => {
    const pending = await createUserWithRole("PENDING");
    expect((await request(app).get("/webhooks").set(auth(pending.token))).status).toBe(403);
    expect((await request(app).post("/webhooks").set(auth(pending.token)).send(body())).status).toBe(403);
    expect((await request(app).get("/webhooks")).status).toBe(401);
    const admin = await createUserWithRole("ADMIN");
    expect((await request(app).get("/webhooks").set(auth(admin.token))).status).toBe(200);
    const stakeholder = await createUserWithRole("STAKEHOLDER");
    expect((await request(app).get("/webhooks").set(auth(stakeholder.token))).status).toBe(200);
  });
});

describe("owner-only access", () => {
  it("answers 404 webhook_not_found for another user's webhook on every route", async () => {
    const owner = await createUserWithRole("TAM");
    const other = await createUserWithRole("TAM");
    const id = (await request(app).post("/webhooks").set(auth(owner.token)).send(body())).body.webhook.id as number;

    const calls = [
      request(app).patch(`/webhooks/${id}`).set(auth(other.token)).send({ name: "mine now" }),
      request(app).delete(`/webhooks/${id}`).set(auth(other.token)),
      request(app).post(`/webhooks/${id}/rotate-secret`).set(auth(other.token)),
      request(app).post(`/webhooks/${id}/test`).set(auth(other.token)),
      request(app).get(`/webhooks/${id}/deliveries`).set(auth(other.token)),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("webhook_not_found");
    }
    expect((await request(app).get("/webhooks").set(auth(other.token))).body.webhooks).toEqual([]);
    expect((await prisma.webhookSubscription.findUniqueOrThrow({ where: { id } })).name).toBe("Ops channel");
    // Not even an admin sees another user's webhook.
    const admin = await createUserWithRole("ADMIN");
    expect((await request(app).delete(`/webhooks/${id}`).set(auth(admin.token))).status).toBe(404);
  });
});

describe("PATCH, rotate, delete", () => {
  it("edits fields, refuses a format change, and resets the failure streak when re-enabled", async () => {
    const tam = await createUserWithRole("TAM");
    const id = (await request(app).post("/webhooks").set(auth(tam.token)).send(body())).body.webhook.id as number;

    const renamed = await request(app).patch(`/webhooks/${id}`).set(auth(tam.token)).send({ name: "Renamed", eventTypes: ["risk.created"] });
    expect(renamed.status).toBe(200);
    expect(renamed.body.webhook).toMatchObject({ name: "Renamed", eventTypes: ["risk.created"] });

    const format = await request(app).patch(`/webhooks/${id}`).set(auth(tam.token)).send({ format: "GOOGLE_CHAT" });
    expect(format.status).toBe(400);
    expect(format.body.code).toBe("format_immutable");

    const badUrl = await request(app).patch(`/webhooks/${id}`).set(auth(tam.token)).send({ url: "http://203.0.113.7/x" });
    expect(badUrl.body.code).toBe("webhook_target_refused");

    await prisma.webhookSubscription.update({
      where: { id },
      data: { active: false, consecutiveFailures: 20, disabledReason: "Turned off after 20 failed deliveries in a row" },
    });
    const enabled = await request(app).patch(`/webhooks/${id}`).set(auth(tam.token)).send({ active: true });
    expect(enabled.body.webhook).toMatchObject({ active: true, consecutiveFailures: 0, disabledReason: null });
    const off = await request(app).patch(`/webhooks/${id}`).set(auth(tam.token)).send({ active: false });
    expect(off.body.webhook).toMatchObject({ active: false, disabledReason: null });
  });

  it("rotates a STANDARD secret (shown once) and refuses it for Google Chat", async () => {
    const tam = await createUserWithRole("TAM");
    const created = await request(app).post("/webhooks").set(auth(tam.token)).send(body());
    const id = created.body.webhook.id as number;
    const rotated = await request(app).post(`/webhooks/${id}/rotate-secret`).set(auth(tam.token));
    expect(rotated.status).toBe(200);
    expect(rotated.body.secret).toMatch(/^whsec_/);
    expect(rotated.body.secret).not.toBe(created.body.secret);
    expect(open((await prisma.webhookSubscription.findUniqueOrThrow({ where: { id } })).secretEnc!)).toBe(rotated.body.secret);

    const chat = (await request(app).post("/webhooks").set(auth(tam.token)).send(body({ format: "GOOGLE_CHAT" }))).body.webhook.id as number;
    const refused = await request(app).post(`/webhooks/${chat}/rotate-secret`).set(auth(tam.token));
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe("no_secret");
  });

  it("deletes with 204 and cascades its deliveries", async () => {
    const f = await projectFixture();
    const id = (await request(app).post("/webhooks").set(auth(f.owner.token)).send(body())).body.webhook.id as number;
    const event = await prisma.activityEvent.create({
      data: { projectId: f.project.id, entityType: "task", entityId: f.task.id, action: "created" },
    });
    await prisma.webhookDelivery.create({ data: { subscriptionId: id, activityEventId: event.id, eventType: "task.created" } });
    expect((await request(app).delete(`/webhooks/${id}`).set(auth(f.owner.token))).status).toBe(204);
    expect(await prisma.webhookDelivery.count({ where: { subscriptionId: id } })).toBe(0);
    expect((await request(app).delete(`/webhooks/${id}`).set(auth(f.owner.token))).status).toBe(404);
  });
});

describe("POST /webhooks/:id/test and GET /webhooks/:id/deliveries", () => {
  let restore: () => void;
  let receiver: Receiver;
  beforeAll(async () => {
    restore = allowLocalTargets();
    receiver = await startReceiver();
  });
  afterAll(async () => {
    restore();
    await receiver.close();
  });

  it("sends one signed webhook.test event now and reports the status code", async () => {
    const tam = await createUserWithRole("TAM");
    const id = (await request(app).post("/webhooks").set(auth(tam.token)).send(body({ url: receiver.url }))).body.webhook.id as number;
    const res = await request(app).post(`/webhooks/${id}/test`).set(auth(tam.token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, statusCode: 200, error: null });
    const got = receiver.received.at(-1)!;
    expect(JSON.parse(got.body)).toMatchObject({ type: "webhook.test", data: { webhook: { id } } });
    expect(got.headers["webhook-signature"]).toMatch(/^v1,/);
    expect(await prisma.webhookDelivery.count({ where: { subscriptionId: id } })).toBe(0);

    receiver.respondWith(500);
    const failed = await request(app).post(`/webhooks/${id}/test`).set(auth(tam.token));
    expect(failed.body).toEqual({ ok: false, statusCode: 500, error: "http_500" });
    receiver.respondWith(200);
  });

  it("lists the last 50 deliveries newest first and reports lastDelivery", async () => {
    const f = await projectFixture();
    const id = (await request(app).post("/webhooks").set(auth(f.owner.token)).send(body())).body.webhook.id as number;
    for (let i = 0; i < 52; i++) {
      const event = await prisma.activityEvent.create({
        data: { projectId: f.project.id, entityType: "task", entityId: f.task.id, action: "created", webhookDispatchedAt: new Date() },
      });
      await prisma.webhookDelivery.create({
        data: { subscriptionId: id, activityEventId: event.id, eventType: "task.created", status: i === 51 ? "FAILED" : "SUCCEEDED", lastStatusCode: i === 51 ? 500 : 200 },
      });
    }
    const res = await request(app).get(`/webhooks/${id}/deliveries`).set(auth(f.owner.token));
    expect(res.status).toBe(200);
    expect(res.body.deliveries).toHaveLength(50);
    expect(res.body.deliveries[0]).toMatchObject({ eventType: "task.created", status: "FAILED", lastStatusCode: 500, nextAttemptAt: null });
    const ids = res.body.deliveries.map((d: { id: number }) => d.id);
    expect([...ids].sort((a, b) => b - a)).toEqual(ids);

    const list = await request(app).get("/webhooks").set(auth(f.owner.token));
    expect(list.body.webhooks[0].lastDelivery).toMatchObject({ status: "FAILED", statusCode: 500 });
    expect(uniq("x")).toBeTruthy();
  });
});
