import "../env.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/prisma.js";
import { recordActivity } from "../../src/lib/activity.js";
import { deleteExpiredWebhookDeliveries } from "../../src/lib/activityCleanup.js";
import {
  AUTO_DISABLE_AFTER,
  dispatchActivity,
  MAX_ATTEMPTS,
  RETRY_DELAYS_MS,
  runDispatchOnce,
  sendDueDeliveries,
} from "../../src/lib/webhooks/dispatcher.js";
import { sendRequest, type SendFn } from "../../src/lib/webhooks/sender.js";
import { signStandardWebhook } from "../../src/lib/webhooks/sign.js";
import { createUserWithRole, seedRoles } from "../testAuth.js";
import {
  allowLocalTargets,
  makeSubscription,
  projectFixture,
  SECRET,
  startReceiver,
  stampAllDispatched,
  uniq,
  type Receiver,
} from "./helpers.js";

let restore: () => void;
let receiver: Receiver;

beforeAll(async () => {
  await seedRoles();
  restore = allowLocalTargets();
  receiver = await startReceiver();
});
afterAll(async () => {
  restore();
  await receiver.close();
});
beforeEach(async () => {
  receiver.received.length = 0;
  receiver.respondWith(200);
  await stampAllDispatched();
  await prisma.webhookSubscription.deleteMany(); // cascades its deliveries
});

const failing = (status: number | null, error: string, retryable: boolean): SendFn => async () => ({
  ok: false,
  statusCode: status,
  error,
  retryable,
});
const neverSend: SendFn = async () => {
  throw new Error("must not send");
};

async function taskCreated(f: Awaited<ReturnType<typeof projectFixture>>, changes: Record<string, unknown> | null = null) {
  return recordActivity(prisma, {
    projectId: f.project.id,
    actorId: f.owner.userId,
    entityType: "task",
    entityId: f.task.id,
    entityLabel: f.task.title,
    action: "created",
    changes: changes as never,
  });
}

describe("dispatchActivity", () => {
  it("claims undispatched rows, creates one delivery per matching subscription and stamps the rows", async () => {
    const f = await projectFixture();
    const match = await makeSubscription(f.owner.userId, receiver.url);
    const wrongType = await makeSubscription(f.owner.userId, receiver.url, { eventTypes: ["risk.created"] });
    const wrongProject = await makeSubscription(f.owner.userId, receiver.url, { projectIds: [f.project.id + 999] });
    const rightProject = await makeSubscription(f.owner.userId, receiver.url, { projectIds: [f.project.id] });
    const disabled = await makeSubscription(f.owner.userId, receiver.url, { active: false });
    const event = (await taskCreated(f))!;

    expect(await dispatchActivity()).toBe(1);

    const deliveries = await prisma.webhookDelivery.findMany({ where: { activityEventId: event.id } });
    expect(deliveries.map((d) => d.subscriptionId).sort()).toEqual([match.id, rightProject.id].sort());
    expect(deliveries.every((d) => d.status === "PENDING" && d.eventType === "task.created")).toBe(true);
    expect([wrongType.id, wrongProject.id, disabled.id].some((id) => deliveries.some((d) => d.subscriptionId === id))).toBe(false);
    expect((await prisma.activityEvent.findUniqueOrThrow({ where: { id: event.id } })).webhookDispatchedAt).not.toBeNull();
    // Nothing left to claim.
    expect(await dispatchActivity()).toBe(0);
  });

  it("stamps rows that map to nothing, notes included, and sends nothing", async () => {
    const f = await projectFixture();
    const sub = await makeSubscription(f.owner.userId, receiver.url);
    const note = await recordActivity(prisma, {
      projectId: f.project.id,
      actorId: f.owner.userId,
      entityType: "note",
      entityId: 1,
      action: "created",
      changes: { visibility: "CUSTOMER_FACING" },
    });
    expect(await dispatchActivity()).toBe(1);
    expect(await prisma.webhookDelivery.count({ where: { subscriptionId: sub.id } })).toBe(0);
    expect((await prisma.activityEvent.findUniqueOrThrow({ where: { id: note!.id } })).webhookDispatchedAt).not.toBeNull();
  });

  it("makes one delivery per followed event type: task.created + task.assigned, status_changed + completed", async () => {
    const f = await projectFixture();
    const both = await makeSubscription(f.owner.userId, receiver.url, { eventTypes: ["task.assigned", "task.created", "task.status_changed", "task.completed"] });
    const onlyAssigned = await makeSubscription(f.owner.userId, receiver.url, { eventTypes: ["task.assigned"] });
    const created = (await taskCreated(f, { assignee: { from: null, to: { id: f.other.userId, username: "maya" } } }))!;
    await prisma.task.update({ where: { id: f.task.id }, data: { statusId: 3, status: "DONE" } });
    const moved = (await recordActivity(prisma, {
      projectId: f.project.id,
      actorId: f.owner.userId,
      entityType: "task",
      entityId: f.task.id,
      action: "updated",
      changes: { status: { from: "To do", to: "Done" } },
    }))!;
    await dispatchActivity();
    const typesOf = async (subscriptionId: number, activityEventId: number) =>
      (await prisma.webhookDelivery.findMany({ where: { subscriptionId, activityEventId } })).map((d) => d.eventType).sort();
    expect(await typesOf(both.id, created.id)).toEqual(["task.assigned", "task.created"]);
    expect(await typesOf(both.id, moved.id)).toEqual(["task.completed", "task.status_changed"]);
    expect(await typesOf(onlyAssigned.id, created.id)).toEqual(["task.assigned"]);
    expect(await typesOf(onlyAssigned.id, moved.id)).toEqual([]);
    // Running the claim again creates nothing new.
    expect(await dispatchActivity()).toBe(0);
    expect(await prisma.webhookDelivery.count({ where: { subscriptionId: both.id } })).toBe(4);
  });

  it("task.completed follows the status the row moved to, not the task's status now (two rows, one claim)", async () => {
    const f = await projectFixture();
    const sub = await makeSubscription(f.owner.userId, receiver.url, { eventTypes: ["task.completed"] });
    const row = (to: string) =>
      recordActivity(prisma, {
        projectId: f.project.id,
        actorId: f.owner.userId,
        entityType: "task",
        entityId: f.task.id,
        action: "updated",
        changes: { status: { from: "x", to } },
      });
    const toDone = (await row("Done"))!;
    const toProgress = (await row("In progress"))!;
    const toUnknown = (await row("Renamed away"))!;
    // The task ends on a DONE status; only the row that moved it there counts.
    await prisma.task.update({ where: { id: f.task.id }, data: { statusId: 3, status: "DONE" } });
    await dispatchActivity();
    const deliveries = await prisma.webhookDelivery.findMany({ where: { subscriptionId: sub.id } });
    expect(deliveries.map((d) => [d.activityEventId, d.eventType])).toEqual([[toDone.id, "task.completed"]]);
    expect([toProgress.id, toUnknown.id].some((id) => deliveries.some((d) => d.activityEventId === id))).toBe(false);
  });
});

describe("who may receive (permissions and visibility at claim time)", () => {
  it("creates no delivery for an empty-scope webhook whose owner cannot see the project", async () => {
    const f = await projectFixture();
    const outsider = await createUserWithRole("TAM");
    const hidden = await makeSubscription(outsider.userId, receiver.url); // projectIds [] = every visible project
    const visible = await makeSubscription(f.owner.userId, receiver.url);
    const event = (await taskCreated(f))!;
    await dispatchActivity();
    const rows = await prisma.webhookDelivery.findMany({ where: { activityEventId: event.id } });
    expect(rows.map((d) => d.subscriptionId)).toEqual([visible.id]);
    expect(rows.some((d) => d.subscriptionId === hidden.id)).toBe(false);
  });

  it("creates no delivery for an explicit list that holds a project the owner lost", async () => {
    const f = await projectFixture();
    const sub = await makeSubscription(f.owner.userId, receiver.url, { projectIds: [f.project.id] });
    await prisma.project.update({ where: { id: f.project.id }, data: { tamId: f.other.userId } });
    await taskCreated(f);
    await dispatchActivity();
    expect(await prisma.webhookDelivery.count({ where: { subscriptionId: sub.id } })).toBe(0);
  });

  it("creates no delivery for an owner demoted to PENDING or whose role lost webhook:manage / project:read", async () => {
    const f = await projectFixture();
    const sub = await makeSubscription(f.owner.userId, receiver.url);
    const role = await prisma.role.create({ data: { roleName: uniq("Role"), permissions: ["project:read", "project:view-all", "webhook:manage"] } });
    const custom = await createUserWithRole("TAM");
    await prisma.user.update({ where: { id: custom.userId }, data: { roleId: role.id } });
    const customSub = await makeSubscription(custom.userId, receiver.url);

    await taskCreated(f);
    await dispatchActivity();
    expect(await prisma.webhookDelivery.count({ where: { subscriptionId: customSub.id } })).toBe(1);
    expect(await prisma.webhookDelivery.count({ where: { subscriptionId: sub.id } })).toBe(1);

    const pending = await prisma.role.findUniqueOrThrow({ where: { roleName: "PENDING" } });
    await prisma.user.update({ where: { id: f.owner.userId }, data: { roleId: pending.id } });
    await prisma.role.update({ where: { id: role.id }, data: { permissions: ["project:read", "project:view-all"] } });
    await taskCreated(f);
    await dispatchActivity();
    expect(await prisma.webhookDelivery.count({ where: { subscriptionId: sub.id } })).toBe(1);
    expect(await prisma.webhookDelivery.count({ where: { subscriptionId: customSub.id } })).toBe(1);
    await prisma.role.update({ where: { id: role.id }, data: { permissions: ["webhook:manage", "project:view-all"] } });
    await taskCreated(f);
    await dispatchActivity();
    expect(await prisma.webhookDelivery.count({ where: { subscriptionId: customSub.id } })).toBe(1);
    await prisma.user.update({ where: { id: custom.userId }, data: { roleId: (await prisma.role.findUniqueOrThrow({ where: { roleName: "TAM" } })).id } });
    await prisma.role.delete({ where: { id: role.id } });
    await prisma.user.update({ where: { id: f.owner.userId }, data: { roleId: (await prisma.role.findUniqueOrThrow({ where: { roleName: "TAM" } })).id } });
  });

  it("re-checks at send time: demoted to PENDING, or webhook:manage removed from a custom role, fails owner_no_access without sending", async () => {
    const f = await projectFixture();
    const demoted = await makeSubscription(f.owner.userId, receiver.url, { consecutiveFailures: 2 });
    const role = await prisma.role.create({ data: { roleName: uniq("Role"), permissions: ["project:read", "project:view-all", "webhook:manage"] } });
    const custom = await createUserWithRole("TAM");
    await prisma.user.update({ where: { id: custom.userId }, data: { roleId: role.id } });
    const stripped = await makeSubscription(custom.userId, receiver.url, { consecutiveFailures: 2 });
    await taskCreated(f);
    await dispatchActivity();
    expect(await prisma.webhookDelivery.count({ where: { status: "PENDING" } })).toBe(2);

    const pending = await prisma.role.findUniqueOrThrow({ where: { roleName: "PENDING" } });
    await prisma.user.update({ where: { id: f.owner.userId }, data: { roleId: pending.id } });
    await prisma.role.update({ where: { id: role.id }, data: { permissions: ["project:read", "project:view-all"] } });
    await sendDueDeliveries({ send: neverSend });

    for (const sub of [demoted, stripped]) {
      expect(await prisma.webhookDelivery.findFirstOrThrow({ where: { subscriptionId: sub.id } })).toMatchObject({ status: "FAILED", lastError: "owner_no_access" });
      expect((await prisma.webhookSubscription.findUniqueOrThrow({ where: { id: sub.id } })).consecutiveFailures).toBe(2);
    }
    expect(receiver.received).toHaveLength(0);
    await prisma.user.update({ where: { id: custom.userId }, data: { roleId: (await prisma.role.findUniqueOrThrow({ where: { roleName: "TAM" } })).id } });
    await prisma.role.delete({ where: { id: role.id } });
  });
});

describe("sending", () => {
  it("delivers a signed Standard Webhooks request with an allow-listed payload (no description)", async () => {
    const f = await projectFixture();
    const sub = await makeSubscription(f.owner.userId, receiver.url);
    await taskCreated(f);
    expect(await runDispatchOnce()).toEqual({ claimed: 1, attempted: 1 });

    const delivery = await prisma.webhookDelivery.findFirstOrThrow({ where: { subscriptionId: sub.id } });
    expect(delivery).toMatchObject({ status: "SUCCEEDED", attempts: 1, lastStatusCode: 200, lastError: null });
    expect(receiver.received).toHaveLength(1);
    const { headers, body } = receiver.received[0];
    expect(headers["webhook-id"]).toBe(String(delivery.id));
    expect(headers["webhook-signature"]).toBe(
      signStandardWebhook(SECRET, String(delivery.id), Number(headers["webhook-timestamp"]), body),
    );
    const payload = JSON.parse(body);
    expect(payload.type).toBe("task.created");
    expect(payload.data.task).toMatchObject({ id: f.task.id, title: f.task.title, status: "To do", assignee: null });
    expect(payload.data.project).toMatchObject({ id: f.project.id, url: `http://localhost:5173/projects/${f.project.id}` });
    expect(body).not.toContain("PRIVATE DESCRIPTION TEXT");
    expect(body).not.toContain("description");
    expect(JSON.stringify(payload.data.task)).not.toMatch(/descr/i);
  });

  it("sends the first 500 characters of a comment, never more", async () => {
    const f = await projectFixture();
    const sub = await makeSubscription(f.owner.userId, receiver.url, { eventTypes: ["comment.created"] });
    const comment = await prisma.comment.create({ data: { taskId: f.task.id, authorId: f.other.userId, body: "x".repeat(900) } });
    await recordActivity(prisma, {
      projectId: f.project.id,
      actorId: f.other.userId,
      entityType: "comment",
      entityId: comment.id,
      entityLabel: f.task.title,
      action: "created",
      changes: { taskId: f.task.id },
    });
    await runDispatchOnce();
    expect(await prisma.webhookDelivery.count({ where: { subscriptionId: sub.id, status: "SUCCEEDED" } })).toBe(1);
    const payload = JSON.parse(receiver.received[0].body);
    expect(payload.type).toBe("comment.created");
    expect(payload.data.comment.text).toBe("x".repeat(500));
    expect(payload.data.task.id).toBe(f.task.id);
  });

  it("sends Google Chat as unsigned {text}", async () => {
    const f = await projectFixture();
    await makeSubscription(f.owner.userId, receiver.url, { format: "GOOGLE_CHAT" });
    await taskCreated(f);
    await runDispatchOnce();
    const { headers, body } = receiver.received[0];
    expect(headers["webhook-signature"]).toBeUndefined();
    expect(Object.keys(JSON.parse(body))).toEqual(["text"]);
    expect(JSON.parse(body).text).toContain(f.task.title);
  });

  it("does not follow a redirect and does not retry it", async () => {
    const f = await projectFixture();
    const sub = await makeSubscription(f.owner.userId, receiver.url);
    receiver.respondWith(302, { location: "http://127.0.0.1:1/elsewhere" });
    await taskCreated(f);
    await runDispatchOnce();
    expect(receiver.received).toHaveLength(1);
    expect(await prisma.webhookDelivery.findFirstOrThrow({ where: { subscriptionId: sub.id } })).toMatchObject({
      status: "FAILED",
      lastStatusCode: 302,
      lastError: "http_302",
    });
  });

  it("marks the delivery failed with owner_no_access, without sending, when the owner lost the project", async () => {
    const f = await projectFixture();
    const sub = await makeSubscription(f.owner.userId, receiver.url, { consecutiveFailures: 3 });
    await taskCreated(f);
    await dispatchActivity();
    await prisma.project.update({ where: { id: f.project.id }, data: { tamId: f.other.userId } });
    await sendDueDeliveries({ send: neverSend });
    expect(await prisma.webhookDelivery.findFirstOrThrow({ where: { subscriptionId: sub.id } })).toMatchObject({
      status: "FAILED",
      lastError: "owner_no_access",
    });
    expect(receiver.received).toHaveLength(0);
    // Losing access is not the target's fault: the failure streak is untouched.
    expect((await prisma.webhookSubscription.findUniqueOrThrow({ where: { id: sub.id } })).consecutiveFailures).toBe(3);
  });

  it("fails at once, without sending, when the owner is deactivated", async () => {
    const f = await projectFixture();
    const sub = await makeSubscription(f.owner.userId, receiver.url);
    await taskCreated(f);
    await dispatchActivity();
    await prisma.user.update({ where: { id: f.owner.userId }, data: { active: false } });
    await sendDueDeliveries({ send: neverSend });
    expect((await prisma.webhookDelivery.findFirstOrThrow({ where: { subscriptionId: sub.id } })).lastError).toBe("owner_no_access");
  });
});

describe("retries and auto-disable", () => {
  it("follows the 5 s, 5 min, 30 min, 2 h, 5 h, 10 h schedule, then fails after 7 attempts", async () => {
    expect(RETRY_DELAYS_MS).toEqual([5_000, 300_000, 1_800_000, 7_200_000, 18_000_000, 36_000_000]);
    expect(MAX_ATTEMPTS).toBe(7);
    const f = await projectFixture();
    const sub = await makeSubscription(f.owner.userId, receiver.url);
    await taskCreated(f);
    await dispatchActivity();
    const id = (await prisma.webhookDelivery.findFirstOrThrow({ where: { subscriptionId: sub.id } })).id;
    const send = failing(503, "http_503", true);

    let now = new Date(Date.now() + 1000);
    for (let attempt = 1; attempt <= 6; attempt++) {
      await sendDueDeliveries({ now, send });
      const d = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id } });
      expect(d.status).toBe("PENDING");
      expect(d.attempts).toBe(attempt);
      expect(d.nextAttemptAt.getTime() - now.getTime()).toBe(RETRY_DELAYS_MS[attempt - 1]);
      // Not due a moment earlier.
      expect(await sendDueDeliveries({ now: new Date(d.nextAttemptAt.getTime() - 1), send })).toBe(0);
      now = d.nextAttemptAt;
    }
    await sendDueDeliveries({ now, send });
    expect(await prisma.webhookDelivery.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "FAILED",
      attempts: 7,
      lastStatusCode: 503,
      lastError: "http_503",
    });
    expect((await prisma.webhookSubscription.findUniqueOrThrow({ where: { id: sub.id } })).consecutiveFailures).toBe(1);
  });

  it("retries a 429 and a network error, but fails any other 4xx at once", async () => {
    const f = await projectFixture();
    const sub = await makeSubscription(f.owner.userId, receiver.url);
    for (const [status, error, retryable, expected] of [
      [429, "http_429", true, "PENDING"],
      [null, "connection_failed", true, "PENDING"],
      [404, "http_404", false, "FAILED"],
    ] as const) {
      await prisma.webhookDelivery.deleteMany({ where: { subscriptionId: sub.id } });
      await taskCreated(f);
      await dispatchActivity();
      await sendDueDeliveries({ now: new Date(Date.now() + 1000), send: failing(status, error, retryable) });
      expect((await prisma.webhookDelivery.findFirstOrThrow({ where: { subscriptionId: sub.id } })).status).toBe(expected);
    }
  });

  it("turns the webhook off after 20 failed deliveries in a row, and a success resets the streak", async () => {
    const f = await projectFixture();
    const sub = await makeSubscription(f.owner.userId, receiver.url, { consecutiveFailures: AUTO_DISABLE_AFTER - 1 });
    await taskCreated(f);
    await dispatchActivity();
    await sendDueDeliveries({ send: failing(400, "http_400", false) });
    expect(await prisma.webhookSubscription.findUniqueOrThrow({ where: { id: sub.id } })).toMatchObject({
      active: false,
      consecutiveFailures: AUTO_DISABLE_AFTER,
      disabledReason: expect.stringContaining("20 failed deliveries"),
    });

    const ok = await makeSubscription(f.owner.userId, receiver.url, { consecutiveFailures: 5 });
    await taskCreated(f);
    await dispatchActivity();
    await sendDueDeliveries();
    expect(await prisma.webhookSubscription.findUniqueOrThrow({ where: { id: ok.id } })).toMatchObject({ active: true, consecutiveFailures: 0 });
  });

  it("does not claim a delivery twice", async () => {
    const f = await projectFixture();
    await makeSubscription(f.owner.userId, receiver.url);
    await taskCreated(f);
    await dispatchActivity();
    await Promise.all([sendDueDeliveries(), sendDueDeliveries()]);
    expect(receiver.received).toHaveLength(1);
  });
});

describe("send scheduling", () => {
  async function pendingFor(sub: { id: number }, f: Awaited<ReturnType<typeof projectFixture>>, n: number) {
    for (let i = 0; i < n; i++) {
      const event = await prisma.activityEvent.create({
        data: { projectId: f.project.id, entityType: "task", entityId: f.task.id, action: "created", webhookDispatchedAt: new Date() },
      });
      await prisma.webhookDelivery.create({ data: { subscriptionId: sub.id, activityEventId: event.id, eventType: "task.created" } });
    }
  }
  const ok: Awaited<ReturnType<SendFn>> = { ok: true, statusCode: 200, error: null, retryable: false };

  it("a slow target does not delay another webhook's delivery in the same tick", async () => {
    const f = await projectFixture();
    const slow = await makeSubscription(f.owner.userId, "http://127.0.0.1:9/slow");
    const fast = await makeSubscription(f.owner.userId, "http://127.0.0.1:9/fast");
    await pendingFor(slow, f, 3);
    await pendingFor(fast, f, 1);
    const finished: string[] = [];
    const send: SendFn = async (url) => {
      if (url.endsWith("/slow")) await new Promise((r) => setTimeout(r, 400));
      finished.push(url.endsWith("/slow") ? "slow" : "fast");
      return ok;
    };
    const started = Date.now();
    expect(await sendDueDeliveries({ send })).toBe(4);
    expect(finished[0]).toBe("fast");
    // Run concurrently: three 400 ms sends took well under 3 x 400 ms.
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("sends at most 3 deliveries per webhook per tick", async () => {
    const f = await projectFixture();
    const sub = await makeSubscription(f.owner.userId, "http://127.0.0.1:9/x");
    await pendingFor(sub, f, 5);
    expect(await sendDueDeliveries({ send: async () => ok })).toBe(3);
    expect(await sendDueDeliveries({ send: async () => ok })).toBe(2);
  });

  it("stamps claims and results with the clock at that moment, not the start of the tick", async () => {
    const f = await projectFixture();
    const sub = await makeSubscription(f.owner.userId, "http://127.0.0.1:9/x");
    await pendingFor(sub, f, 1);
    const before = Date.now();
    const send: SendFn = async () => {
      await new Promise((r) => setTimeout(r, 300));
      return { ok: false, statusCode: 503, error: "http_503", retryable: true };
    };
    await sendDueDeliveries({ send });
    const d = await prisma.webhookDelivery.findFirstOrThrow({ where: { subscriptionId: sub.id } });
    // The 5 s retry delay counts from when the attempt finished (>= 300 ms after the tick began).
    expect(d.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(before + 300 + RETRY_DELAYS_MS[0]);
  });
});

describe("sendRequest", () => {
  it("connects to the pinned address whatever the host name says", async () => {
    const port = new URL(receiver.url).port;
    const result = await sendRequest(
      `http://pinned-host.example:${port}/hook`,
      { headers: {}, body: "{}" },
      { allowHttp: true, allowPrivate: true, lookup: async () => [{ address: "127.0.0.1", family: 4 }] },
    );
    expect(result.ok).toBe(true);
    expect(receiver.received).toHaveLength(1);
    expect(receiver.received[0].headers.host).toBe(`pinned-host.example:${port}`);
  });

  it("times out on a hanging receiver and reports it as retryable", async () => {
    const slow = await startReceiver();
    slow.hang();
    const result = await sendRequest(slow.url, { headers: {}, body: "{}" }, { timeoutMs: 150 });
    expect(result).toEqual({ ok: false, statusCode: null, error: "timeout", retryable: true });
    await slow.close();
  });

  it("refuses a private target when the policy says so, without connecting", async () => {
    const result = await sendRequest(receiver.url, { headers: {}, body: "{}" }, { allowPrivate: false, allowHttp: true });
    expect(result).toEqual({ ok: false, statusCode: null, error: "target_private", retryable: false });
    expect(receiver.received).toHaveLength(0);
  });
});

describe("delivery retention", () => {
  it("removes deliveries older than 30 days", async () => {
    const f = await projectFixture();
    const sub = await makeSubscription(f.owner.userId, receiver.url);
    const event = (await taskCreated(f))!;
    const old = await prisma.webhookDelivery.create({
      data: { subscriptionId: sub.id, activityEventId: event.id, eventType: "task.created", createdAt: new Date(Date.now() - 31 * 86400_000) },
    });
    expect(await deleteExpiredWebhookDeliveries()).toBeGreaterThanOrEqual(1);
    expect(await prisma.webhookDelivery.findUnique({ where: { id: old.id } })).toBeNull();
  });
});
