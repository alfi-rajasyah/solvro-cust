// Outgoing webhook dispatcher (docs/archive/plans/webhooks.md). Reads the
// activity log, which every write already records in its own transaction, so
// no write path knows about webhooks. Two steps per tick:
//   1. claim up to 100 undispatched activity rows (FOR UPDATE SKIP LOCKED, so
//      more than one backend instance never claims the same row), map them to
//      event types, create one pending delivery per matching active
//      subscription whose owner may receive events about the project, and
//      stamp the rows, all in one transaction;
//   2. send the pending deliveries that are due (a small concurrency pool,
//      a few per webhook per tick), each after checking again that the owner
//      still holds the permissions and can see the project.
// Same lifecycle as lib/activityCleanup.ts: started once from src/index.ts,
// unref'd timer, off under NODE_ENV=test.
import type { Prisma } from "@prisma/client";
import { env } from "../../env.js";
import { logger } from "../../logger.js";
import { prisma } from "../../prisma.js";
import { permissionsOf } from "../../http/auth.js";
import { filterActiveUsersWhoCanSeeProject } from "../notifications.js";
import { mapActivityToEvents, newStatusName } from "./events.js";
import type { WebhookEventType } from "./eventTypes.js";
import { buildPayload } from "./payload.js";
import { prepareRequest, sendRequest, type SendFn } from "./sender.js";
import { hostForLog } from "./validateTarget.js";

export const TICK_MS = 5_000;
export const CLAIM_BATCH = 100;
const SEND_BATCH = 50;
/** At most this many deliveries to one webhook per tick, so a dead target cannot hold the queue. */
const PER_SUBSCRIPTION_PER_TICK = 3;
/** ... or this many when no other webhook has anything due. */
const LONE_WEBHOOK_PER_TICK = 10;
const SEND_CONCURRENCY = 5;
/** A claimed delivery that never reports back (a crash mid-send) is retried after this. */
const LEASE_MS = 2 * 60_000;
export const AUTO_DISABLE_AFTER = 20;
/** Wait before attempt 2, 3, ... 7; a seventh failure ends the delivery. */
export const RETRY_DELAYS_MS = [5_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 5 * 3600_000, 10 * 3600_000];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

let started = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Which of `ownerIds` may still receive events about `projectId`: the account
 * is active, its role grants `webhook:manage` and `project:read` (or `*`), and
 * it can see the project. A permission that was removed, or a demotion, stops
 * delivery just as losing the project does.
 */
export async function ownersWhoMayReceive(db: Db, projectId: number, ownerIds: readonly number[]): Promise<Set<number>> {
  const ids = [...new Set(ownerIds)];
  if (ids.length === 0) return new Set();
  const users = await db.user.findMany({
    where: { id: { in: ids }, active: true },
    select: { id: true, role: { select: { permissions: true } } },
  });
  const permitted = users
    .filter((u) => {
      const p = permissionsOf(u.role.permissions);
      return p.includes("*") || (p.includes("webhook:manage") && p.includes("project:read"));
    })
    .map((u) => u.id);
  return filterActiveUsersWhoCanSeeProject(db, projectId, permitted);
}

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
    // A comment written by an incoming webhook URL (`source` set) sends no
    // `comment.created`, so a relay between the two directions cannot loop.
    const commentIds = rows.filter((r) => r.entityType === "comment" && r.action === "created").map((r) => r.entityId);
    const sourced = new Set<number>();
    if (commentIds.length > 0) {
      const found = await tx.comment.findMany({ where: { id: { in: commentIds }, source: { not: null } }, select: { id: true } });
      for (const c of found) sourced.add(c.id);
    }
    const subs = await tx.webhookSubscription.findMany({
      where: { active: true },
      select: { id: true, ownerId: true, eventTypes: true, projectIds: true },
    });

    // Whether each status change landed on a DONE status: resolved from the
    // status NAME the row recorded (task_status_defs.name is unique), not from
    // the task's status now, so two status rows for one task in the same
    // claim each map on their own.
    const doneNames = new Set<string>();
    const names = [...new Set(rows.map(newStatusName).filter((n): n is string => n !== null))];
    if (names.length > 0) {
      const defs = await tx.taskStatusDef.findMany({ where: { name: { in: names }, category: "DONE" }, select: { name: true } });
      for (const d of defs) doneNames.add(d.name);
    }

    // Candidate (subscription, row, event) triples first, then one access
    // check per project over the owners that matter there.
    const candidates: { sub: (typeof subs)[number]; row: (typeof rows)[number]; type: WebhookEventType }[] = [];
    for (const row of rows) {
      const name = newStatusName(row);
      const events = mapActivityToEvents(row, name !== null && doneNames.has(name)).filter(
        (type) => !(type === "comment.created" && sourced.has(row.entityId)),
      );
      if (events.length === 0) continue;
      for (const sub of subs) {
        if (sub.projectIds.length > 0 && !sub.projectIds.includes(row.projectId)) continue;
        for (const type of events) {
          if (sub.eventTypes.includes(type)) candidates.push({ sub, row, type });
        }
      }
    }
    const ownersByProject = new Map<number, Set<number>>();
    for (const c of candidates) {
      const set = ownersByProject.get(c.row.projectId) ?? new Set<number>();
      set.add(c.sub.ownerId);
      ownersByProject.set(c.row.projectId, set);
    }
    const mayReceive = new Map<number, Set<number>>();
    for (const [projectId, owners] of ownersByProject) {
      mayReceive.set(projectId, await ownersWhoMayReceive(tx, projectId, [...owners]));
    }

    // One delivery per matching event type: a webhook that follows both
    // `task.created` and `task.assigned` gets both messages. No row is created
    // for an owner who cannot see the project or lost the permission.
    const deliveries: Prisma.WebhookDeliveryCreateManyInput[] = [];
    for (const { sub, row, type } of candidates) {
      if (mayReceive.get(row.projectId)?.has(sub.ownerId)) {
        deliveries.push({ subscriptionId: sub.id, activityEventId: row.id, eventType: type });
      }
    }
    if (deliveries.length > 0) await tx.webhookDelivery.createMany({ data: deliveries, skipDuplicates: true });
    await tx.activityEvent.updateMany({ where: { id: { in: ids } }, data: { webhookDispatchedAt: new Date() } });
    return ids.length;
    // The default 5 s interactive-transaction limit is too tight for a 100-row
    // claim with per-project access checks on a busy database. The work stays
    // small (no network inside the transaction), so 30 s is a ceiling, not a
    // budget.
  }, { timeout: 30_000, maxWait: 10_000 });
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

/** Step 2. Sends the due pending deliveries; returns how many were attempted. */
export async function sendDueDeliveries(opts: { now?: Date; send?: SendFn } = {}): Promise<number> {
  // A fixed `now` is for tests; otherwise every claim and every result write
  // reads the clock again, so a slow tick never stamps stale times.
  const clock = () => opts.now ?? new Date();
  const send = opts.send ?? sendRequest;
  // A webhook that was switched off or removed its owner's access: its pending
  // rows fail in bulk here, outside the per-webhook cap and without a request.
  await prisma.webhookDelivery.updateMany({
    where: { status: "PENDING", subscription: { active: false } },
    data: { status: "FAILED", lastError: "webhook_disabled", nextAttemptAt: clock() },
  });

  // Due rows are picked per webhook in SQL, so one webhook's backlog never
  // hides another's: at most 3 per webhook, or 10 when only one webhook has
  // anything due (so a lone busy webhook still drains), oldest first, 50 in all.
  const nowForQuery = clock();
  const due = (
    await prisma.$queryRaw<{ id: number }[]>`
      WITH ranked AS (
        SELECT id, subscription_id,
               ROW_NUMBER() OVER (PARTITION BY subscription_id ORDER BY id) AS rn
        FROM webhook_deliveries
        WHERE status = 'PENDING' AND next_attempt_at <= ${nowForQuery}
      ),
      busy AS (SELECT COUNT(DISTINCT subscription_id) AS webhooks FROM ranked)
      SELECT ranked.id FROM ranked, busy
      WHERE ranked.rn <= CASE WHEN busy.webhooks = 1 THEN ${LONE_WEBHOOK_PER_TICK} ELSE ${PER_SUBSCRIPTION_PER_TICK} END
      ORDER BY ranked.rn, ranked.id
      LIMIT ${SEND_BATCH}`
  ).map((r) => r.id);

  let attempted = 0;
  let next = 0;
  const worker = async () => {
    while (next < due.length) {
      const id = due[next++];
      // Claim by pushing nextAttemptAt out: a second instance's identical
      // updateMany then matches nothing.
      const claimedAt = clock();
      const claim = await prisma.webhookDelivery.updateMany({
        where: { id, status: "PENDING", nextAttemptAt: { lte: claimedAt } },
        data: { nextAttemptAt: new Date(claimedAt.getTime() + LEASE_MS) },
      });
      if (claim.count !== 1) continue;
      attempted += 1;
      try {
        await attemptDelivery(id, clock, send);
      } catch (err) {
        logger.warn({ deliveryId: id, err: err instanceof Error ? err.message : String(err) }, "Webhook delivery attempt crashed");
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(SEND_CONCURRENCY, due.length) }, worker));
  return attempted;
}

async function attemptDelivery(id: number, clock: () => Date, send: SendFn): Promise<void> {
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
    await failFinally(id, sub.id, clock(), { lastError: "webhook_disabled" }, false);
    return;
  }
  const mayReceive = await ownersWhoMayReceive(prisma, event.projectId, [sub.ownerId]);
  if (!mayReceive.has(sub.ownerId)) {
    // `owner_no_access` covers every way the owner stopped being entitled: the
    // account is inactive, the role lost `webhook:manage` or `project:read`, or
    // the project is no longer visible to them.
    await failFinally(id, sub.id, clock(), { lastError: "owner_no_access" }, false);
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
      data: { status: "SUCCEEDED", attempts, nextAttemptAt: clock(), lastStatusCode: result.statusCode, lastError: null },
    });
    await prisma.webhookSubscription.updateMany({ where: { id: sub.id, consecutiveFailures: { gt: 0 } }, data: { consecutiveFailures: 0 } });
    return;
  }
  logger.info({ deliveryId: id, host: hostForLog(sub.url), error: result.error, statusCode: result.statusCode, attempts }, "Webhook delivery failed");
  if (result.retryable && attempts < MAX_ATTEMPTS) {
    await prisma.webhookDelivery.update({
      where: { id },
      data: {
        attempts,
        nextAttemptAt: new Date(clock().getTime() + RETRY_DELAYS_MS[attempts - 1]),
        lastStatusCode: result.statusCode,
        lastError: result.error,
      },
    });
    return;
  }
  await failFinally(id, sub.id, clock(), { attempts, lastStatusCode: result.statusCode, lastError: result.error }, true);
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
