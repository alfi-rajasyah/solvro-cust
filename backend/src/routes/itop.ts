// Tickets API for the iTop integration: connection status for the frontend's
// "Open in iTop" links, a customer's ticket list + counts for the Tickets
// tab, single-ticket lookup, a debounced manual Refresh trigger, the Daily
// Review strip's per-day, per-customer digest (GET /daily), — Phase 5 — the
// write path: lifecycle actions and case-log entries, and — Phase 6 — the
// "New ticket" sheet's picklists and creation route, all under the ACTING
// USER'S OWN personal token, never the application token and never another
// user's (docs/plans/itop-integration.md §1 decision 8). All routes are
// authed (no admin gate — any authed user with visibility into the customer
// can read its tickets; write routes additionally require their own token
// and `ItopConfig.actionsEnabled`). Visibility reuses lib/visibility.ts's
// ensureCustomerVisible/customerVisibilityFilter — never re-derived here —
// so a customer hidden from the caller 404s (or is silently excluded from a
// list) the same way every other customer-nested route does. Mounted at
// /itop in src/app.ts. See docs/archive/plans/itop-integration.md Tasks 1.7,
// 2.1, 5.3, 6.2.
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { logger } from "../logger.js";
import { requireAuth, type JwtPayload } from "../http/auth.js";
import { HttpError } from "../http/errors.js";
import { validate } from "../http/validate.js";
import { ensureCustomerVisible, customerVisibilityFilter, isCustomerVisible } from "../lib/visibility.js";
import { getItopAppClient, getItopConfig, isItopConfigured, makeItopClient } from "../lib/itop/config.js";
import { requestSync } from "../lib/itop/scheduler.js";
import { open, SecretBoxError } from "../lib/secretBox.js";
import { ItopError, type ItopGetResult, type ItopObjectRow } from "../lib/itop/client.js";
import { upsertTicketFromItop } from "../lib/itop/sync.js";
import {
  ITOP_LNK_PERSON_TO_TEAM_OUTPUT_FIELDS,
  ITOP_PERSON_OUTPUT_FIELDS,
  ITOP_SERVICE_OUTPUT_FIELDS,
  ITOP_TICKET_CLASSES,
  ITOP_TICKET_OUTPUT_FIELDS,
  type ItopCaseLogEntry,
  type ItopLnkPersonToTeamFields,
  type ItopPersonFields,
  type ItopServiceFields,
  type ItopTicketClass,
  type ItopTicketFields,
} from "../lib/itop/types.js";
import { weekKeyOf, parseWeekKey } from "../lib/isoWeek.js";
import { isValidDayString, utcMidnightOfDayString } from "../lib/dateBoundary.js";
import type { ItopTicket } from "@prisma/client";

export const itopRouter = Router();

itopRouter.use(requireAuth);

// ---- Shared helpers ---------------------------------------------------------

const RESOLVED_STATUSES = ["resolved", "closed"];

/** UTC midnight of the Monday of the ISO week containing "now". Reuses the
 * shared ISO-week helper (lib/isoWeek.ts) rather than re-deriving Monday
 * arithmetic here. */
function currentIsoWeekStart(): Date {
  const todayDay = new Date().toISOString().slice(0, 10);
  const week = parseWeekKey(weekKeyOf(todayDay));
  if (!week) throw new Error(`unreachable: weekKeyOf(${todayDay}) produced an unparseable key`);
  return utcMidnightOfDayString(week.start);
}

/** `[]` (never `null`) when there's nothing stored — Phase 5 case-log entries, normalised by `lib/itop/sync.ts#normalizeCaseLog` at sync/write time. */
function caseLogRows(value: Prisma.JsonValue | null | undefined): ItopCaseLogEntry[] {
  return (value as unknown as ItopCaseLogEntry[] | null) ?? [];
}

/**
 * The columns `toTicketRow` reads when NOT asked for logs. Used as an
 * explicit Prisma `select` on the list route below, which can return up to
 * 500 rows per request and polls every 60s — pulling `publicLog`/
 * `privateLog` (unbounded JSONB, never used by that response) for every row
 * of every poll wasted bandwidth and DB work for nothing the caller reads.
 * `omit` (Prisma 5.22, `omitApi` preview) isn't enabled in schema.prisma's
 * generator block, so this is an explicit `select` instead.
 */
const TICKET_ROW_SELECT = {
  id: true,
  class: true,
  ref: true,
  title: true,
  status: true,
  operationalStatus: true,
  priority: true,
  agentPersonId: true,
  agentName: true,
  teamName: true,
  serviceName: true,
  callerName: true,
  startDate: true,
  lastUpdate: true,
  tto: true,
  ttr: true,
  slaTtoPassed: true,
  slaTtrPassed: true,
  resolutionDate: true,
} satisfies Prisma.ItopTicketSelect;

/** Structural shape `toTicketRow` needs — satisfied by a full `ItopTicket` row (the single-ticket and write routes, which pass `withLogs: true`) as well as by the `TICKET_ROW_SELECT`-shaped partial rows the list/daily routes fetch (which never do). */
type TicketRowSource = Pick<ItopTicket, keyof typeof TICKET_ROW_SELECT> & {
  publicLog?: Prisma.JsonValue | null;
  privateLog?: Prisma.JsonValue | null;
};

/**
 * `withLogs` gates `publicLog`/`privateLog` on the response — deliberately
 * off by default. List/daily payloads can return hundreds of tickets at
 * once; case logs are unbounded text and only ever needed one ticket at a
 * time (the single-ticket routes and the Phase 5 write routes, which all
 * pass `{ withLogs: true }` explicitly, and fetch the full row so the log
 * columns are actually there to read).
 */
function toTicketRow(ticket: TicketRowSource, myItopPersonId: number | null, options: { withLogs?: boolean } = {}) {
  return {
    id: ticket.id,
    class: ticket.class,
    ref: ticket.ref,
    title: ticket.title,
    status: ticket.status,
    operationalStatus: ticket.operationalStatus,
    priority: ticket.priority,
    agentPersonId: ticket.agentPersonId,
    agentName: ticket.agentName,
    teamName: ticket.teamName,
    serviceName: ticket.serviceName,
    callerName: ticket.callerName,
    startDate: ticket.startDate,
    lastUpdate: ticket.lastUpdate,
    tto: ticket.tto,
    ttr: ticket.ttr,
    slaTtoPassed: ticket.slaTtoPassed,
    slaTtrPassed: ticket.slaTtrPassed,
    resolutionDate: ticket.resolutionDate,
    isMine: myItopPersonId !== null && ticket.agentPersonId === myItopPersonId,
    ...(options.withLogs
      ? { publicLog: caseLogRows(ticket.publicLog), privateLog: caseLogRows(ticket.privateLog) }
      : {}),
  };
}

async function getMyItopPersonId(userId: number): Promise<number | null> {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { itopPersonId: true } });
  return me?.itopPersonId ?? null;
}

const emptyCounts = { ongoing: 0, resolvedWeek: 0, mine: 0, incidents: 0, requests: 0 };

// ---- GET /status -------------------------------------------------------------

// lastSyncError is deliberately withheld here — it's iTop's raw error text
// (can name internal hosts/paths) and this route has no admin gate, unlike
// GET /admin/itop/settings, which does expose it to admins.
itopRouter.get("/status", async (_req, res) => {
  const config = await getItopConfig();
  res.json({
    configured: isItopConfigured(config),
    baseUrl: config.baseUrl,
    lastSyncAt: config.lastSyncAt,
    lastSyncOk: config.lastSyncOk,
    refreshMinutes: config.refreshMinutes,
    actionsEnabled: config.actionsEnabled,
  });
});

// ---- GET /customers/:id/tickets ----------------------------------------------

const customerIdParamSchema = z.object({ id: z.coerce.number().int().positive() });

const ticketsQuerySchema = z.object({
  scope: z.enum(["ongoing", "resolved_week", "mine"]).default("ongoing"),
  class: z.enum([...ITOP_TICKET_CLASSES] as [ItopTicketClass, ...ItopTicketClass[]]).optional(),
});

itopRouter.get(
  "/customers/:id/tickets",
  validate("params", customerIdParamSchema),
  validate("query", ticketsQuerySchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof customerIdParamSchema>;
    const { scope, class: cls } = req.query as unknown as z.infer<typeof ticketsQuerySchema>;

    await ensureCustomerVisible(req.user!, id);

    const customer = await prisma.customer.findUnique({
      where: { id },
      select: { itopOrgId: true, itopOrgName: true },
    });
    if (!customer) throw new HttpError(404, "customer_not_found", "Customer not found");

    if (customer.itopOrgId === null) {
      res.json({ mapped: false, tickets: [], counts: emptyCounts, syncedAt: null });
      return;
    }

    const myItopPersonId = await getMyItopPersonId(req.user!.sub);

    const baseWhere: Prisma.ItopTicketWhereInput = {
      customerId: id,
      ...(cls ? { class: cls } : {}),
    };
    // Unfiltered by `class` on purpose — the incidents/requests chips (below)
    // report the customer's whole ongoing set broken down by class, so a
    // `?class=Incident` request doesn't zero out the "requests" chip; only
    // the ticket list and the `ongoing`/`resolvedWeek`/`mine` scope counts
    // narrow to the requested class.
    const ongoingAllClassesWhere: Prisma.ItopTicketWhereInput = {
      customerId: id,
      status: { notIn: RESOLVED_STATUSES },
    };
    const ongoingWhere: Prisma.ItopTicketWhereInput = {
      ...baseWhere,
      status: { notIn: RESOLVED_STATUSES },
    };
    const resolvedWeekWhere: Prisma.ItopTicketWhereInput = {
      ...baseWhere,
      resolutionDate: { gte: currentIsoWeekStart() },
    };
    const mineWhere: Prisma.ItopTicketWhereInput = {
      ...ongoingWhere,
      agentPersonId: myItopPersonId ?? -1, // -1: no iTop person → never matches, same as "no mine tickets"
    };

    let where: Prisma.ItopTicketWhereInput;
    if (scope === "resolved_week") where = resolvedWeekWhere;
    else if (scope === "mine") where = mineWhere;
    else where = ongoingWhere;

    const [ongoingCount, classBreakdown, resolvedWeekCount, mineCount, tickets, syncedAgg] = await Promise.all([
      prisma.itopTicket.count({ where: ongoingWhere }),
      prisma.itopTicket.groupBy({ by: ["class"], where: ongoingAllClassesWhere, _count: { _all: true } }),
      prisma.itopTicket.count({ where: resolvedWeekWhere }),
      myItopPersonId !== null ? prisma.itopTicket.count({ where: mineWhere }) : Promise.resolve(0),
      prisma.itopTicket.findMany({
        where,
        orderBy: [{ slaTtrPassed: "desc" }, { lastUpdate: "desc" }],
        take: 500,
        select: TICKET_ROW_SELECT,
      }),
      prisma.itopTicket.aggregate({ where: { customerId: id }, _max: { syncedAt: true } }),
    ]);

    const incidents = classBreakdown.find((row) => row.class === "Incident")?._count._all ?? 0;
    const requests = classBreakdown.find((row) => row.class === "UserRequest")?._count._all ?? 0;

    const config = await getItopConfig();
    const syncedAt = syncedAgg._max.syncedAt ?? config.lastSyncAt;

    res.json({
      mapped: true,
      orgName: customer.itopOrgName,
      tickets: tickets.map((t) => toTicketRow(t, myItopPersonId)),
      counts: { ongoing: ongoingCount, resolvedWeek: resolvedWeekCount, mine: mineCount, incidents, requests },
      syncedAt,
    });
  },
);

// ---- GET /tickets/:id ---------------------------------------------------------

const ticketIdParamSchema = z.object({ id: z.coerce.number().int().positive() });

itopRouter.get(
  "/tickets/:id",
  validate("params", ticketIdParamSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof ticketIdParamSchema>;

    const ticket = await prisma.itopTicket.findUnique({ where: { id } });
    if (!ticket || ticket.customerId === null) {
      throw new HttpError(404, "not_found", "Ticket not found");
    }

    await ensureCustomerVisible(req.user!, ticket.customerId);

    const myItopPersonId = await getMyItopPersonId(req.user!.sub);
    res.json(toTicketRow(ticket, myItopPersonId, { withLogs: true }));
  },
);

// ---- GET /tickets/by-ref/:ref --------------------------------------------------

// Resolves a task's pinned itopTicketRef (routes/tasks.ts,
// Task.itopTicketRef) against the local snapshot, e.g. for the task panel's
// ticket chip. Same shape and visibility rule as GET /tickets/:id — 404
// for unknown, hidden, or unmapped (no customer link) refs, so a task with
// a ref for a ticket outside the snapshot degrades to "not in snapshot"
// rather than leaking a distinguishable error. See
// docs/archive/plans/itop-integration.md Task 4.2.
const ticketRefParamSchema = z.object({ ref: z.string().min(1) });

itopRouter.get(
  "/tickets/by-ref/:ref",
  validate("params", ticketRefParamSchema),
  async (req, res) => {
    const { ref } = req.params as unknown as z.infer<typeof ticketRefParamSchema>;

    const ticket = await prisma.itopTicket.findUnique({ where: { ref } });
    if (!ticket || ticket.customerId === null) {
      throw new HttpError(404, "not_found", "Ticket not found");
    }

    await ensureCustomerVisible(req.user!, ticket.customerId);

    const myItopPersonId = await getMyItopPersonId(req.user!.sub);
    res.json(toTicketRow(ticket, myItopPersonId, { withLogs: true }));
  },
);

// ---- POST /refresh -------------------------------------------------------------

const refreshBodySchema = z.object({ customerId: z.number().int().positive().optional() });

// Module-level, per-process: at most one accepted (non-cooldown) /refresh per
// 10s, matching the scheduler's own debounce window (lib/itop/scheduler.ts).
// Deliberately simple (no per-user tracking) — Task 1.7's rate limit is
// "one accepted request per 10s per process", mirroring requestSync's own
// trailing debounce so a mashed Refresh button collapses the same way.
let lastAcceptedRefreshAt = 0;
const REFRESH_COOLDOWN_MS = 10_000;

itopRouter.post(
  "/refresh",
  validate("body", refreshBodySchema),
  async (req, res) => {
    const { customerId } = req.body as z.infer<typeof refreshBodySchema>;
    if (customerId !== undefined) {
      await ensureCustomerVisible(req.user!, customerId);
    }

    const config = await getItopConfig();
    if (!isItopConfigured(config)) {
      throw new HttpError(409, "itop_not_configured", "iTop is not connected. An admin must set the iTop URL and application token.");
    }

    const now = Date.now();
    if (now - lastAcceptedRefreshAt < REFRESH_COOLDOWN_MS) {
      res.status(202).json({ requested: false, reason: "cooldown" });
      return;
    }
    lastAcceptedRefreshAt = now;

    // Manual Refresh is always a full pull (plan §2 deviation 8 / §5) — it
    // also drops tickets iTop no longer returns, which an incremental tick
    // never does. The 10s cooldown above bounds how often this can fire.
    requestSync({ full: true });
    res.status(202).json({ requested: true, lastSyncAt: config.lastSyncAt });
  },
);

// ---- GET /daily -------------------------------------------------------------

// Daily Review strip (Task 2.1): one row per customer the caller can see AND
// that's mapped to an iTop org, with same-day counts and up to 3 recent
// tickets. The `date` string itself still follows the shared UTC-midnight
// date contract (lib/dateBoundary.ts,
// docs/archive/plans/date-contract-utc-midnight.md) — same choke point the
// Daily Review page itself uses for "today". User decision (2026-09-22):
// "today" for this strip means the VIEWER'S LOCAL calendar day, not the UTC
// one, so the 24h window that positions `date` against ticket instants
// (`startDate`/`resolutionDate`, both stored as absolute UTC instants) is
// shifted by the caller-supplied `utcOffsetMinutes` (local minus UTC, e.g.
// UTC+7 sends 420) before being handed to `utcMidnightOfDayString` — the
// date contract's own boundary function is still the single source of the
// UTC-midnight instant; only the window's position relative to it moves.
const dailyQuerySchema = z.object({
  date: z.string().refine(isValidDayString, { message: "invalid_date" }),
  // Local minus UTC, e.g. UTC+7 sends 420, UTC-5 sends -300. Bounded to the
  // real range of UTC offsets in use (UTC-12 to UTC+14, in minutes) so a
  // garbage value 400s instead of silently producing a nonsense window.
  utcOffsetMinutes: z.coerce.number().int().min(-840).max(840).default(0),
});

itopRouter.get(
  "/daily",
  validate("query", dailyQuerySchema),
  async (req, res) => {
    const { date, utcOffsetMinutes } = req.query as unknown as z.infer<typeof dailyQuerySchema>;
    const user = req.user!;

    const config = await getItopConfig();
    if (!isItopConfigured(config)) {
      res.json({ configured: false, date, utcOffsetMinutes, customers: [] });
      return;
    }

    // Visible AND mapped (itopOrgId set) — an unmapped customer has no
    // tickets to show and would otherwise render an empty, confusing row.
    const customers = await prisma.customer.findMany({
      where: { AND: [customerVisibilityFilter(user), { itopOrgId: { not: null } }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true, itopOrgName: true },
    });

    if (customers.length === 0) {
      res.json({ configured: true, date, utcOffsetMinutes, customers: [] });
      return;
    }

    const customerIds = customers.map((c) => c.id);
    const myItopPersonId = await getMyItopPersonId(user.sub);

    // Shift UTC midnight of `date` back by the viewer's UTC offset so the
    // 24h window brackets THEIR local calendar day (in UTC instants) rather
    // than the UTC one — e.g. UTC+7 (utcOffsetMinutes: 420): local midnight
    // 2026-09-22 is the UTC instant 2026-09-21T17:00:00Z, 7h before UTC
    // midnight of the same date string.
    const dayStart = new Date(utcMidnightOfDayString(date).getTime() - utcOffsetMinutes * 60_000);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const newTodayWhere: Prisma.ItopTicketWhereInput = {
      customerId: { in: customerIds },
      startDate: { gte: dayStart, lt: dayEnd },
    };
    const resolvedTodayWhere: Prisma.ItopTicketWhereInput = {
      customerId: { in: customerIds },
      resolutionDate: { gte: dayStart, lt: dayEnd },
    };
    // "ongoing" mirrors /customers/:id/tickets' own ongoing scope (status
    // not in RESOLVED_STATUSES) — slaBreached is a further-filtered subset
    // of the same set, computed as its own groupBy since Prisma's groupBy
    // has no conditional (CASE WHEN-style) aggregate.
    const ongoingWhere: Prisma.ItopTicketWhereInput = {
      customerId: { in: customerIds },
      status: { notIn: RESOLVED_STATUSES },
    };
    const slaBreachedWhere: Prisma.ItopTicketWhereInput = {
      ...ongoingWhere,
      OR: [{ slaTtoPassed: true }, { slaTtrPassed: true }],
    };

    // True per-customer top 3, not a global cap: a window-function query so
    // a customer with few, quiet tickets can never be starved of all its
    // `recent` rows by another visible customer with hundreds of
    // more-recently-updated ones (a plain `ORDER BY lastUpdate DESC LIMIT N`
    // across every in-scope customer combined would do exactly that — the
    // strip would then show "N ongoing" with zero recent rows for the quiet
    // customer). One query for every in-scope customer at once (never a
    // per-customer query, still Task 2.1's "~4 queries plus one" budget).
    const [newTodayGroups, resolvedTodayGroups, ongoingGroups, slaBreachedGroups, syncedAtGroups, recentTickets] =
      await Promise.all([
        prisma.itopTicket.groupBy({ by: ["customerId"], where: newTodayWhere, _count: { _all: true } }),
        prisma.itopTicket.groupBy({ by: ["customerId"], where: resolvedTodayWhere, _count: { _all: true } }),
        prisma.itopTicket.groupBy({ by: ["customerId"], where: ongoingWhere, _count: { _all: true } }),
        prisma.itopTicket.groupBy({ by: ["customerId"], where: slaBreachedWhere, _count: { _all: true } }),
        prisma.itopTicket.groupBy({
          by: ["customerId"],
          where: { customerId: { in: customerIds } },
          _max: { syncedAt: true },
        }),
        prisma.$queryRaw<ItopTicket[]>(Prisma.sql`
          SELECT
            id, class, ref, title, status,
            operational_status AS "operationalStatus",
            priority,
            agent_person_id AS "agentPersonId",
            agent_name AS "agentName",
            team_name AS "teamName",
            service_name AS "serviceName",
            caller_name AS "callerName",
            org_id AS "orgId",
            customer_id AS "customerId",
            start_date AS "startDate",
            last_update AS "lastUpdate",
            tto, ttr,
            sla_tto_passed AS "slaTtoPassed",
            sla_ttr_passed AS "slaTtrPassed",
            resolution_date AS "resolutionDate",
            synced_at AS "syncedAt"
          FROM (
            SELECT
              *,
              ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY last_update DESC, id DESC) AS rn
            FROM itop_tickets
            WHERE customer_id IN (${Prisma.join(customerIds)})
          ) ranked
          WHERE rn <= 3
          ORDER BY customer_id, last_update DESC, id DESC
        `),
      ]);

    const countMap = (rows: { customerId: number | null; _count: { _all: number } }[]) => {
      const m = new Map<number, number>();
      for (const r of rows) if (r.customerId !== null) m.set(r.customerId, r._count._all);
      return m;
    };
    const newTodayMap = countMap(newTodayGroups);
    const resolvedTodayMap = countMap(resolvedTodayGroups);
    const ongoingMap = countMap(ongoingGroups);
    const slaBreachedMap = countMap(slaBreachedGroups);

    const syncedAtMap = new Map<number, Date | null>();
    for (const r of syncedAtGroups) if (r.customerId !== null) syncedAtMap.set(r.customerId, r._max.syncedAt);

    // The raw query above already caps each customer at 3 rows (rn <= 3)
    // and orders them lastUpdate desc — this just buckets the already-capped,
    // already-ordered rows by customer, no further slicing needed.
    const recentByCustomer = new Map<number, ItopTicket[]>();
    for (const t of recentTickets) {
      if (t.customerId === null) continue;
      const bucket = recentByCustomer.get(t.customerId);
      if (bucket) bucket.push(t);
      else recentByCustomer.set(t.customerId, [t]);
    }

    res.json({
      configured: true,
      date,
      utcOffsetMinutes,
      customers: customers.map((c) => ({
        customerId: c.id,
        customerName: c.name,
        orgName: c.itopOrgName,
        counts: {
          newToday: newTodayMap.get(c.id) ?? 0,
          resolvedToday: resolvedTodayMap.get(c.id) ?? 0,
          slaBreached: slaBreachedMap.get(c.id) ?? 0,
          ongoing: ongoingMap.get(c.id) ?? 0,
        },
        recent: (recentByCustomer.get(c.id) ?? []).map((t) => toTicketRow(t, myItopPersonId)),
        syncedAt: syncedAtMap.get(c.id) ?? config.lastSyncAt,
      })),
    });
  },
);

// ---- Phase 5 write path: actions + case-log entries -------------------------
//
// Every write below runs under the ACTING USER'S OWN personal token
// (backend/src/routes/itopUser.ts, `User.itopTokenEnc`) — never
// `ItopConfig.appTokenEnc` (read-only, lib/itop/config.ts#getItopAppClient)
// and never another user's token. iTop's own rights on that token/person
// apply as-is; Solvro adds no permission of its own for tickets (plan §3
// "Security"). After a write succeeds, the ticket is re-read with the
// APPLICATION client (read-only is enough for a read) and upserted into the
// snapshot, so the response always reflects iTop's own answer — never a
// client-side guess of the new status. See
// docs/archive/plans/itop-integration.md Task 5.3.

const TRANSPORT_ITOP_ERROR_CODES = new Set<unknown>(["http", "timeout", "network", "parse"]);

/**
 * Maps an iTop write failure to the HTTP shape Task 5.3 promises: a
 * transport failure is a 502, a rejected/invalid token is a 403, and any
 * other application-level refusal (a lifecycle rule, a missing mandatory
 * field, ...) is a 409 carrying iTop's own message VERBATIM — Solvro never
 * rewrites it, since the admin's own install (plan §6 item 10) is the
 * authority on what each stimulus requires.
 */
function mapItopWriteError(err: unknown): never {
  if (err instanceof ItopError) {
    if (TRANSPORT_ITOP_ERROR_CODES.has(err.code)) {
      throw new HttpError(502, "itop_unreachable", err.message);
    }
    if (err.code === 1) {
      throw new HttpError(403, "itop_token_invalid", err.message);
    }
    throw new HttpError(409, "itop_refused", err.message);
  }
  throw err;
}

interface WritableTicketContext {
  ticket: ItopTicket;
  token: string;
  myItopPersonId: number | null;
  baseUrl: string;
}

/**
 * Shared preconditions for every Phase 5 write route, checked in this exact
 * order (Task 5.3): the integration's write switch, then the ticket's own
 * visibility (404 either way, same as the read routes — never reveal a
 * hidden ticket exists), then that the caller has a personal token at all,
 * then that it can actually be decrypted.
 */
async function loadWritableTicket(userSub: number, ticketId: number, user: JwtPayload): Promise<WritableTicketContext> {
  const config = await getItopConfig();
  if (!config.actionsEnabled) {
    throw new HttpError(404, "not_found", "Not found");
  }

  const ticket = await prisma.itopTicket.findUnique({ where: { id: ticketId } });
  if (!ticket || ticket.customerId === null) {
    throw new HttpError(404, "not_found", "Ticket not found");
  }
  await ensureCustomerVisible(user, ticket.customerId);

  const me = await prisma.user.findUnique({
    where: { id: userSub },
    select: { itopTokenEnc: true, itopPersonId: true },
  });
  if (!me?.itopTokenEnc) {
    throw new HttpError(403, "itop_token_missing", "Add your personal iTop token in Settings");
  }

  let token: string;
  try {
    token = open(me.itopTokenEnc);
  } catch (err) {
    if (err instanceof SecretBoxError) {
      throw new HttpError(
        403,
        "itop_token_unreadable",
        "Your saved iTop token could not be decrypted (SECRETS_KEY changed?) — enter it again in Settings.",
      );
    }
    throw err;
  }

  if (!config.baseUrl) {
    throw new HttpError(409, "itop_not_configured", "iTop is not connected. An admin must set the iTop URL first.");
  }

  return { ticket, token, myItopPersonId: me.itopPersonId, baseUrl: config.baseUrl };
}

/**
 * Re-reads a ticket from iTop with the read-only APPLICATION client after a
 * write under the user's token succeeded, and upserts it into the snapshot —
 * the single place every Phase 5 write route gets its "iTop's own answer"
 * from. Falls back to the pre-write snapshot row (never throws) if iTop no
 * longer returns the ticket, which a write itself succeeding makes very
 * unlikely but not impossible (e.g. deleted concurrently). Throws on any
 * OTHER re-read failure — `reReadAfterWrite` below is the one every write
 * route actually calls, and turns that throw into a safe fallback instead
 * of a 500.
 */
async function reReadAndUpsertTicket(cls: string, ticketId: number): Promise<ItopTicket> {
  const appClient = await getItopAppClient();
  const result = await appClient.get<ItopTicketFields>(cls, ticketId, ITOP_TICKET_OUTPUT_FIELDS);
  const row = result.objects[0];
  if (row) {
    await upsertTicketFromItop(cls, { key: ticketId, class: cls, fields: row.fields });
  }
  return prisma.itopTicket.findUniqueOrThrow({ where: { id: ticketId } });
}

/**
 * The write itself (`apply_stimulus`/`update` under the user's own token)
 * has ALREADY SUCCEEDED by the time this runs — a failure here (app token
 * unreadable, iTop briefly unreachable, ...) must never surface as a 500
 * that invites a client retry, since retrying would re-fire the stimulus or
 * double-append the log entry. On failure: log a warning and answer with
 * the PRE-write snapshot row (`fallback`) plus `staleAfterWrite: true`, so
 * the caller knows the write took but the displayed row may be one write
 * behind until the next sync.
 */
async function reReadAfterWrite(
  cls: string,
  ticketId: number,
  fallback: ItopTicket,
): Promise<{ ticket: ItopTicket; staleAfterWrite: boolean }> {
  try {
    const ticket = await reReadAndUpsertTicket(cls, ticketId);
    return { ticket, staleAfterWrite: false };
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), ticketId, cls },
      "iTop re-read after a successful write failed — answering with the pre-write snapshot; the write itself already succeeded and must not be retried",
    );
    return { ticket: fallback, staleAfterWrite: true };
  }
}

// ---- POST /tickets/:id/actions -----------------------------------------------

const actionBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("assign_to_me"),
    fields: z.object({ team_id: z.coerce.number().int().positive().optional() }).optional(),
  }),
  z.object({
    action: z.literal("pending"),
    fields: z.object({ pending_reason: z.union([z.string(), z.number()]).optional() }).optional(),
  }),
  z.object({
    action: z.literal("resolve"),
    fields: z.object({ resolution_code: z.string().min(1), solution: z.string().min(1) }),
  }),
  // ev_close/ev_reopen take no fields on the DEFAULT lifecycle (plan §1
  // decision 9) — `.strict()` rejects anything smuggled in rather than
  // silently accepting and discarding it.
  z.object({ action: z.literal("close"), fields: z.object({}).strict().optional() }),
  z.object({ action: z.literal("reopen"), fields: z.object({}).strict().optional() }),
]);

itopRouter.post(
  "/tickets/:id/actions",
  validate("params", ticketIdParamSchema),
  validate("body", actionBodySchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof ticketIdParamSchema>;
    const body = req.body as z.infer<typeof actionBodySchema>;

    const { ticket, token, myItopPersonId, baseUrl } = await loadWritableTicket(req.user!.sub, id, req.user!);
    const client = makeItopClient(baseUrl, token);

    let stimulus: string;
    let stimulusFields: Record<string, unknown> = {};

    if (body.action === "assign_to_me") {
      if (myItopPersonId === null) {
        throw new HttpError(
          403,
          "itop_person_unmatched",
          "Your Solvro account isn't matched to an iTop person yet — save your personal token in Settings first.",
        );
      }

      // Always resolved from iTop, even when the caller supplied a team_id —
      // a caller-supplied id is corroborated against the caller's OWN teams
      // rather than trusted outright, so a request can't assign a ticket to
      // a team its author isn't actually a member of.
      let teamsResult: ItopGetResult<ItopLnkPersonToTeamFields>;
      try {
        teamsResult = await client.get<ItopLnkPersonToTeamFields>(
          "lnkPersonToTeam",
          `SELECT lnkPersonToTeam WHERE person_id = ${myItopPersonId}`,
          ITOP_LNK_PERSON_TO_TEAM_OUTPUT_FIELDS,
        );
      } catch (err) {
        mapItopWriteError(err);
      }
      const teams = new Map<number, string>();
      for (const row of teamsResult.objects) {
        teams.set(Number(row.fields.team_id), row.fields.team_id_friendlyname);
      }
      const teamOptions = () => [...teams.entries()].map(([teamIdOption, name]) => ({ id: teamIdOption, name }));

      let teamId = body.fields?.team_id;
      if (teams.size === 0) {
        throw new HttpError(409, "itop_no_team", "You are not a member of any iTop team.");
      }
      if (teamId !== undefined) {
        if (!teams.has(teamId)) {
          throw new HttpError(
            409,
            "itop_team_required",
            "That team isn't one of your iTop teams — pick one of your own.",
            { teams: teamOptions() },
          );
        }
      } else {
        if (teams.size > 1) {
          throw new HttpError(409, "itop_team_required", "Pick a team to assign this ticket to.", {
            teams: teamOptions(),
          });
        }
        teamId = [...teams.keys()][0];
      }

      stimulus = "ev_assign";
      stimulusFields = { team_id: teamId, agent_id: myItopPersonId };
    } else if (body.action === "pending") {
      stimulus = "ev_pending";
      const pendingReason = body.fields?.pending_reason;
      if (pendingReason !== undefined) {
        stimulusFields = { pending_reason: pendingReason };
      }
    } else if (body.action === "resolve") {
      stimulus = "ev_resolve";
      stimulusFields = { resolution_code: body.fields.resolution_code, solution: body.fields.solution };
    } else if (body.action === "close") {
      stimulus = "ev_close";
    } else {
      stimulus = "ev_reopen";
    }

    try {
      await client.applyStimulus(ticket.class, ticket.id, stimulus, stimulusFields);
    } catch (err) {
      mapItopWriteError(err);
    }

    const { ticket: updated, staleAfterWrite } = await reReadAfterWrite(ticket.class, ticket.id, ticket);
    logger.info(
      { userId: req.user!.sub, ticketId: ticket.id, action: body.action, staleAfterWrite },
      "iTop ticket action applied",
    );
    res.json({ ...toTicketRow(updated, myItopPersonId, { withLogs: true }), staleAfterWrite });
  },
);

// ---- POST /tickets/:id/log ----------------------------------------------------

const logBodySchema = z.object({
  visibility: z.enum(["public", "private"]),
  text: z.string().min(1).max(4000),
});

itopRouter.post(
  "/tickets/:id/log",
  validate("params", ticketIdParamSchema),
  validate("body", logBodySchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof ticketIdParamSchema>;
    const { visibility, text } = req.body as z.infer<typeof logBodySchema>;

    const { ticket, token, myItopPersonId, baseUrl } = await loadWritableTicket(req.user!.sub, id, req.user!);
    const client = makeItopClient(baseUrl, token);

    const field = visibility === "public" ? "public_log" : "private_log";
    try {
      await client.update(ticket.class, ticket.id, { [field]: text });
    } catch (err) {
      mapItopWriteError(err);
    }

    const { ticket: updated, staleAfterWrite } = await reReadAfterWrite(ticket.class, ticket.id, ticket);
    logger.info(
      { userId: req.user!.sub, ticketId: ticket.id, action: "log", visibility, staleAfterWrite },
      "iTop ticket log entry added",
    );
    res.json({ ...toTicketRow(updated, myItopPersonId, { withLogs: true }), staleAfterWrite });
  },
);

// ---- Phase 6: "New ticket" sheet — picklists + creation ----------------------
//
// GET /services and GET /customers/:id/contacts are reads (APPLICATION
// client, like every other GET in this file) feeding the sheet's dropdowns.
// POST /tickets is the one write here and follows the same preconditions as
// the Phase 5 action/log routes above (actionsEnabled, visibility, the
// caller's own decryptable token) — it just has no existing ticket row to
// load, so it checks the CUSTOMER's mapping instead of an ItopTicket's. The
// caller must belong to the customer's iTop organisation (checked with the
// read-only application client, since that's just a fact about iTop's own
// data — not itself a write) before the create is attempted with the user's
// token. See docs/archive/plans/itop-integration.md Task 6.2.

/** Maps a read-only iTop failure (GET /services, GET /customers/:id/contacts, and the caller-in-org check below) to a 502 — these never surface iTop's error as a 409 since there's no "refusal" concept for a plain read. */
function mapItopReadError(err: unknown): never {
  if (err instanceof ItopError) {
    throw new HttpError(502, "itop_unreachable", err.message);
  }
  throw err;
}

interface ServiceOption {
  id: number;
  name: string;
  providerName: string | null;
}

/** In-process, 5-minute TTL — the service catalogue changes rarely and every "New ticket" sheet open would otherwise re-fetch it. Mirrors lib/itop/config.ts's ItopConfig cache shape. Module-level (not per-request), so it's shared across callers; there's no per-customer variation to key on. */
const SERVICES_CACHE_TTL_MS = 5 * 60_000;
let servicesCache: { value: ServiceOption[]; expiresAt: number } | null = null;

/**
 * Busts the `GET /services` cache. iTop's own service catalogue and org
 * names are admin-side data — `routes/itopAdmin.ts` calls this alongside
 * every `bustItopConfigCache()` (settings PATCH, token change, manual sync)
 * so a base-URL/token change or a sync-driven org rename doesn't leave a
 * stale service list cached for up to 5 more minutes. Exported (not
 * automatic on every config bust) because this cache lives in this route
 * file, not lib/itop/config.ts — same reasoning as that module's own
 * `bustItopConfigCache` export.
 */
export function bustItopServicesCache(): void {
  servicesCache = null;
}

itopRouter.get("/services", async (_req, res) => {
  const now = Date.now();
  if (servicesCache && servicesCache.expiresAt > now) {
    res.json(servicesCache.value);
    return;
  }

  // Throws 409 itop_not_configured itself when the admin hasn't connected
  // iTop yet — no separate isItopConfigured check needed here.
  const client = await getItopAppClient();

  let result: ItopGetResult<ItopServiceFields>;
  try {
    result = await client.get<ItopServiceFields>("Service", "SELECT Service", ITOP_SERVICE_OUTPUT_FIELDS);
  } catch (err) {
    mapItopReadError(err);
  }

  const rows: ServiceOption[] = result.objects
    .map((row) => ({ id: row.key, name: row.fields.name, providerName: row.fields.org_id_friendlyname || null }))
    .sort((a, b) => a.name.localeCompare(b.name));

  servicesCache = { value: rows, expiresAt: now + SERVICES_CACHE_TTL_MS };
  res.json(rows);
});

// ---- GET /customers/:id/contacts ---------------------------------------------

itopRouter.get(
  "/customers/:id/contacts",
  validate("params", customerIdParamSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof customerIdParamSchema>;

    await ensureCustomerVisible(req.user!, id);

    const customer = await prisma.customer.findUnique({ where: { id }, select: { itopOrgId: true } });
    if (!customer) throw new HttpError(404, "customer_not_found", "Customer not found");

    if (customer.itopOrgId === null) {
      res.json([]);
      return;
    }

    const client = await getItopAppClient();
    let result: ItopGetResult<ItopPersonFields>;
    try {
      result = await client.get<ItopPersonFields>(
        "Person",
        `SELECT Person WHERE org_id = ${customer.itopOrgId}`,
        ITOP_PERSON_OUTPUT_FIELDS,
      );
    } catch (err) {
      mapItopReadError(err);
    }

    const rows = result.objects
      .map((row) => ({ id: row.key, name: row.fields.friendlyname, email: row.fields.email }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json(rows);
  },
);

// ---- POST /tickets -------------------------------------------------------------

interface WritableCustomerContext {
  itopOrgId: number;
  token: string;
  myItopPersonId: number | null;
  baseUrl: string;
}

/**
 * Shared preconditions for `POST /tickets`, mirroring `loadWritableTicket`'s
 * order (write switch → visibility → the caller's own token) but checking a
 * CUSTOMER's org mapping instead of an existing ticket's customer link,
 * since there is no ticket yet. `customerId` here is a BODY field (like
 * `POST /projects`), not an id-keyed URL param — per backend/CLAUDE.md this
 * uses `isCustomerVisible` + 400 `customer_not_found`, NOT
 * `ensureCustomerVisible`'s 404 (that 404 is reserved for id-keyed routes,
 * e.g. `GET /customers/:id/contacts` above).
 */
async function loadWritableCustomerContext(
  userSub: number,
  customerId: number,
  user: JwtPayload,
): Promise<WritableCustomerContext> {
  const config = await getItopConfig();
  if (!config.actionsEnabled) {
    throw new HttpError(404, "not_found", "Not found");
  }

  if (!(await isCustomerVisible(user, customerId))) {
    throw new HttpError(400, "customer_not_found", "Customer not found");
  }

  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { itopOrgId: true } });
  if (!customer || customer.itopOrgId === null) {
    throw new HttpError(400, "customer_not_mapped", "This customer isn't mapped to an iTop organisation.");
  }

  const me = await prisma.user.findUnique({
    where: { id: userSub },
    select: { itopTokenEnc: true, itopPersonId: true },
  });
  if (!me?.itopTokenEnc) {
    throw new HttpError(403, "itop_token_missing", "Add your personal iTop token in Settings");
  }

  let token: string;
  try {
    token = open(me.itopTokenEnc);
  } catch (err) {
    if (err instanceof SecretBoxError) {
      throw new HttpError(
        403,
        "itop_token_unreadable",
        "Your saved iTop token could not be decrypted (SECRETS_KEY changed?) — enter it again in Settings.",
      );
    }
    throw err;
  }

  if (!config.baseUrl) {
    throw new HttpError(409, "itop_not_configured", "iTop is not connected. An admin must set the iTop URL first.");
  }

  return { itopOrgId: customer.itopOrgId, token, myItopPersonId: me.itopPersonId, baseUrl: config.baseUrl };
}

/**
 * Re-reads a just-created ticket with the read-only APPLICATION client and
 * upserts it into the snapshot, same spirit as `reReadAfterWrite` above — but
 * for a ticket that has no PRE-write snapshot row to fall back to (it didn't
 * exist before this request). On failure there is nothing to answer with
 * except the bare fact that iTop accepted the create, so the caller gets
 * `null` and the route answers 202 instead of 201.
 */
async function readAndUpsertNewTicket(cls: string, id: number): Promise<ItopTicket | null> {
  try {
    return await reReadAndUpsertTicket(cls, id);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), ticketId: id, cls },
      "iTop re-read after a successful ticket create failed — the ticket exists in iTop but not yet in the snapshot",
    );
    return null;
  }
}

const createTicketBodySchema = z.object({
  customerId: z.number().int().positive(),
  class: z.enum([...ITOP_TICKET_CLASSES] as [ItopTicketClass, ...ItopTicketClass[]]),
  title: z.string().min(1).max(255),
  description: z.string().min(1).max(4000),
  callerId: z.number().int().positive(),
  serviceId: z.number().int().positive().optional(),
});

itopRouter.post(
  "/tickets",
  validate("body", createTicketBodySchema),
  async (req, res) => {
    const body = req.body as z.infer<typeof createTicketBodySchema>;

    const { itopOrgId, token, myItopPersonId, baseUrl } = await loadWritableCustomerContext(
      req.user!.sub,
      body.customerId,
      req.user!,
    );

    // The caller must actually belong to the customer's iTop organisation —
    // checked with the read-only application client (a fact about iTop's
    // own data, not a write) before spending the user's own token on a
    // create that iTop would refuse anyway.
    const appClient = await getItopAppClient();
    let callerCheck: ItopGetResult<ItopPersonFields>;
    try {
      callerCheck = await appClient.get<ItopPersonFields>(
        "Person",
        `SELECT Person WHERE id = ${body.callerId} AND org_id = ${itopOrgId}`,
        ITOP_PERSON_OUTPUT_FIELDS,
      );
    } catch (err) {
      mapItopReadError(err);
    }
    if (callerCheck.objects.length !== 1) {
      throw new HttpError(
        400,
        "itop_caller_not_in_org",
        "That caller doesn't belong to the customer's organisation in iTop.",
      );
    }

    const client = makeItopClient(baseUrl, token);
    const createFields: Record<string, unknown> = {
      org_id: itopOrgId,
      caller_id: body.callerId,
      title: body.title,
      description: body.description,
    };
    if (body.serviceId !== undefined) createFields.service_id = body.serviceId;

    let created: ItopObjectRow<ItopTicketFields> | undefined;
    try {
      created = await client.create<ItopTicketFields>(body.class, createFields, "Created from Solvro");
    } catch (err) {
      mapItopWriteError(err);
    }
    if (!created) {
      throw new HttpError(502, "itop_unreachable", "iTop did not confirm the new ticket");
    }

    logger.info(
      { userId: req.user!.sub, customerId: body.customerId, class: body.class, itopId: created.key },
      "iTop ticket created from Solvro",
    );

    const newTicket = await readAndUpsertNewTicket(created.class, created.key);
    if (!newTicket) {
      res.status(202).json({ created: true, id: created.key, staleAfterWrite: true });
      return;
    }

    res.status(201).json(toTicketRow(newTicket, myItopPersonId, { withLogs: true }));
  },
);
