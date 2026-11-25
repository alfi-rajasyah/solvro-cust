// Outgoing webhook dispatcher (docs/archive/plans/webhooks.md). Reads the
// activity log, which every write already records in its own transaction, so
// no write path knows about webhooks. Two steps per tick:
//   1. claim up to 100 undispatched activity rows (FOR UPDATE SKIP LOCKED, so
//      more than one backend instance never claims the same row), map them to
//      event types, create one pending delivery per matching active
//      subscription and stamp the rows, all in one transaction;
//   2. send the pending deliveries that are due, each after checking that the
//      owner can still see the project.
// Same lifecycle as lib/activityCleanup.ts: started once from src/index.ts,
// unref'd timer, off under NODE_ENV=test.
import type { Prisma } from "@prisma/client";
import { env } from "../../env.js";
import { logger } from "../../logger.js";
import { prisma } from "../../prisma.js";
import { filterActiveUsersWhoCanSeeProject } from "../notifications.js";
import { mapActivityToEvents, needsTaskCategory } from "./events.js";
import type { WebhookEventType } from "./eventTypes.js";
import { buildPayload } from "./payload.js";
import { prepareRequest, sendRequest, type SendFn } from "./sender.js";
import { hostForLog } from "./validateTarget.js";

export const TICK_MS = 5_000;
export const CLAIM_BATCH = 100;
const SEND_BATCH = 50;
/** A claimed delivery that never reports back (a crash mid-send) is retried after this. */
const LEASE_MS = 2 * 60_000;
export const AUTO_DISABLE_AFTER = 20;
/** Wait before attempt 2, 3, ... 7; a seventh failure ends the delivery. */
export const RETRY_DELAYS_MS = [5_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 5 * 3600_000, 10 * 3600_000];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

let started = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;

/** Step 1. Returns how many activity rows were claimed (0 = nothing waiting). */
export async function dispatchActivity(): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.$queryRaw<{ id: number }[]>`
      SELECT id FROM activity_events
      WHERE webhook_dispatched_at IS NULL
      ORDER BY id
      LIMIT ${CLAIM_BATCH}
      FOR UPDATE SKIP LOCKED`;
    if (claimed.length === 0) return 0;
    const ids = claimed.map((r) => r.id);
    const rows = await tx.activityEvent.findMany({
      where: { id: { in: ids } },
      orderBy: { id: "asc" },
      select: { id: true, projectId: true, entityType: true, entityId: true, action: true, changes: true },
    });
    const subs = await tx.webhookSubscription.findMany({
      where: { active: true },
      select: { id: true, eventTypes: true, projectIds: true },
    });

    // The task's current status category, for rows that changed a status.
    const doneTaskIds = new Set<number>();
    const taskIds = rows.filter(needsTaskCategory).map((r) => r.entityId);
    if (taskIds.length > 0) {
      const done = await tx.task.findMany({ where: { id: { in: taskIds }, status: "DONE" }, select: { id: true } });
      for (const t of done) doneTaskIds.add(t.id);
    }

    const deliveries: Prisma.WebhookDeliveryCreateManyInput[] = [];
    for (const row of rows) {
      const events = mapActivityToEvents(row, doneTaskIds.has(row.entityId));
      if (events.length === 0) continue;
      for (const sub of subs) {
        if (sub.projectIds.length > 0 && !sub.projectIds.includes(row.projectId)) continue;
        // One delivery per matching event type: a webhook that follows both
        // `task.created` and `task.assigned` gets both messages.
        for (const type of events) {
          if (sub.eventTypes.includes(type)) deliveries.push({ subscriptionId: sub.id, activityEventId: row.id, eventType: type });
        }
      }
    }
    if (deliveries.length > 0) await tx.webhookDelivery.createMany({ data: deliveries, skipDuplicates: true });
    await tx.activityEvent.updateMany({ where: { id: { in: ids } }, data: { webhookDispatchedAt: new Date() } });
    return ids.length;
  });
}

async function failFinally(deliveryId: number, subscriptionId: number, now: Date, patch: Prisma.WebhookDeliveryUpdateInput, countsTowardDisable: boolean) {
  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    // `nextAttemptAt` doubles as "finished at" once a delivery leaves PENDING.
    data: { status: "FAILED", nextAttemptAt: now, ...patch },
  });
  if (!countsTowardDisable) return;
  const sub = await prisma.webhookSubscription.update({
    where: { id: subscriptionId },
    data: { consecutiveFailures: { increment: 1 } },
    select: { consecutiveFailures: true, active: true },
  });
  if (sub.active && sub.consecutiveFailures >= AUTO_DISABLE_AFTER) {
    await prisma.webhookSubscription.update({
      where: { id: subscriptionId },
      data: { active: false, disabledReason: `Turned off after ${AUTO_DISABLE_AFTER} failed deliveries in a row` },
    });
    logger.warn({ subscriptionId }, "Webhook turned off after repeated failures");
  }
}

/** Step 2. Sends every due pending delivery; returns how many were attempted. */
export async function sendDueDeliveries(opts: { now?: Date; send?: SendFn } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const send = opts.send ?? sendRequest;
  const due = await prisma.webhookDelivery.findMany({
    where: { status: "PENDING", nextAttemptAt: { lte: now } },
    orderBy: { id: "asc" },
    take: SEND_BATCH,
    select: { id: true },
  });
  let attempted = 0;
  for (const { id } of due) {
    // Claim by pushing nextAttemptAt out: a second instance's identical
    // updateMany then matches nothing.
    const claim = await prisma.webhookDelivery.updateMany({
      where: { id, status: "PENDING", nextAttemptAt: { lte: now } },
      data: { nextAttemptAt: new Date(now.getTime() + LEASE_MS) },
    });
    if (claim.count !== 1) continue;
    attempted += 1;
    try {
      await attemptDelivery(id, now, send);
    } catch (err) {
      logger.warn({ deliveryId: id, err: err instanceof Error ? err.message : String(err) }, "Webhook delivery attempt crashed");
    }
  }
  return attempted;
}

async function attemptDelivery(id: number, now: Date, send: SendFn): Promise<void> {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id },
    include: {
      subscription: true,
      activityEvent: {
        select: {
          id: true,
          projectId: true,
          entityType: true,
          entityId: true,
          entityLabel: true,
          changes: true,
          createdAt: true,
          actor: { select: { username: true } },
        },
      },
    },
  });
  if (!delivery || delivery.status !== "PENDING") return;
  const { subscription: sub, activityEvent: event } = delivery;

  if (!sub.active) {
    await failFinally(id, sub.id, now, { lastError: "webhook_disabled" }, false);
    return;
  }
  const canSee = await filterActiveUsersWhoCanSeeProject(prisma, event.projectId, [sub.ownerId]);
  if (!canSee.has(sub.ownerId)) {
    await failFinally(id, sub.id, now, { lastError: "owner_no_access" }, false);
    return;
  }

  let result;
  try {
    const payload = await buildPayload(prisma, event, delivery.eventType as WebhookEventType);
    const request = prepareRequest(sub, String(delivery.id), payload);
    result = await send(sub.url, request);
  } catch (err) {
    logger.warn({ deliveryId: id, err: err instanceof Error ? err.message : String(err) }, "Webhook request could not be prepared");
    result = { ok: false, statusCode: null, error: "internal_error", retryable: false };
  }

  const attempts = delivery.attempts + 1;
  if (result.ok) {
    await prisma.webhookDelivery.update({
      where: { id },
      data: { status: "SUCCEEDED", attempts, nextAttemptAt: now, lastStatusCode: result.statusCode, lastError: null },
    });
    if (sub.consecutiveFailures > 0) {
      await prisma.webhookSubscription.update({ where: { id: sub.id }, data: { consecutiveFailures: 0 } });
    }
    return;
  }
  logger.info({ deliveryId: id, host: hostForLog(sub.url), error: result.error, statusCode: result.statusCode, attempts }, "Webhook delivery failed");
  if (result.retryable && attempts < MAX_ATTEMPTS) {
    await prisma.webhookDelivery.update({
      where: { id },
      data: {
        attempts,
        nextAttemptAt: new Date(now.getTime() + RETRY_DELAYS_MS[attempts - 1]),
        lastStatusCode: result.statusCode,
        lastError: result.error,
      },
    });
    return;
  }
  await failFinally(id, sub.id, now, { attempts, lastStatusCode: result.statusCode, lastError: result.error }, true);
}

/** One full pass: claim, then send. Exposed for tests. */
export async function runDispatchOnce(opts: { now?: Date; send?: SendFn } = {}): Promise<{ claimed: number; attempted: number }> {
  const claimed = await dispatchActivity();
  const attempted = await sendDueDeliveries(opts);
  return { claimed, attempted };
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await runDispatchOnce();
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "Webhook dispatcher tick failed");
  } finally {
    running = false;
  }
  scheduleNext();
}

function scheduleNext(): void {
  if (!started) return;
  timer = setTimeout(() => {
    void tick();
  }, TICK_MS);
  timer.unref?.();
}

/** No-op under test (`NODE_ENV=test`) — call once from `src/index.ts` after `listen`. */
export function startWebhookDispatcher(): void {
  if (env.NODE_ENV === "test") return;
  if (started) return;
  started = true;
  scheduleNext();
}

export function stopWebhookDispatcher(): void {
  started = false;
  if (timer) clearTimeout(timer);
  timer = undefined;
}
