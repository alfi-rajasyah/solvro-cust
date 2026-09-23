// Utilization API (Task 3.2): aggregates the ItopTimeEntry snapshot (synced
// by lib/itop/sync.ts's syncTimeEntries, from iTop's TimeSpent/Time Tracking
// extension) into a weekly Mon..Sun matrix for the Utilization page. `scope`
// mirrors the Daily Review strip's viewer-local-day shift
// (routes/itop.ts GET /daily) but at week granularity, via
// lib/isoWeek.ts's parseWeekKey: `utcOffsetMinutes` (local minus UTC) moves
// the window's position, never the underlying UTC-midnight arithmetic.
// `scope=me` is open to anyone; `tam`/`customer` require `report:executive`
// (plan decision: docs/archive/plans/itop-integration.md §1 item 6 — no new
// permission string is introduced for this). Mounted at /utilization in
// src/app.ts. See docs/archive/plans/itop-integration.md Task 3.2.
import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { requireAuth, hasPermission } from "../http/auth.js";
import { HttpError } from "../http/errors.js";
import { validate } from "../http/validate.js";
import { getItopConfig, isItopConfigured } from "../lib/itop/config.js";
import { parseWeekKey } from "../lib/isoWeek.js";
import { utcMidnightOfDayString } from "../lib/dateBoundary.js";

export const utilizationRouter = Router();

utilizationRouter.use(requireAuth);

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const MAX_TICKET_REFS_PER_ROW = 6;
// A single findMany over the requested week's window, aggregated in memory —
// simpler than a per-day Prisma groupBy and well within budget for a week of
// snapshot rows (Task 3.2 dispatch brief). Defensive cap, not expected to be
// hit in practice.
const MAX_ENTRIES = 10_000;

const utilizationQuerySchema = z.object({
  week: z.string().refine((w) => parseWeekKey(w) !== null, { message: "invalid_week" }),
  scope: z.enum(["me", "tam", "customer"]).default("me"),
  // Local minus UTC, e.g. UTC+7 sends 420 — same contract and bound as
  // routes/itop.ts GET /daily's own utcOffsetMinutes.
  utcOffsetMinutes: z.coerce.number().int().min(-840).max(840).default(0),
});

/** Rounds to 1 decimal only at the edge — callers sum in minutes throughout. */
function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10;
}

interface RowAccumulator {
  key: string;
  label: string;
  kind: "customer" | "tam" | "none";
  dayMinutes: [number, number, number, number, number, number, number];
  totalMinutes: number;
  ticketMinutes: Map<string, number>;
}

function newAccumulator(key: string, label: string, kind: RowAccumulator["kind"]): RowAccumulator {
  return { key, label, kind, dayMinutes: [0, 0, 0, 0, 0, 0, 0], totalMinutes: 0, ticketMinutes: new Map() };
}

function finalizeRow(acc: RowAccumulator) {
  const ticketRefs = [...acc.ticketMinutes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TICKET_REFS_PER_ROW)
    .map(([ref]) => ref);
  return {
    key: acc.key,
    label: acc.label,
    kind: acc.kind,
    hours: acc.dayMinutes.map(minutesToHours),
    total: minutesToHours(acc.totalMinutes),
    ticketRefs,
  };
}

utilizationRouter.get(
  "/",
  validate("query", utilizationQuerySchema),
  async (req, res) => {
    const { week: weekKey, scope, utcOffsetMinutes } = req.query as unknown as z.infer<
      typeof utilizationQuerySchema
    >;
    const user = req.user!;

    if ((scope === "tam" || scope === "customer") && !hasPermission(user, "report:executive")) {
      throw new HttpError(403, "forbidden", "Missing permission: report:executive");
    }

    // Already validated by the schema's refine above — parseWeekKey cannot
    // return null here.
    const week = parseWeekKey(weekKey)!;

    const config = await getItopConfig();
    const capacityHoursPerWeek = config.capacityHoursPerWeek;

    if (!isItopConfigured(config)) {
      res.json({
        configured: false,
        week: { key: week.key, start: week.start, days: week.days },
        scope,
        utcOffsetMinutes,
        capacityHoursPerWeek,
        syncedAt: config.lastSyncAt ? config.lastSyncAt.toISOString() : null,
        tiles: { hoursLogged: 0, capacityHours: 0, customersTouched: 0, customersAssigned: 0, unassignedHours: 0 },
        rows: [],
        totals: { hours: [0, 0, 0, 0, 0, 0, 0], total: 0 },
        truncated: false,
      });
      return;
    }

    // Shift UTC midnight of the week's Monday back by the viewer's UTC
    // offset, same idea as GET /daily's dayStart — the window then brackets
    // the viewer's local Mon 00:00..Sun 24:00, not the UTC one.
    const weekStart = new Date(utcMidnightOfDayString(week.start).getTime() - utcOffsetMinutes * 60_000);
    const weekEnd = new Date(weekStart.getTime() + WEEK_MS);

    const where: Prisma.ItopTimeEntryWhereInput = {
      startDate: { gte: weekStart, lt: weekEnd },
      ...(scope === "me" ? { userId: user.sub } : {}),
    };

    // orderBy is required for `take` to be a meaningful, deterministic cap —
    // without it, which rows Postgres happens to return first (and thus
    // which ones get silently dropped above MAX_ENTRIES) is unspecified and
    // can vary run to run, undercounting the week by a different, arbitrary
    // subset each time. Ordering by startDate at least makes a truncated
    // week reproducible (drops the LATEST entries in the window, not a
    // random assortment).
    const entries = await prisma.itopTimeEntry.findMany({
      where,
      select: {
        userId: true,
        customerId: true,
        startDate: true,
        durationMinutes: true,
        ticketRef: true,
        syncedAt: true,
      },
      orderBy: { startDate: "asc" },
      take: MAX_ENTRIES,
    });
    // True when the query above hit the cap — the frontend uses this to warn
    // that the week's totals may be understated rather than presenting them
    // as complete.
    const truncated = entries.length >= MAX_ENTRIES;

    const customerIds = new Set<number>();
    const userIds = new Set<number>();
    for (const e of entries) {
      if (e.customerId !== null) customerIds.add(e.customerId);
      if (e.userId !== null) userIds.add(e.userId);
    }

    const [customers, users] = await Promise.all([
      customerIds.size > 0
        ? prisma.customer.findMany({ where: { id: { in: [...customerIds] } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      scope === "tam" && userIds.size > 0
        ? prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, username: true } })
        : Promise.resolve([]),
    ]);
    const customerNameById = new Map(customers.map((c) => [c.id, c.name]));
    const usernameById = new Map(users.map((u) => [u.id, u.username]));

    let maxSyncedAt: Date | null = null;
    let totalMinutes = 0;
    // Independent of the scope's own row grouping (which for `tam` groups by
    // user, not customer) — the "unassigned hours" tile always means "not
    // tied to a customer", in every scope. Kept as its own running total
    // rather than derived from a `none`-kind row, since `tam` scope's own
    // `none` row means something else entirely (an unmatched iTop user).
    let unassignedMinutes = 0;
    const totalDayMinutes: [number, number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0, 0];
    const customerIdsTouched = new Set<number>();
    const rowsByKey = new Map<string, RowAccumulator>();

    for (const e of entries) {
      if (maxSyncedAt === null || e.syncedAt > maxSyncedAt) maxSyncedAt = e.syncedAt;

      // The window filter above already guarantees 0..6; the bounds check is
      // defensive only.
      const dayIndex = Math.floor((e.startDate.getTime() - weekStart.getTime()) / DAY_MS);
      if (dayIndex < 0 || dayIndex > 6) continue;

      totalMinutes += e.durationMinutes;
      totalDayMinutes[dayIndex] += e.durationMinutes;
      if (e.customerId !== null) customerIdsTouched.add(e.customerId);
      else unassignedMinutes += e.durationMinutes;

      let rowKey: string;
      let rowLabel: string;
      let rowKind: RowAccumulator["kind"];
      if (scope === "tam") {
        if (e.userId === null) {
          rowKey = "none";
          rowLabel = "Unmatched iTop user";
          rowKind = "none";
        } else {
          rowKey = `user:${e.userId}`;
          rowLabel = usernameById.get(e.userId) ?? `User ${e.userId}`;
          rowKind = "tam";
        }
      } else if (e.customerId === null) {
        rowKey = "none";
        rowLabel = "No customer";
        rowKind = "none";
      } else {
        rowKey = `customer:${e.customerId}`;
        rowLabel = customerNameById.get(e.customerId) ?? `Customer ${e.customerId}`;
        rowKind = "customer";
      }

      let acc = rowsByKey.get(rowKey);
      if (!acc) {
        acc = newAccumulator(rowKey, rowLabel, rowKind);
        rowsByKey.set(rowKey, acc);
      }
      acc.dayMinutes[dayIndex] += e.durationMinutes;
      acc.totalMinutes += e.durationMinutes;
      if (e.ticketRef) {
        acc.ticketMinutes.set(e.ticketRef, (acc.ticketMinutes.get(e.ticketRef) ?? 0) + e.durationMinutes);
      }
    }

    const [customersAssigned, activeMappedUserCount] = await Promise.all([
      scope === "me"
        ? prisma.customer.count({ where: { tamId: user.sub } })
        : prisma.customer.count({ where: { itopOrgId: { not: null } } }),
      scope === "me" ? Promise.resolve(0) : prisma.user.count({ where: { active: true, itopUserId: { not: null } } }),
    ]);

    const capacityHours = scope === "me" ? capacityHoursPerWeek : capacityHoursPerWeek * activeMappedUserCount;

    const unassignedHours = minutesToHours(unassignedMinutes);

    const rows = [...rowsByKey.values()]
      .sort((a, b) => {
        if (a.kind === "none" && b.kind !== "none") return 1;
        if (b.kind === "none" && a.kind !== "none") return -1;
        return b.totalMinutes - a.totalMinutes;
      })
      .map(finalizeRow);

    const syncedAtDate = maxSyncedAt ?? config.lastSyncAt;

    res.json({
      configured: true,
      week: { key: week.key, start: week.start, days: week.days },
      scope,
      utcOffsetMinutes,
      capacityHoursPerWeek,
      syncedAt: syncedAtDate ? syncedAtDate.toISOString() : null,
      tiles: {
        hoursLogged: minutesToHours(totalMinutes),
        capacityHours,
        customersTouched: customerIdsTouched.size,
        customersAssigned,
        unassignedHours,
      },
      rows,
      totals: {
        hours: totalDayMinutes.map(minutesToHours),
        total: minutesToHours(totalMinutes),
      },
      truncated,
    });
  },
);
