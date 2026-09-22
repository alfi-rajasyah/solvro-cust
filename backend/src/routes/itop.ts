// Read-side Tickets API for the iTop integration: connection status for the
// frontend's "Open in iTop" links, a customer's ticket list + counts for the
// Tickets tab, single-ticket lookup, and a debounced manual Refresh trigger.
// All routes are authed (no admin gate — any authed user with visibility
// into the customer can read its tickets). Visibility reuses
// lib/visibility.ts's ensureCustomerVisible — never re-derived here — so a
// customer hidden from the caller 404s the same way every other
// customer-nested route does. Mounted at /itop in src/app.ts. See
// docs/plans/itop-integration.md Task 1.7.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth } from "../http/auth.js";
import { HttpError } from "../http/errors.js";
import { validate } from "../http/validate.js";
import { ensureCustomerVisible } from "../lib/visibility.js";
import { getItopConfig, isItopConfigured } from "../lib/itop/config.js";
import { requestSync } from "../lib/itop/scheduler.js";
import { ITOP_TICKET_CLASSES, type ItopTicketClass } from "../lib/itop/types.js";
import { weekKeyOf, parseWeekKey } from "../lib/isoWeek.js";
import { utcMidnightOfDayString } from "../lib/dateBoundary.js";
import type { ItopTicket, Prisma } from "@prisma/client";

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
