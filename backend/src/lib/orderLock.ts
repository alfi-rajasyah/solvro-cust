import type { Prisma, PrismaClient } from "@prisma/client";

// One lock namespace per ordered list kind; the second key is the project id.
// (Other advisory-lock namespaces in use: 7_311 dependencies, 7_312 weekly
// updates, 0x6f75 Outline tokens.)
const NAMESPACE = { tasks: 7_313, sections: 7_314, epics: 7_315 } as const;

// How long a reorder waits for another one in the same project. Well under
// Prisma's default 5 s interactive-transaction timeout, so a long queue
// answers 409 `concurrent_update` (55P03, http/errors.ts) instead of the
// transaction expiring with a 500.
const LOCK_WAIT_MS = 3_000;

export type OrderedList = keyof typeof NAMESPACE;

/**
 * Serialises every re-pack of one project's task, section or epic order. A
 * re-pack updates each row of the list in turn, so two concurrent re-packs
 * that reach the shared rows in a different order deadlock (40P01) and one
 * request fails. Held until the transaction ends; taking it again in the same
 * transaction is harmless. Waits at most LOCK_WAIT_MS for the lock.
 *
 * A caller that row-locks a member of the list first (PATCH /tasks/:id,
 * PATCH /epics/:id) must take this lock BEFORE that row lock: otherwise one
 * transaction holds the row and waits for this lock while the holder of this
 * lock waits to update the row.
 */
export async function lockProjectOrder(
  tx: Prisma.TransactionClient | PrismaClient,
  list: OrderedList,
  projectId: number,
): Promise<void> {
  // Only this wait is bounded: the caller's lock_timeout comes back afterwards.
  const [{ previous }] = await tx.$queryRaw<{ previous: string }[]>`SELECT current_setting('lock_timeout') AS previous`;
  await tx.$executeRaw`SELECT set_config('lock_timeout', ${`${LOCK_WAIT_MS}ms`}, true)`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NAMESPACE[list]}::int, ${projectId}::int)`;
  await tx.$executeRaw`SELECT set_config('lock_timeout', ${previous}, true)`;
}
