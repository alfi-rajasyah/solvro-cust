// Pulls iTop UserRequest/Incident tickets into the ItopTicket snapshot and
// resolves Solvro users to their iTop Person/User identities by email.
// Called by lib/itop/scheduler.ts (interval + debounced Refresh/webhook) and
// by the admin "Sync now" route (task 1.5). See
// docs/plans/itop-integration.md §3 (join rules) and Task 1.4 for the
// contract this module implements.
import type { ItopConfig } from "@prisma/client";

import { prisma } from "../../prisma.js";
import { logger } from "../../logger.js";
import { ItopError, type ItopObjectRow } from "./client.js";
import {
  bustItopConfigCache,
  getItopAppClient,
  getItopConfig,
  isItopConfigured,
} from "./config.js";
import {
  ITOP_PERSON_OUTPUT_FIELDS,
  ITOP_TICKET_OUTPUT_FIELDS,
  ITOP_USER_OUTPUT_FIELDS,
  type ItopPersonFields,
  type ItopTicketFields,
  type ItopUserFields,
} from "./types.js";

export interface SyncSummary {
  ran: boolean;
  full: boolean;
  startedAt: Date;
  finishedAt: Date;
  orgs: number;
  upserted: number;
  removed: number;
  usersMatched: number;
  error?: string;
}

const FULL_SYNC_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const USER_SYNC_MIN_INTERVAL_MS = 60 * 60 * 1000;
const ADVISORY_LOCK_KEY = "itop_sync";
const TX_TIMEOUT_MS = 10 * 60_000;
const CHUNK_SIZE = 50;

/** Module-level: last time `syncUsers()` ran as part of `syncTickets()`'s "at most once/hour" throttle. Reset on process restart — deliberately simple, per Task 1.4. */
let lastUserSyncAt: Date | null = null;

const ITOP_DATE_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

/**
 * Parses iTop's `"YYYY-MM-DD HH:MM:SS"` datetime strings. Empty strings and
 * `"0000-00-00 00:00:00"` (iTop's "unset" sentinel) become `null`, as does
 * any value that doesn't match the expected shape (defensive — a field iTop
 * doesn't return as a plain datetime should not become a bogus Date).
 *
 * TODO(timezone): iTop's REST API does not include a timezone in this
 * format. We assume the value is UTC (i.e. the reference install's server
 * timezone). If a later phase adds a per-install timezone setting, this
 * assumption should be revisited.
 */
export function parseItopDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "0000-00-00 00:00:00") return null;
  const match = ITOP_DATE_RE.exec(trimmed);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)));
}

/** Inverse of `parseItopDate` for building an OQL `last_update > '...'` cutoff. */
function formatItopDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}

/** iTop returns SLA-passed flags as `"yes"`/`"no"` or `"1"`/`"0"` depending on the attribute type — accept either. */
function parseItopBoolean(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "yes" || normalized === "1" || normalized === "true";
}

/** Escapes a single-quoted OQL string literal (iTop/MySQL style: double the quote). */
function escapeOqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

function errorMessage(err: unknown): string {
  if (err instanceof ItopError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

/**
 * Matches active Solvro users to iTop by email: `Person.email` →
 * `User.itopPersonId`, then that Person's `contactid` on iTop's `User` class
 * → `User.itopUserId`. A chunk whose iTop lookup itself fails (network/auth
 * error) is skipped entirely — existing mappings for that chunk's users are
 * left untouched. When iTop *does* answer and a user's email/contactid is
 * not among the results, the corresponding mapping is cleared (iTop
 * affirmatively told us it doesn't exist).
 */
export async function syncUsers(): Promise<{ matched: number; unmatched: string[] }> {
  const config = await getItopConfig();
  if (!isItopConfigured(config)) {
    logger.debug("iTop syncUsers skipped: iTop is not configured");
    return { matched: 0, unmatched: [] };
  }

  const client = await getItopAppClient();
  const users = await prisma.user.findMany({
    where: { active: true, email: { not: "" } },
    select: { id: true, email: true, itopPersonId: true, itopUserId: true },
  });

  const personIdByUserId = new Map<number, number>();

  for (const users50 of chunk(users, CHUNK_SIZE)) {
    const literal = users50.map((u) => `'${escapeOqlString(u.email)}'`).join(",");
    const oql = `SELECT Person WHERE email IN (${literal})`;
    let persons: Array<ItopObjectRow<ItopPersonFields>>;
    try {
      const result = await client.get<ItopPersonFields>("Person", oql, ITOP_PERSON_OUTPUT_FIELDS);
      persons = result.objects;
    } catch (err) {
      logger.warn({ err: errorMessage(err) }, "iTop syncUsers: Person lookup failed for a chunk; leaving existing mappings untouched");
      continue;
    }

    const foundByEmail = new Map(persons.map((p) => [p.fields.email.toLowerCase(), p]));
    for (const user of users50) {
      const found = foundByEmail.get(user.email.toLowerCase());
      if (found) {
        personIdByUserId.set(user.id, found.key);
        if (user.itopPersonId !== found.key) {
          await prisma.user.update({ where: { id: user.id }, data: { itopPersonId: found.key } });
        }
      } else if (user.itopPersonId !== null) {
        await prisma.user.update({ where: { id: user.id }, data: { itopPersonId: null } });
      }
    }
  }

  const usersById = new Map(users.map((u) => [u.id, u]));
  for (const pairs50 of chunk([...personIdByUserId.entries()], CHUNK_SIZE)) {
    const personIds = pairs50.map(([, personId]) => personId);
    const oql = `SELECT User WHERE contactid IN (${personIds.join(",")})`;
    let itopUsers: Array<ItopObjectRow<ItopUserFields>>;
    try {
      const result = await client.get<ItopUserFields>("User", oql, ITOP_USER_OUTPUT_FIELDS);
      itopUsers = result.objects;
    } catch (err) {
      logger.warn({ err: errorMessage(err) }, "iTop syncUsers: User lookup failed for a chunk; leaving existing mappings untouched");
      continue;
    }

    const foundByContactId = new Map(itopUsers.map((u) => [Number(u.fields.contactid), u]));
    for (const [userId, personId] of pairs50) {
      const found = foundByContactId.get(personId);
      const solvroUser = usersById.get(userId);
      if (!solvroUser) continue;
      if (found) {
        if (solvroUser.itopUserId !== found.key) {
          await prisma.user.update({ where: { id: userId }, data: { itopUserId: found.key } });
        }
      } else if (solvroUser.itopUserId !== null) {
        await prisma.user.update({ where: { id: userId }, data: { itopUserId: null } });
      }
    }
  }

  const finalUsers = await prisma.user.findMany({
    where: { active: true },
    select: { email: true, itopPersonId: true },
  });
  const matched = finalUsers.filter((u) => u.itopPersonId !== null).length;
  const unmatched = finalUsers.filter((u) => u.itopPersonId === null).map((u) => u.email);
  return { matched, unmatched };
}

async function upsertTicket(
  cls: string,
  row: ItopObjectRow<ItopTicketFields>,
  orgIdToCustomerId: Map<number, number>,
): Promise<void> {
  const fields = row.fields;
  const orgId = Number(fields.org_id);
  const agentPersonId = fields.agent_id && Number(fields.agent_id) > 0 ? Number(fields.agent_id) : null;

  const data = {
    class: cls,
    ref: fields.ref,
    title: fields.title,
    status: fields.status,
    operationalStatus: fields.operational_status || null,
    priority: fields.priority || null,
    agentPersonId,
    agentName: fields.agent_id_friendlyname || null,
    teamName: fields.team_id_friendlyname || null,
    serviceName: fields.service_id_friendlyname || null,
    callerName: fields.caller_id_friendlyname || null,
    orgId,
    customerId: orgIdToCustomerId.get(orgId) ?? null,
    startDate: parseItopDate(fields.start_date),
    // lastUpdate is non-nullable on the model; fall back to "now" in the
    // (unexpected) case iTop returns an unparseable value for it.
    lastUpdate: parseItopDate(fields.last_update) ?? new Date(),
    tto: parseItopDate(fields.tto),
    ttr: parseItopDate(fields.ttr),
    slaTtoPassed: parseItopBoolean(fields.sla_tto_passed),
    slaTtrPassed: parseItopBoolean(fields.sla_ttr_passed),
    resolutionDate: parseItopDate(fields.resolution_date),
    syncedAt: new Date(),
  };

  await prisma.itopTicket.upsert({
    where: { id: row.key },
    create: { id: row.key, ...data },
    update: data,
  });
}

async function writeConfigResult(
  startedAt: Date,
  ok: boolean,
  message: string | null,
  setFullSyncAt: boolean,
): Promise<void> {
  await prisma.itopConfig.update({
    where: { id: "default" },
    data: {
      // Only a successful run advances the incremental watermark. A failed
      // run must leave `lastSyncAt` where it was — otherwise a ticket
      // updated in iTop during an outage falls before the *next* run's
      // `last_update > lastSyncAt - 60s` cutoff and is silently skipped
      // until the next 24h full pull.
      ...(ok ? { lastSyncAt: startedAt } : {}),
      lastSyncOk: ok,
      lastSyncError: message ? message.slice(0, 500) : null,
      ...(setFullSyncAt ? { lastFullSyncAt: new Date() } : {}),
    },
  });
  bustItopConfigCache();
}

function shouldRunFull(full: boolean, config: ItopConfig): boolean {
  if (full) return true;
  if (config.lastSyncAt === null) return true;
  if (config.lastFullSyncAt === null) return true;
  return Date.now() - config.lastFullSyncAt.getTime() > FULL_SYNC_MAX_AGE_MS;
}

function shouldRunUserSync(full: boolean): boolean {
  if (full) return true;
  if (lastUserSyncAt === null) return true;
  return Date.now() - lastUserSyncAt.getTime() > USER_SYNC_MIN_INTERVAL_MS;
}

/**
 * Pulls tickets for every mapped customer's org, upserting into `ItopTicket`.
 * Serialized across processes/instances via a Postgres advisory lock — a
 * concurrent call while one is already running returns `{ ran: false, ... }`
 * immediately rather than queueing. iTop errors are caught, recorded on
 * `ItopConfig`, and returned in `SyncSummary.error` — they never throw out
 * of this function.
 */
export async function syncTickets(opts: { full?: boolean } = {}): Promise<SyncSummary> {
  const startedAt = new Date();
  let ran = false;
  let full = Boolean(opts.full);
  let orgs = 0;
  let upserted = 0;
  let removed = 0;
  let usersMatched = 0;
  let runError: string | undefined;

  await prisma.$transaction(
    async (tx) => {
      // `_xact` self-releases at COMMIT/ROLLBACK of this interactive
      // transaction — no matching unlock statement to remember, and no risk
      // of leaking the lock if the process dies mid-sync. The transaction is
      // still needed to pin every query below (and the lock/unlock that used
      // to bracket them) to one connection.
      const lockRows = await tx.$queryRaw<
        Array<{ locked: boolean }>
      >`SELECT pg_try_advisory_xact_lock(hashtext(${ADVISORY_LOCK_KEY})) AS locked`;
      if (!lockRows[0]?.locked) {
        return;
      }

      const config = await getItopConfig();
      if (!isItopConfigured(config)) {
        logger.debug("iTop sync skipped: iTop is not configured");
        return;
      }

      ran = true;
      full = shouldRunFull(full, config);

      try {
        if (shouldRunUserSync(full)) {
          const userResult = await syncUsers();
          usersMatched = userResult.matched;
          lastUserSyncAt = new Date();
        } else {
          usersMatched = (await prisma.user.count({ where: { active: true, itopPersonId: { not: null } } })) ?? 0;
        }

        const customers = await prisma.customer.findMany({
          where: { itopOrgId: { not: null } },
          select: { id: true, itopOrgId: true },
        });
        orgs = customers.length;

        const orgIdToCustomerId = new Map(customers.map((c) => [c.itopOrgId as number, c.id]));
        const orgIds = customers.map((c) => c.itopOrgId as number);
        const seenIds = new Set<number>();

        // "Without calling iTop" only applies to the ticket pull itself —
        // orgIds.length === 0 skips straight to the full-sync cleanup below,
        // which (via the OR) also purges a snapshot left behind by a
        // customer that was unmapped or deleted since the last full sync.
        if (orgIds.length > 0) {
          const client = await getItopAppClient();
          for (const cls of config.readClasses) {
            let oql = `SELECT ${cls} WHERE org_id IN (${orgIds.join(",")})`;
            if (!full && config.lastSyncAt) {
              const cutoff = new Date(config.lastSyncAt.getTime() - 60_000);
              oql += ` AND last_update > '${formatItopDate(cutoff)}'`;
            }

            const result = await client.getAll<ItopTicketFields>(cls, oql, ITOP_TICKET_OUTPUT_FIELDS, {
              pageSize: 100,
            });
            for (const row of result.objects) {
              seenIds.add(row.key);
              await upsertTicket(cls, row, orgIdToCustomerId);
              upserted += 1;
            }
          }
        }

        if (full) {
          // A row is orphaned (and dropped) if its org is no longer mapped
          // to any customer at all, OR it belongs to a still-mapped org but
          // wasn't returned in this run — covers a deleted/unmapped
          // customer (whose tickets would otherwise keep a stale
          // customerId via ON DELETE SET NULL) as well as a ticket iTop no
          // longer returns for a still-mapped org.
          const deleted = await prisma.itopTicket.deleteMany({
            where: {
              OR: [{ orgId: { notIn: orgIds } }, { id: { notIn: [...seenIds] } }],
            },
          });
          removed = deleted.count;
        }

        await writeConfigResult(startedAt, true, null, full);
        logger.info(
          { full, orgs, upserted, removed, usersMatched, ms: Date.now() - startedAt.getTime() },
          "iTop sync completed",
        );
      } catch (err) {
        runError = errorMessage(err);
        logger.warn({ err: runError }, "iTop sync failed");
        await writeConfigResult(startedAt, false, runError, false);
      }
    },
    { timeout: TX_TIMEOUT_MS },
  );

  return {
    ran,
    full,
    startedAt,
    finishedAt: new Date(),
    orgs,
    upserted,
    removed,
    usersMatched,
    error: runError,
  };
}
