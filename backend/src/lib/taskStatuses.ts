import { Prisma, type PrismaClient, type TaskStatus } from "@prisma/client";
import { HttpError } from "../http/errors.js";
import { prisma } from "../prisma.js";
import { lockProjectOrder } from "./orderLock.js";

// Custom task statuses (docs/archive/plans/custom-task-statuses.md §1): a
// workspace-wide list of admin-defined statuses, each in one of the three
// fixed categories (the TaskStatus enum). `Task.status` is always the
// CATEGORY of `Task.statusDef`; every write goes through resolveStatusWrite so
// the two columns can never disagree.

type Tx = Prisma.TransactionClient | PrismaClient;

/** The status fields every task payload carries as `statusDef` (display only). */
export const STATUS_DEF_SELECT = {
  id: true,
  name: true,
  color: true,
  category: true,
  position: true,
} satisfies Prisma.TaskStatusDefSelect;

/** Spread into a task `include` so the payload carries `statusDef`. */
export const statusDefInclude = { statusDef: { select: STATUS_DEF_SELECT } } as const;

/**
 * The tone keys a status `color` may hold. It is a tone key, not a hex, so a
 * status chip keeps the theme-aware bg/text tint pairs StatusChip.tsx already
 * uses (docs/DESIGN.md). "primary" is the tint StatusChip calls "blue". No
 * rose: a status must not read as an error.
 */
export const STATUS_TONES = ["gray", "primary", "emerald", "amber", "violet"] as const;

// Advisory-lock namespace shared by every writer of the status list: the admin
// save takes it exclusively, and every transaction that resolves a task's
// status takes it shared FIRST (before any project-order or row lock), so a
// category change or delete cannot interleave with a task write and the two
// can never deadlock.
const STATUS_LIST_LOCK = 7301;

export async function lockStatusListShared(tx: Tx): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(${STATUS_LIST_LOCK}::int, 0)`;
}

/** The default status of a category; throws if the list lost its invariant. */
export async function defaultStatusDef(tx: Tx, category: TaskStatus) {
  const def = await tx.taskStatusDef.findFirst({
    where: { category, isDefault: true },
    select: STATUS_DEF_SELECT,
  });
  if (!def) {
    throw new HttpError(500, "status_default_missing", `No default status for ${category}`);
  }
  return def;
}

/**
 * Turns a write's `statusId` / legacy `status` into the pair to persist.
 * `statusId` wins; a bare category maps to that category's default status;
 * both given must agree (400 `status_mismatch`); an unknown id is 400
 * `status_not_found`. Returns null when the write names neither.
 */
export async function resolveStatusWrite(
  tx: Tx,
  input: { status?: TaskStatus; statusId?: number },
): Promise<{ status: TaskStatus; statusId: number } | null> {
  if (input.statusId !== undefined) {
    const def = await tx.taskStatusDef.findUnique({
      where: { id: input.statusId },
      select: { id: true, category: true },
    });
    if (!def) throw new HttpError(400, "status_not_found", "Status not found");
    if (input.status !== undefined && input.status !== def.category) {
      throw new HttpError(400, "status_mismatch", "status does not match the category of statusId");
    }
    return { status: def.category, statusId: def.id };
  }
  if (input.status !== undefined) {
    const def = await defaultStatusDef(tx, input.status);
    return { status: def.category, statusId: def.id };
  }
  return null;
}

/** The pair a brand-new task starts with: the TODO default. */
export async function newTaskStatus(tx: Tx = prisma) {
  const def = await defaultStatusDef(tx, "TODO");
  return { status: def.category, statusId: def.id };
}

/** Rejects a WIP-limits object whose keys are not all known status ids. */
export async function assertWipLimitKeys(
  tx: Tx,
  limits: Record<string, number | null> | null | undefined,
): Promise<void> {
  if (!limits) return;
  const ids = Object.keys(limits).map(Number);
  if (ids.length === 0) return;
  const known = await tx.taskStatusDef.count({ where: { id: { in: ids } } });
  if (known !== ids.length) {
    throw new HttpError(400, "validation_error", "wipLimits names an unknown status", {
      formErrors: [],
      fieldErrors: { wipLimits: ["Unknown status id"] },
    });
  }
}

// ---------------------------------------------------------------------------
// Workspace list: read + whole-list admin save
// ---------------------------------------------------------------------------

const TASK_STATUS_CATEGORIES: readonly TaskStatus[] = ["TODO", "IN_PROGRESS", "DONE"];

/** The whole list in display order — what GET /task-statuses returns. */
export async function listTaskStatusDefs(tx: Tx = prisma) {
  return tx.taskStatusDef.findMany({
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { ...STATUS_DEF_SELECT, isDefault: true },
  });
}

/**
 * The list plus how many tasks sit on each status (one groupBy, no N+1) — what
 * the admin editor shows beside each row and uses to decide whether a delete
 * needs a `moveTo` target.
 */
export async function listTaskStatusDefsWithCounts(tx: Tx = prisma) {
  const [defs, counts] = await Promise.all([
    listTaskStatusDefs(tx),
    tx.task.groupBy({ by: ["statusId"], _count: { _all: true } }),
  ]);
  const byId = new Map(counts.map((c) => [c.statusId, c._count._all]));
  return defs.map((d) => ({ ...d, taskCount: byId.get(d.id) ?? 0 }));
}

export interface StatusDefInput {
  /** Present = an existing status (renamed / recoloured / moved); absent = new. */
  id?: number;
  name: string;
  category: TaskStatus;
  color: string;
  isDefault: boolean;
}

export interface SaveStatusDefsInput {
  /** The complete list; array order becomes `position`. */
  statuses: StatusDefInput[];
  /** For each removed status that still has tasks: the kept status they move to. */
  moveTo?: Record<string, number>;
}

// The save may wait on one order lock per affected project (3 s each). The
// budget caps the total wait; the transaction timeout sits well above it so
// the writes after the last lock still fit and Prisma's 5 s default never
// turns a wait into a P2028 500.
const ORDER_LOCKS_BUDGET_MS = 15_000;
const SAVE_TX_TIMEOUT_MS = 30_000;
const CONCURRENT_MESSAGE = "Another change was saved at the same moment. Try again.";

const conflict = (code: string, message: string, details?: unknown) =>
  new HttpError(409, code, message, details);

/**
 * Replaces the workspace status list in ONE transaction. Rules (409 on a
 * violation): every category keeps >= 1 status; exactly one default per
 * category; names unique (case-insensitive); a removed status that still has
 * tasks needs a `moveTo` target among the kept statuses, and its tasks'
 * category follows the target's. A kept status that changes category carries
 * its tasks' `status` along, so `Task.status` always equals its status's
 * category (docs/archive/plans/custom-task-statuses.md §1-2).
 */
export async function saveTaskStatusDefs(input: SaveStatusDefsInput) {
  const { statuses } = input;
  const moveTo = input.moveTo ?? {};

  // Shape rules that need no database.
  const names = new Set<string>();
  for (const s of statuses) {
    const key = s.name.trim().toLowerCase();
    if (names.has(key)) throw conflict("status_name_taken", `Duplicate status name "${s.name}"`);
    names.add(key);
  }
  for (const category of TASK_STATUS_CATEGORIES) {
    const inCategory = statuses.filter((s) => s.category === category);
    if (inCategory.length === 0) {
      throw conflict("status_category_empty", `Category ${category} needs at least one status`);
    }
    if (inCategory.filter((s) => s.isDefault).length !== 1) {
      throw conflict(
        "status_default_invalid",
        `Category ${category} needs exactly one default status`,
      );
    }
  }

  return prisma.$transaction(async (tx) => {
    // Exclusive: waits for in-flight task writes and blocks new ones.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${STATUS_LIST_LOCK}::int, 0)`;

    const existing = await tx.taskStatusDef.findMany({
      select: { id: true, name: true, category: true },
    });
    const existingById = new Map(existing.map((d) => [d.id, d]));
    for (const s of statuses) {
      if (s.id !== undefined && !existingById.has(s.id)) {
        throw new HttpError(400, "status_not_found", `Status ${s.id} does not exist`);
      }
    }
    const keptIds = new Set(statuses.flatMap((s) => (s.id === undefined ? [] : [s.id])));
    const removed = existing.filter((d) => !keptIds.has(d.id));

    // The writes below update tasks across projects (moves off a removed
    // status, a category change). A task re-pack takes its project's task-order
    // lock and then updates that project's task rows, so updating task rows
    // here without that lock can deadlock with it. Lock order: the exclusive
    // status-list lock above, then each affected project's task-order lock in
    // ascending project id (so two saves never cross), then the row locks.
    // Task writers take the shared status-list lock first, then one project's
    // order lock, so no cycle is possible.
    const changedIds = [
      ...removed.map((d) => d.id),
      ...statuses.flatMap((s) =>
        s.id !== undefined && existingById.get(s.id)!.category !== s.category ? [s.id] : [],
      ),
    ];
    if (changedIds.length > 0) {
      const projects = await tx.task.findMany({
        where: { statusId: { in: changedIds } },
        distinct: ["projectId"],
        orderBy: { projectId: "asc" },
        select: { projectId: true },
      });
      // Each wait is bounded (lib/orderLock.ts); bound the total too, so many
      // projects answer a retryable 409 instead of the transaction expiring.
      const startedAt = Date.now();
      for (const { projectId } of projects) {
        if (Date.now() - startedAt > ORDER_LOCKS_BUDGET_MS) throw new HttpError(409, "concurrent_update", CONCURRENT_MESSAGE);
        await lockProjectOrder(tx, "tasks", projectId);
      }
    }

    // Row locks: a task insert pointing at a status being removed waits for
    // this transaction instead of racing the delete.
    if (removed.length > 0) {
      await tx.$queryRaw`SELECT id FROM task_status_defs WHERE id IN (${Prisma.join(
        removed.map((d) => d.id),
      )}) FOR UPDATE`;
    }

    // Move tasks off every removed status.
    for (const def of removed) {
      const inUse = await tx.task.count({ where: { statusId: def.id } });
      if (inUse === 0) continue;
      const targetId = moveTo[String(def.id)];
      if (targetId === undefined) {
        throw conflict(
          "status_move_required",
          `Status "${def.name}" has ${inUse} task(s); choose a status to move them to`,
          { statusId: def.id, taskCount: inUse },
        );
      }
      const target = statuses.find((s) => s.id === targetId);
      if (!target) {
        throw conflict("status_move_invalid", "moveTo must name a status that stays in the list", {
          statusId: def.id,
          moveTo: targetId,
        });
      }
      await tx.task.updateMany({
        where: { statusId: def.id },
        data: { statusId: targetId, status: target.category },
      });
    }

    // Free the unique name / default slots before rewriting: an A<->B rename
    // swap or a default hand-over would otherwise trip the unique indexes.
    await tx.taskStatusDef.updateMany({ data: { isDefault: false } });
    for (const s of statuses) {
      if (s.id !== undefined && existingById.get(s.id)!.name !== s.name) {
        await tx.taskStatusDef.update({
          where: { id: s.id },
          data: { name: `__renaming_${s.id}__` },
        });
      }
    }
    if (removed.length > 0) {
      // A removed status's WIP limit goes with it; a stale key would make the
      // project's next save fail the known-status check.
      const removedKeys = removed.map((d) => String(d.id));
      await tx.$executeRaw`UPDATE projects SET wip_limits = wip_limits - ${removedKeys}::text[]
        WHERE jsonb_typeof(wip_limits) = 'object' AND wip_limits ?| ${removedKeys}::text[]`;
      await tx.taskStatusDef.deleteMany({ where: { id: { in: removed.map((d) => d.id) } } });
    }

    for (const [position, s] of statuses.entries()) {
      const data = {
        name: s.name,
        category: s.category,
        color: s.color,
        position,
        isDefault: s.isDefault,
      };
      if (s.id === undefined) {
        await tx.taskStatusDef.create({ data });
        continue;
      }
      await tx.taskStatusDef.update({ where: { id: s.id }, data });
      if (existingById.get(s.id)!.category !== s.category) {
        await tx.task.updateMany({ where: { statusId: s.id }, data: { status: s.category } });
      }
    }

    return listTaskStatusDefs(tx);
  }, { timeout: SAVE_TX_TIMEOUT_MS });
}
