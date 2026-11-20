// Workload per assignee (GET /utilization/workload,
// docs/archive/plans/workload-tab.md). Counts Solvro tasks, not iTop hours, so
// it works without iTop.
//
// Who the caller may see is decided here, on the server, from permissions only:
//   - no workload permission  -> the caller's own row
//   - `workload:team`         -> the caller plus every user assigned a task in
//                                a project the caller owns (`Project.tamId`),
//                                and the Unassigned row limited to those projects
//   - `workload:all`          -> every assignee and the org-wide Unassigned row
//                                (an org-wide read grant, like `report:executive`)
// `*` grants both through hasPermission. `report:executive` grants neither.
// Own and team rows count only tasks in projects the caller can see
// (projectVisibilityFilter); `workload:all` counts across every project.
//
// Week window: task dates are calendar days stored as UTC midnight
// (frontend/src/lib/dateField.ts), so the week is [UTC midnight of Monday,
// +7 days) and a task's day is its UTC date-part. `utcOffsetMinutes` (local
// minus UTC) decides "today" for the overdue count: the viewer's local day.
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { hasPermission, type JwtPayload } from "../http/auth.js";
import { projectVisibilityFilter } from "./visibility.js";
import { utcMidnightOf, utcMidnightOfDayString } from "./dateBoundary.js";
import type { ParsedWeek } from "./isoWeek.js";

const DAY_MS = 24 * 60 * 60 * 1000;
export const WORKLOAD_DETAIL_LIMIT = 300;

export type WorkloadScope = "own" | "team" | "all";

export interface WorkloadWindow {
  /** Inclusive start: UTC midnight of the week's Monday. */
  start: Date;
  /** Exclusive end: UTC midnight of the next Monday. */
  end: Date;
  /** UTC midnight of the viewer's local today. */
  today: Date;
}

export function workloadWindow(week: ParsedWeek, utcOffsetMinutes: number, now: number = Date.now()): WorkloadWindow {
  const start = utcMidnightOfDayString(week.start);
  return {
    start,
    end: new Date(start.getTime() + 7 * DAY_MS),
    // Local day = the UTC day of (now + offset).
    today: utcMidnightOf(now + utcOffsetMinutes * 60_000),
  };
}

export function workloadScopeOf(user: JwtPayload): WorkloadScope {
  if (hasPermission(user, "workload:all")) return "all";
  if (hasPermission(user, "workload:team")) return "team";
  return "own";
}

/** Ids of users assigned any task in a project `callerId` owns, plus the caller. */
async function teamUserIds(callerId: number): Promise<number[]> {
  const rows = await prisma.task.findMany({
    where: { assignedToId: { not: null }, project: { tamId: callerId } },
    distinct: ["assignedToId"],
    select: { assignedToId: true },
  });
  const ids = new Set<number>([callerId]);
  for (const r of rows) if (r.assignedToId !== null) ids.add(r.assignedToId);
  return [...ids];
}

export interface WorkloadAccess {
  scope: WorkloadScope;
  /** Users the caller may see a row for (all scope: null, meaning every user). */
  userIds: number[] | null;
  /** Whether an Unassigned row exists for the caller. */
  unassigned: boolean;
  /** Prisma filter for the OPEN tasks the caller may count (assignee and project scoping). */
  openWhere: Prisma.TaskWhereInput;
}

export async function resolveWorkloadAccess(user: JwtPayload): Promise<WorkloadAccess> {
  const scope = workloadScopeOf(user);
  const open: Prisma.TaskWhereInput = { status: { not: "DONE" } };
  if (scope === "all") {
    return { scope, userIds: null, unassigned: true, openWhere: open };
  }
  const visible: Prisma.TaskWhereInput = { project: projectVisibilityFilter(user) };
  if (scope === "own") {
    return {
      scope,
      userIds: [user.sub],
      unassigned: false,
      openWhere: { AND: [open, visible, { assignedToId: user.sub }] },
    };
  }
  const userIds = await teamUserIds(user.sub);
  return {
    scope,
    userIds,
    unassigned: true,
    openWhere: {
      AND: [
        open,
        visible,
        { OR: [{ assignedToId: { in: userIds } }, { assignedToId: null, project: { tamId: user.sub } }] },
      ],
    },
  };
}

export interface WorkloadRow {
  key: string;
  userId: number | null;
  name: string;
  active: boolean;
  open: number;
  dueThisWeek: number;
  overdue: number;
  activeInWeek: number;
  storyPoints: number;
}

export async function computeWorkload(user: JwtPayload, win: WorkloadWindow) {
  const access = await resolveWorkloadAccess(user);
  const and = (extra: Prisma.TaskWhereInput): Prisma.TaskWhereInput => ({ AND: [access.openWhere, extra] });

  // One groupBy per column, all in parallel, each served by the assigned_to /
  // due_date / status indexes. Output size is bounded by the number of assignees.
  const [openRows, dueRows, overdueRows, activeRows] = await Promise.all([
    prisma.task.groupBy({
      by: ["assignedToId"],
      where: access.openWhere,
      _count: { _all: true },
      _sum: { storyPoints: true },
    }),
    prisma.task.groupBy({
      by: ["assignedToId"],
      where: and({ dueDate: { gte: win.start, lt: win.end } }),
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ["assignedToId"],
      where: and({ dueDate: { lt: win.today } }),
      _count: { _all: true },
    }),
    // Start..due overlaps the week; a task with only one of the two dates
    // counts as a single day.
    prisma.task.groupBy({
      by: ["assignedToId"],
      where: and({
        OR: [
          { startDate: { lt: win.end }, dueDate: { gte: win.start } },
          { startDate: { gte: win.start, lt: win.end }, dueDate: null },
          { startDate: null, dueDate: { gte: win.start, lt: win.end } },
        ],
      }),
      _count: { _all: true },
    }),
  ]);

  const stats = new Map<number | null, Omit<WorkloadRow, "key" | "userId" | "name" | "active">>();
  const entry = (id: number | null) => {
    let e = stats.get(id);
    if (!e) {
      e = { open: 0, dueThisWeek: 0, overdue: 0, activeInWeek: 0, storyPoints: 0 };
      stats.set(id, e);
    }
    return e;
  };
  for (const r of openRows) {
    const e = entry(r.assignedToId);
    e.open = r._count._all;
    e.storyPoints = r._sum.storyPoints ?? 0;
  }
  for (const r of dueRows) entry(r.assignedToId).dueThisWeek = r._count._all;
  for (const r of overdueRows) entry(r.assignedToId).overdue = r._count._all;
  for (const r of activeRows) entry(r.assignedToId).activeInWeek = r._count._all;

  // Roster: everyone the caller may see (own/team), or every user assigned any
  // task (all). Inactive users stay only while they hold open tasks.
  let rosterIds: number[];
  if (access.userIds) {
    rosterIds = access.userIds;
  } else {
    const assigned = await prisma.user.findMany({
      where: { assignedTasks: { some: {} } },
      select: { id: true },
    });
    rosterIds = assigned.map((u) => u.id);
  }
  const ids = new Set<number>(rosterIds);
  for (const id of stats.keys()) if (id !== null) ids.add(id);
  const users = await prisma.user.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, username: true, active: true },
  });

  const rows: WorkloadRow[] = [];
  for (const u of users) {
    const s = stats.get(u.id) ?? { open: 0, dueThisWeek: 0, overdue: 0, activeInWeek: 0, storyPoints: 0 };
    if (!u.active && s.open === 0) continue;
    rows.push({ key: `user:${u.id}`, userId: u.id, name: u.username, active: u.active, ...s });
  }
  rows.sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));

  const unassigned = stats.get(null);
  if (access.unassigned && unassigned && unassigned.open > 0) {
    rows.push({ key: "unassigned", userId: null, name: "Unassigned", active: true, ...unassigned });
  }

  const totals = rows.reduce(
    (t, r) => ({
      open: t.open + r.open,
      dueThisWeek: t.dueThisWeek + r.dueThisWeek,
      overdue: t.overdue + r.overdue,
      activeInWeek: t.activeInWeek + r.activeInWeek,
      storyPoints: t.storyPoints + r.storyPoints,
    }),
    { open: 0, dueThisWeek: 0, overdue: 0, activeInWeek: 0, storyPoints: 0 },
  );

  return { scope: access.scope, rows, totals, access };
}

/** True when the caller may open `assignee` ("unassigned" or a user id) in the detail view. */
export function canOpenAssignee(access: WorkloadAccess, assignee: number | "unassigned"): boolean {
  if (assignee === "unassigned") return access.unassigned;
  return access.userIds === null || access.userIds.includes(assignee);
}
