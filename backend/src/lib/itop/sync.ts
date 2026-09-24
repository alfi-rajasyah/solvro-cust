// Pulls iTop UserRequest/Incident tickets into the ItopTicket snapshot and
// resolves Solvro users to their iTop Person/User identities by email.
// Called by lib/itop/scheduler.ts (interval + debounced Refresh/webhook) and
// by the admin "Sync now" route (task 1.5). See
// docs/archive/plans/itop-integration.md §3 (join rules) and Task 1.4 for the
// contract this module implements.
import { Prisma, type ItopConfig } from "@prisma/client";

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
  ITOP_TIME_SPENT_DURATION_IN_SECONDS,
  ITOP_TIME_SPENT_OUTPUT_FIELDS,
  ITOP_TIME_SPENT_TICKET_REF_FIELD,
  ITOP_USER_OUTPUT_FIELDS,
  type ItopCaseLogEntry,
  type ItopCaseLogRaw,
  type ItopPersonFields,
  type ItopTicketFields,
  type ItopTimeSpentFields,
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
  timeEntriesUpserted: number;
  timeEntriesRemoved: number;
  /**
   * Count of rows (tickets AND time entries — see `TimeEntrySyncResult.skipped`,
   * folded in here) that iTop returned but that failed to upsert (a malformed
   * field, an unexpected type, ...) and were skipped rather than failing the
   * whole run. Each skip is also logged at `warn` with the row's id and the
   * error. Real installs occasionally have one bad row; the rest of the
   * snapshot must still sync.
   */
  skipped: number;
  /** Set when the time-entry pass itself errored — kept separate from `error` since a ticket sync can succeed while the time-entry pass fails (e.g. TimeSpent missing on this install). Surfaceable later by the admin route. */
  timeEntriesError?: string;
  error?: string;
}

/** Return shape of `syncTimeEntries`, standalone-callable and also invoked by `syncTickets`. */
export interface TimeEntrySyncResult {
  ran: boolean;
  upserted: number;
  removed: number;
  /** Rows that failed to upsert (bad field, unexpected type, ...) and were skipped, logged at `warn`, rather than failing the whole pass. */
  skipped: number;
  error?: string;
}

const FULL_SYNC_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const USER_SYNC_MIN_INTERVAL_MS = 60 * 60 * 1000;
const ADVISORY_LOCK_KEY = "itop_sync";
const TX_TIMEOUT_MS = 10 * 60_000;
const CHUNK_SIZE = 50;
/**
 * How far back `syncTimeEntries` pulls `TimeSpent` rows — plan §3/Task 3.1.
 * Exported so `routes/itop.ts`'s `POST /tickets/:id/time` (Task 7.1) rejects
 * a `startedAt` older than this window with the same 8-week bound, rather
 * than accepting an entry that syncing itself would never pull back.
 */
export const TIME_ENTRY_WINDOW_MS = 8 * 7 * 24 * 60 * 60 * 1000;

/** Module-level: last time `syncUsers()` ran as part of `syncTickets()`'s "at most once/hour" throttle. Reset on process restart — deliberately simple, per Task 1.4. */
let lastUserSyncAt: Date | null = null;

const ITOP_DATE_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

/**
 * Parses iTop's `"YYYY-MM-DD HH:MM:SS"` datetime strings. Empty strings and
 * `"0000-00-00 00:00:00"` (iTop's "unset" sentinel) become `null`, as does
 * any value that doesn't match the expected shape (defensive — a field iTop
 * doesn't return as a plain datetime should not become a bogus Date).
 *
 * Takes `unknown`, not `string | null | undefined`: a real install can
 * return a field as a JSON integer instead of a string (confirmed on
 * `tto`/`ttr` themselves, which is exactly why sync now reads the
 * `*_escalation_deadline` attributes instead) or omit it as `null`/an
 * object entirely — any non-string value becomes `null` rather than
 * throwing (`value.trim is not a function`), so one unexpected field shape
 * degrades gracefully instead of crashing the whole sync run.
 *
 * TODO(timezone): iTop's REST API does not include a timezone in this
 * format. We assume the value is UTC (i.e. the reference install's server
 * timezone). If a later phase adds a per-install timezone setting, this
 * assumption should be revisited.
 */
export function parseItopDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "0000-00-00 00:00:00") return null;
  const match = ITOP_DATE_RE.exec(trimmed);
  if (!match) {
    logger.debug({ value: trimmed }, "iTop date field in an unexpected format — ignored");
    return null;
  }
  const [, y, mo, d, h, mi, s] = match;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)));
}

/**
 * Inverse of `parseItopDate` for building an OQL `last_update > '...'`
 * cutoff, and (Task 7.1) for formatting `start_date`/`end_date` on a
 * `core/create TimeSpent` write — iTop's REST API takes plain
 * "YYYY-MM-DD HH:MM:SS" with no timezone, so `routes/itop.ts`'s
 * `POST /tickets/:id/time` sends the same UTC-assumed shape `parseItopDate`
 * reads back, keeping the write and the read on one shared assumption.
 * Exported for that route rather than re-derived there.
 */
export function formatItopDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}

/**
 * iTop returns SLA-passed flags as `"yes"`/`"no"` or `"1"`/`"0"` depending on
 * the attribute type — accept either. Takes `unknown` (see `parseItopDate`'s
 * doc comment for why) and returns `false` for anything that isn't a string,
 * rather than throwing on a garbage/missing field. Exported for direct unit
 * testing of its `unknown`-input handling.
 */
export function parseItopBoolean(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "yes" || normalized === "1" || normalized === "true";
}

/** Plain decimal integer, optionally negative — deliberately narrower than what `Number()` itself accepts (rejects "1.5", "0x10", "1e3", which `Number()` would happily turn into 1.5/16/1000). */
const PLAIN_INTEGER_RE = /^-?\d+$/;

/**
 * Parses an iTop numeric id/external-key field (`org_id`, `agent_id`,
 * `user_id`, ...) defensively: accepts a JSON number OR a numeric string
 * (iTop's REST API normally sends the latter), returns `null` for anything
 * else — a missing field, `null`, an object, a non-integer value, or a
 * string that isn't a plain decimal integer (`"1.5"`, `"0x10"`, `"1e3"` all
 * parse "successfully" with the bare `Number()` constructor but are not
 * legitimate iTop id shapes) — rather than propagating a fractional/`NaN`
 * value into a database column that can't hold it. Never throws. Exported
 * for direct unit testing of its `unknown`-input handling.
 */
export function parseItopInt(value: unknown): number | null {
  if (typeof value === "number") return Number.isInteger(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!PLAIN_INTEGER_RE.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : null;
}

/** Escapes a single-quoted OQL string literal (iTop/MySQL style: double the quote). Exported so `routes/itopUser.ts`'s email lookup builds the same OQL shape as `syncUsers` rather than re-deriving the escaping rule. */
export function escapeOqlString(value: string): string {
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
 * left untouched. When iTop *does* answer and a user's email is not among
 * the results, both `itopPersonId` and `itopUserId` are cleared together —
 * with no Person there's no `contactid` to resolve a User from either.
 * When the email still resolves to a Person but that Person's `contactid`
 * isn't among the `User` results, only `itopUserId` is cleared. Either way,
 * iTop affirmatively told us the mapping doesn't exist.
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
      } else if (user.itopPersonId !== null || user.itopUserId !== null) {
        // No Person at all this run means there's no contactid to resolve
        // an iTop User from either — clear both together. (Bug fixed
        // 2026-09-22: this branch used to null only itopPersonId, leaving
        // itopUserId stale forever, because the second pass below only
        // ever revisits users still present in personIdByUserId — a user
        // who drops out of the Person match entirely never reaches it.)
        await prisma.user.update({ where: { id: user.id }, data: { itopPersonId: null, itopUserId: null } });
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

/** How many case-log entries `normalizeCaseLog` keeps, newest last. */
const MAX_CASE_LOG_ENTRIES = 50;

/**
 * Strips a `message_html` fallback down to plain text: `<br>` (any case,
 * self-closed or not) becomes a newline, every other tag is dropped, and the
 * five basic HTML entities are decoded (`&amp;` last, so an already-escaped
 * `&amp;lt;` doesn't get double-decoded into `<`). Only used when iTop's
 * entry carries no plain `message` at all — `message` itself is trusted
 * as-is, never run through this.
 */
function htmlCaseLogToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Sorts `entries` ascending by `date`, WITHOUT moving an entry whose date
 * couldn't be parsed (`null`) out of its original array slot. A plain
 * `Array.sort` comparator can't express this correctly: returning `0`
 * whenever either side is null makes the comparator non-transitive (e.g.
 * `cmp(dated, undated) === 0` and `cmp(undated, otherDated) === 0` while
 * `cmp(dated, otherDated) !== 0`), which sort algorithms aren't required to
 * handle consistently — this was tried and failed test/itop/caseLog.test.ts
 * with an unpredictable ordering. Instead: collect only the dated entries'
 * ORIGINAL positions, sort just those entries among themselves, and write
 * them back into those same positions — every undated entry's array index
 * never changes at all.
 */
function sortCaseLogEntries(entries: ItopCaseLogEntry[]): ItopCaseLogEntry[] {
  const result = [...entries];
  const datedIndices: number[] = [];
  const datedEntries: ItopCaseLogEntry[] = [];
  entries.forEach((entry, index) => {
    if (entry.date !== null) {
      datedIndices.push(index);
      datedEntries.push(entry);
    }
  });
  datedEntries.sort((a, b) => {
    const aDate = a.date as string;
    const bDate = b.date as string;
    return aDate < bDate ? -1 : aDate > bDate ? 1 : 0;
  });
  datedIndices.forEach((index, i) => {
    result[index] = datedEntries[i];
  });
  return result;
}

/**
 * Normalises iTop's `public_log`/`private_log` case-log attribute into the
 * shape `ItopTicket.publicLog`/`privateLog` are stored as. iTop answers
 * either `{ entries: [...] }` (each with a `date`, `user_login`, `message`)
 * or, on older versions, a bare string with no structured entries — the
 * latter becomes a single entry with no author. Entries are sorted
 * chronologically ascending BEFORE the cap below — some installs answer
 * newest-first, and capping on iTop's own array order would then keep the
 * OLDEST entries instead of the newest. Capped at the last
 * `MAX_CASE_LOG_ENTRIES` after sorting ("newest last" per the field's own
 * doc comment in types.ts).
 */
export function normalizeCaseLog(raw: ItopCaseLogRaw): ItopCaseLogEntry[] {
  if (!raw) return [];
  if (typeof raw === "string") {
    const message = raw.trim();
    return message ? [{ date: null, author: null, message }] : [];
  }
  const entries = raw.entries ?? [];
  const normalized = entries.map(
    (entry): ItopCaseLogEntry => ({
      date: parseItopDate(entry.date)?.toISOString() ?? null,
      author: entry.user_login ?? null,
      message: entry.message ?? (entry.message_html ? htmlCaseLogToPlainText(entry.message_html) : ""),
    }),
  );
  const sorted = sortCaseLogEntries(normalized);
  return sorted.slice(-MAX_CASE_LOG_ENTRIES);
}

/** `Prisma.JsonNull` when there's nothing to store, else the normalised entries — kept as its own step so `upsertTicket` never stores an empty array. */
function caseLogJson(raw: ItopCaseLogRaw) {
  const entries = normalizeCaseLog(raw);
  return entries.length > 0 ? (entries as unknown as Prisma.InputJsonValue) : Prisma.JsonNull;
}

async function upsertTicket(
  cls: string,
  row: ItopObjectRow<ItopTicketFields>,
  orgIdToCustomerId: Map<number, number>,
): Promise<void> {
  const fields = row.fields;
  const orgId = parseItopInt(fields.org_id);
  if (orgId === null) {
    // orgId is a required (non-nullable) column — a row iTop returns with no
    // usable org_id at all is malformed enough that it can't be stored;
    // throwing here (instead of writing garbage) lets the caller's
    // try/catch count it in SyncSummary.skipped and move on to the next row.
    throw new Error(`iTop ticket ${row.key} (${cls}) has an unusable org_id: ${JSON.stringify(fields.org_id)}`);
  }
  const parsedAgentId = parseItopInt(fields.agent_id);
  const agentPersonId = parsedAgentId !== null && parsedAgentId > 0 ? parsedAgentId : null;

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
    // `tto`/`ttr` store the escalation DEADLINE (a point in time), read from
    // `tto_escalation_deadline`/`ttr_escalation_deadline` — confirmed
    // against a real iTop 3.2.2 install that the bare `tto`/`ttr` attributes
    // are JSON integers (elapsed SLA-clock seconds), not deadlines; reading
    // those through parseItopDate used to crash the whole sync
    // (`value.trim is not a function`). See types.ts's
    // ITOP_TICKET_OUTPUT_FIELDS doc comment.
    tto: parseItopDate(fields.tto_escalation_deadline),
    ttr: parseItopDate(fields.ttr_escalation_deadline),
    slaTtoPassed: parseItopBoolean(fields.sla_tto_passed),
    slaTtrPassed: parseItopBoolean(fields.sla_ttr_passed),
    resolutionDate: parseItopDate(fields.resolution_date),
    publicLog: caseLogJson(fields.public_log),
    privateLog: caseLogJson(fields.private_log),
    syncedAt: new Date(),
  };

  await prisma.itopTicket.upsert({
    where: { id: row.key },
    create: { id: row.key, ...data },
    update: data,
  });
}

/**
 * Upserts a single ticket already fetched from iTop (e.g. the re-read after
 * a Phase 5 action or log write) without requiring the caller to build the
 * full org→customer map `syncTickets` uses — resolves just this row's org.
 * Exported for `routes/itop.ts`'s action/log routes: after a write succeeds,
 * they re-read the ticket with the APPLICATION client and call this so the
 * snapshot reflects iTop's own answer, never a client-side guess.
 */
export async function upsertTicketFromItop(
  cls: string,
  row: ItopObjectRow<ItopTicketFields>,
): Promise<void> {
  const orgId = parseItopInt(row.fields.org_id) ?? 0;
  const customer = orgId > 0 ? await prisma.customer.findUnique({ where: { itopOrgId: orgId }, select: { id: true } }) : null;
  const orgIdToCustomerId = new Map<number, number>(customer ? [[orgId, customer.id]] : []);
  await upsertTicket(cls, row, orgIdToCustomerId);
}

/**
 * `ticketIdByRef` is resolved once per chunk by the caller (a single
 * `findMany({ ref: { in } })` over that chunk's distinct refs) rather than
 * once per row here — this function used to run its own `findUnique` per
 * `TimeSpent` row, an N+1 inside the advisory-lock-guarded transaction.
 */
async function upsertTimeEntry(
  row: ItopObjectRow<ItopTimeSpentFields>,
  itopUserIdToUserId: Map<number, number>,
  orgIdToCustomerId: Map<number, number>,
  ticketIdByRef: Map<string, number>,
): Promise<void> {
  const fields = row.fields;
  const itopUserId = parseItopInt(fields.user_id);
  if (itopUserId === null) {
    // itopUserId is a required (non-nullable) column — same reasoning as
    // upsertTicket's org_id guard: throw so the caller's try/catch counts
    // this row in skipped and moves on, rather than writing garbage.
    throw new Error(`iTop TimeSpent ${row.key} has an unusable user_id: ${JSON.stringify(fields.user_id)}`);
  }
  const rawOrgId = parseItopInt(fields.org_id) ?? 0;
  const orgId = rawOrgId > 0 ? rawOrgId : null;
  const ticketRef = fields[ITOP_TIME_SPENT_TICKET_REF_FIELD] || null;
  const ticketId = ticketRef ? (ticketIdByRef.get(ticketRef) ?? null) : null;

  const durationSeconds = parseItopInt(fields.duration) ?? 0;
  const durationMinutes = Math.round(durationSeconds / (ITOP_TIME_SPENT_DURATION_IN_SECONDS ? 60 : 1));

  const data = {
    itopUserId,
    userId: itopUserIdToUserId.get(itopUserId) ?? null,
    orgId,
    // No org (orgId null, including iTop's 0/unset) has no customer either —
    // Phase 3.2's "not tied to a customer" ("No customer") row relies on
    // customerId being null here, not just absent from orgIdToCustomerId.
    customerId: orgId !== null ? (orgIdToCustomerId.get(orgId) ?? null) : null,
    ticketId,
    ticketRef,
    startDate: parseItopDate(fields.start_date) ?? new Date(),
    endDate: parseItopDate(fields.end_date),
    durationMinutes,
    title: fields.title || null,
    syncedAt: new Date(),
  };

  await prisma.itopTimeEntry.upsert({
    where: { id: row.key },
    create: { id: row.key, ...data },
    update: data,
  });
}

/**
 * Upserts a single `TimeSpent` row already fetched from iTop (Task 7.1: the
 * re-read after `POST /tickets/:id/time`'s own create, under the ACTING
 * USER'S OWN token, succeeds) without requiring the caller to build the
 * full user/org/ticket maps `syncTimeEntries` uses — resolves just this
 * row's own `user_id`/`org_id`/ticket ref. Mirrors `upsertTicketFromItop`'s
 * shape for the same reason: the write route re-reads with the read-only
 * APPLICATION client and calls this so the snapshot reflects iTop's own
 * answer, never a client-side guess of the stored duration/ticket link.
 */
export async function upsertTimeEntryFromItop(row: ItopObjectRow<ItopTimeSpentFields>): Promise<void> {
  const itopUserId = parseItopInt(row.fields.user_id) ?? 0;
  const user = await prisma.user.findUnique({ where: { itopUserId }, select: { id: true } });
  const itopUserIdToUserId = new Map<number, number>(user ? [[itopUserId, user.id]] : []);

  const rawOrgId = parseItopInt(row.fields.org_id) ?? 0;
  const orgId = rawOrgId > 0 ? rawOrgId : null;
  const customer = orgId !== null ? await prisma.customer.findUnique({ where: { itopOrgId: orgId }, select: { id: true } }) : null;
  const orgIdToCustomerId = new Map<number, number>(orgId !== null && customer ? [[orgId, customer.id]] : []);

  const ticketRef = row.fields[ITOP_TIME_SPENT_TICKET_REF_FIELD] || null;
  const ticket = ticketRef ? await prisma.itopTicket.findUnique({ where: { ref: ticketRef }, select: { id: true } }) : null;
  const ticketIdByRef = new Map<string, number>(ticketRef && ticket ? [[ticketRef, ticket.id]] : []);

  await upsertTimeEntry(row, itopUserIdToUserId, orgIdToCustomerId, ticketIdByRef);
}

/**
 * Pulls `TimeSpent` rows (Time Tracking extension) for every Solvro user
 * mapped to an iTop `User` (`User.itopUserId`, active only), for the last 8
 * weeks, upserting into `ItopTimeEntry`. Standalone-callable (own config/
 * error handling, like `syncUsers`) and also invoked by `syncTickets` after
 * its own ticket pass, inside the same advisory-lock-guarded call — the
 * smaller change vs. a separate `syncAll` wrapper, since it means
 * `POST /admin/itop/sync` and `POST /itop/refresh` (both of which call
 * `syncTickets`/`requestSync`) pick up time-entry sync with no route changes.
 * Hours come only from `TimeSpent` — never a ticket's own `time_spent`
 * field, which is a clock, not logged effort (plan §3). iTop errors are
 * caught and returned in `error`, never thrown.
 */
export async function syncTimeEntries(opts: { full?: boolean } = {}): Promise<TimeEntrySyncResult> {
  const full = Boolean(opts.full);
  let upserted = 0;
  let removed = 0;
  let skipped = 0;

  try {
    const config = await getItopConfig();
    if (!isItopConfigured(config)) {
      logger.debug("iTop syncTimeEntries skipped: iTop is not configured");
      return { ran: false, upserted: 0, removed: 0, skipped: 0 };
    }

    const users = await prisma.user.findMany({
      where: { active: true, itopUserId: { not: null } },
      select: { id: true, itopUserId: true },
    });
    const itopUserIdToUserId = new Map<number, number>();
    for (const user of users) {
      if (user.itopUserId !== null) itopUserIdToUserId.set(user.itopUserId, user.id);
    }
    const mappedItopUserIds = [...itopUserIdToUserId.keys()];

    const customers = await prisma.customer.findMany({
      where: { itopOrgId: { not: null } },
      select: { id: true, itopOrgId: true },
    });
    const orgIdToCustomerId = new Map(customers.map((c) => [c.itopOrgId as number, c.id]));

    const cutoff = new Date(Date.now() - TIME_ENTRY_WINDOW_MS);
    const seenIds = new Set<number>();
    // Tracked across the whole run (not per chunk) so one real "the ref
    // field name is wrong on this install" condition produces one warning,
    // not one per chunk.
    let rowsWithRef = 0;
    let rowsWithResolvedRef = 0;

    if (mappedItopUserIds.length > 0) {
      const client = await getItopAppClient();
      for (const idsChunk of chunk(mappedItopUserIds, CHUNK_SIZE)) {
        const oql = `SELECT TimeSpent WHERE user_id IN (${idsChunk.join(",")}) AND start_date >= '${formatItopDate(cutoff)}'`;
        const result = await client.getAll<ItopTimeSpentFields>("TimeSpent", oql, ITOP_TIME_SPENT_OUTPUT_FIELDS, {
          pageSize: 100,
        });

        // Resolve this chunk's distinct ticket refs with one query instead
        // of one `findUnique` per row (was an N+1 inside the
        // advisory-lock-guarded transaction).
        const refs = [
          ...new Set(
            result.objects
              .map((row) => row.fields[ITOP_TIME_SPENT_TICKET_REF_FIELD])
              .filter((ref): ref is string => Boolean(ref)),
          ),
        ];
        const tickets =
          refs.length > 0
            ? await prisma.itopTicket.findMany({ where: { ref: { in: refs } }, select: { id: true, ref: true } })
            : [];
        const ticketIdByRef = new Map(tickets.map((t) => [t.ref, t.id]));

        for (const row of result.objects) {
          seenIds.add(row.key);
          const ref = row.fields[ITOP_TIME_SPENT_TICKET_REF_FIELD];
          if (ref) {
            rowsWithRef += 1;
            if (ticketIdByRef.has(ref)) rowsWithResolvedRef += 1;
          }
          try {
            await upsertTimeEntry(row, itopUserIdToUserId, orgIdToCustomerId, ticketIdByRef);
            upserted += 1;
          } catch (err) {
            skipped += 1;
            logger.warn(
              { err: errorMessage(err), timeEntryId: row.key },
              "iTop syncTimeEntries: skipping a TimeSpent row that failed to upsert",
            );
          }
        }
      }
    }

    if (rowsWithRef > 0 && rowsWithResolvedRef === 0) {
      // Every row carried a ref, and not one matched a known ItopTicket —
      // more likely the real install's Time Tracking extension names the
      // ticket-ref attribute differently than
      // `ITOP_TIME_SPENT_TICKET_REF_FIELD` assumes than that all of them are
      // genuinely orphaned (plan §5 risk: "Time Tracking schema differs").
      logger.warn(
        { rowsWithRef, field: ITOP_TIME_SPENT_TICKET_REF_FIELD },
        "iTop syncTimeEntries: no TimeSpent row's ticket ref resolved to a known ticket — check ITOP_TIME_SPENT_TICKET_REF_FIELD against this install",
      );
    }

    if (full) {
      // Two independent reasons a snapshot row within the pull window no
      // longer belongs: (a) its iTop user is no longer mapped to any active
      // Solvro user at all, or (b) iTop didn't return it this run (edited/
      // deleted upstream). Both are bounded to `startDate >= cutoff` — a
      // transient unmapping (an email edit, a deactivation, iTop briefly
      // dropping a Person) must not delete history *older* than the pull
      // window, since that history can never be re-fetched to restore it.
      const deleted = await prisma.itopTimeEntry.deleteMany({
        where: {
          AND: [
            { startDate: { gte: cutoff } },
            { OR: [{ itopUserId: { notIn: mappedItopUserIds } }, { id: { notIn: [...seenIds] } }] },
          ],
        },
      });
      removed = deleted.count;
    }

    return { ran: true, upserted, removed, skipped };
  } catch (err) {
    const message = errorMessage(err);
    logger.warn({ err: message }, "iTop syncTimeEntries failed");
    return { ran: true, upserted, removed, skipped, error: message };
  }
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
  let ticketsSkipped = 0;
  let timeEntriesUpserted = 0;
  let timeEntriesRemoved = 0;
  let timeEntriesSkipped = 0;
  let timeEntriesError: string | undefined;
  let runError: string | undefined;

  await prisma.$transaction(
    async (tx) => {
      // This interactive transaction exists SOLELY to hold
      // `pg_try_advisory_xact_lock` — `_xact` self-releases at COMMIT/
      // ROLLBACK, so there's no matching unlock statement to remember and no
      // risk of leaking the lock if the process dies mid-sync. Every
      // per-row query below (config reads, ticket/time-entry upserts, the
      // full-sync deletes) deliberately uses the module-level `prisma`
      // client on the normal pooled connections, NOT `tx` — a single row's
      // Postgres error (e.g. a unique-constraint violation) must reject only
      // that row's own statement, caught by its own try/catch, rather than
      // poisoning this transaction and aborting the advisory lock along with
      // every other row still to come.
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
              try {
                await upsertTicket(cls, row, orgIdToCustomerId);
                upserted += 1;
              } catch (err) {
                ticketsSkipped += 1;
                logger.warn(
                  { err: errorMessage(err), ticketId: row.key, cls },
                  "iTop sync: skipping a ticket that failed to upsert",
                );
              }
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

        // Time entries after tickets, inside the same advisory-lock-guarded
        // call — see syncTimeEntries's own doc comment for why this is the
        // chosen wiring over a separate syncAll(). A time-entry-only failure
        // (e.g. TimeSpent missing on this install) is logged but doesn't
        // fail the ticket sync that already succeeded above.
        const timeEntryResult = await syncTimeEntries({ full });
        timeEntriesUpserted = timeEntryResult.upserted;
        timeEntriesRemoved = timeEntryResult.removed;
        timeEntriesSkipped = timeEntryResult.skipped;
        timeEntriesError = timeEntryResult.error;
        if (timeEntriesError) {
          logger.warn({ err: timeEntriesError }, "iTop syncTimeEntries failed during the ticket sync tick");
        }

        const totalSkipped = ticketsSkipped + timeEntriesSkipped;
        // The run still succeeded (lastSyncOk stays true) — a skipped row is
        // logged individually at `warn` already — but an admin watching only
        // ItopConfig would otherwise have no visibility into it at all.
        // Folded into `lastSyncError` as a non-fatal note rather than a
        // schema change (no dedicated column): NOT an error, just the only
        // admin-visible surface this integration has for "some rows didn't
        // make it, check the server log".
        const nonFatalNote =
          totalSkipped > 0
            ? `Skipped ${totalSkipped} row${totalSkipped === 1 ? "" : "s"} that could not be read (see server log)`
            : null;
        await writeConfigResult(startedAt, true, nonFatalNote, full);
        logger.info(
          {
            full,
            orgs,
            upserted,
            removed,
            usersMatched,
            skipped: totalSkipped,
            timeEntriesUpserted,
            timeEntriesRemoved,
            timeEntriesError,
            ms: Date.now() - startedAt.getTime(),
          },
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
    skipped: ticketsSkipped + timeEntriesSkipped,
    timeEntriesUpserted,
    timeEntriesRemoved,
    timeEntriesError,
    error: runError,
  };
}
