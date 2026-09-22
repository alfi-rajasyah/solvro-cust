// Read-side Tickets API for the iTop integration: connection status for the
// frontend's "Open in iTop" links, a customer's ticket list + counts for the
// Tickets tab, single-ticket lookup, a debounced manual Refresh trigger, and
// the Daily Review strip's per-day, per-customer digest (GET /daily). All
// routes are authed (no admin gate — any authed user with visibility into
// the customer can read its tickets). Visibility reuses lib/visibility.ts's
// ensureCustomerVisible/customerVisibilityFilter — never re-derived here —
// so a customer hidden from the caller 404s (or is silently excluded from a
// list) the same way every other customer-nested route does. Mounted at
// /itop in src/app.ts. See docs/archive/plans/itop-integration.md Tasks 1.7, 2.1.
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { requireAuth } from "../http/auth.js";
import { HttpError } from "../http/errors.js";
import { validate } from "../http/validate.js";
import { ensureCustomerVisible, customerVisibilityFilter } from "../lib/visibility.js";
import { getItopConfig, isItopConfigured } from "../lib/itop/config.js";
import { requestSync } from "../lib/itop/scheduler.js";
import { ITOP_TICKET_CLASSES, type ItopTicketClass } from "../lib/itop/types.js";
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

function toTicketRow(ticket: ItopTicket, myItopPersonId: number | null) {
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
    res.json(toTicketRow(ticket, myItopPersonId));
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
