import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeDailyReviewStats,
  dayLabel,
  dueDateLabel,
  firstProjectId,
  isGroupCollapsible,
  weekNumberLabel,
} from "./dailyReviewStats";
import type {
  DailyReviewCustomer,
  DailyReviewNote,
  DailyReviewProject,
  DailyReviewResponse,
  WeeklyUpdate,
} from "./queries";

// Same "2026-W35" fixture week as weeklyDraft.test.ts / isoWeek.test.ts.
const WEEK = {
  key: "2026-W35",
  start: "2026-08-24",
  days: [
    "2026-08-24",
    "2026-08-25",
    "2026-08-26",
    "2026-08-27",
    "2026-08-28",
    "2026-08-29",
    "2026-08-30",
  ],
};
const TODAY = "2026-08-28";
const AUTHOR = { id: 1, username: "alice" };

/**
 * ISO instant for a bare "yyyy-MM-dd" day string — `reviewDate`/`weekStart`
 * arrive from the API this way (the backend's `@db.Date` columns serialise
 * as `T00:00:00.000Z` instants, same convention weeklyDraft.test.ts's own
 * fixtures use), NEVER as a bare day string. Every `reviewDate`/`weekStart`
 * fixture below goes through this helper deliberately, so a regression back
 * to a naive `reviewDate === today` comparison in the module under test
 * fails these tests immediately instead of passing by fixture coincidence.
 */
function dayInstant(day: string): string {
  return `${day}T00:00:00.000Z`;
}

function note(id: number, day: string): DailyReviewNote {
  return { id, noteDate: dayInstant(day), body: `note ${id}`, author: AUTHOR, updatedAt: `${day}T12:00:00.000Z` };
}

function project(overrides: Partial<DailyReviewProject> = {}): DailyReviewProject {
  return {
    id: 1,
    name: "Project",
    status: "ACTIVE",
    customerId: 1,
    baselineLockedAt: null,
    phase: "—",
    progress: { done: 0, total: 0 },
    slipDays: null,
    overdueTasks: [],
    openRisks: [],
    notes: [],
    reviews: [],
    ...overrides,
  };
}

function customer(overrides: Partial<DailyReviewCustomer> = {}): DailyReviewCustomer {
  return {
    id: 1,
    name: "Acme",
    tam: null,
    projects: [],
    operationsNotes: [],
    weeklyUpdate: null,
    previousWeeklyUpdate: null,
    ...overrides,
  };
}

// Defaults to a DONE/GREEN row with no achievements set — the shape every
// `weeklyUpdate:` fixture below needs; callers override the 1-2 fields
// that vary per test (e.g. `health`/`status`/`doneAt` for a DRAFT row).
function weeklyUpdate(overrides: Partial<WeeklyUpdate> = {}): WeeklyUpdate {
  return {
    id: 1,
    weekStart: dayInstant(WEEK.start),
    health: "GREEN",
    status: "DONE",
    category: null,
    highlights: [],
    achievements: [],
    midweekSavedAt: null,
    doneAt: "2026-08-28T10:00:00.000Z",
    author: AUTHOR,
    updatedAt: "2026-08-28T10:00:00.000Z",
    ...overrides,
  };
}

function response(overrides: Partial<DailyReviewResponse> = {}): DailyReviewResponse {
  return {
    week: WEEK,
    today: TODAY,
    coverage: {},
    customers: [],
    unassignedProjects: [],
    ...overrides,
  };
}

describe("computeDailyReviewStats", () => {
  // Decision 20: "Reviewed today" is per customer — a customer counts once
  // it has >=1 project and every one of those projects has a review (by
  // the current user) for `data.today`; the denominator is customers with
  // >=1 project; unassigned projects are excluded from both count and total.
  it("counts a customer as reviewed when its one project has a review for today — reviewDate as an ISO instant, not a bare day string (a naive === would never match)", () => {
    // `reviewDate` is `dayInstant(TODAY)` ("2026-08-28T00:00:00.000Z"), which
    // is never `=== data.today` ("2026-08-28") under a bare string compare —
    // this only passes if the module extracts the calendar day first.
    const reviewedProject = project({
      id: 1,
      reviews: [{ reviewDate: dayInstant(TODAY), createdAt: dayInstant(TODAY) }],
    });
    const unreviewedProject = project({ id: 2 });
    const data = response({
      customers: [
        customer({ id: 1, projects: [reviewedProject] }),
        customer({ id: 2, projects: [unreviewedProject] }),
      ],
    });
    expect(computeDailyReviewStats(data).reviewedToday).toEqual({ count: 1, total: 2 });
  });

  it("does not count a customer whose only review is from a different day", () => {
    const data = response({
      customers: [
        customer({
          id: 1,
          projects: [
            project({ reviews: [{ reviewDate: dayInstant("2026-08-27"), createdAt: "2026-08-27T09:00:00.000Z" }] }),
          ],
        }),
      ],
    });
    expect(computeDailyReviewStats(data).reviewedToday).toEqual({ count: 0, total: 1 });
  });

  it("does not count a customer when only one of its two projects is reviewed today", () => {
    const reviewed = project({
      id: 1,
      reviews: [{ reviewDate: dayInstant(TODAY), createdAt: `${TODAY}T09:00:00.000Z` }],
    });
    const notReviewed = project({ id: 2, reviews: [] });
    const data = response({ customers: [customer({ id: 1, projects: [reviewed, notReviewed] })] });
    expect(computeDailyReviewStats(data).reviewedToday).toEqual({ count: 0, total: 1 });
  });

  it("excludes a customer with zero projects from the total", () => {
    const reviewed = project({
      id: 1,
      reviews: [{ reviewDate: dayInstant(TODAY), createdAt: `${TODAY}T09:00:00.000Z` }],
    });
    const data = response({
      customers: [customer({ id: 1, projects: [reviewed] }), customer({ id: 2, projects: [] })],
    });
    expect(computeDailyReviewStats(data).reviewedToday).toEqual({ count: 1, total: 1 });
  });

  it("excludes unassigned projects entirely — they contribute to neither count nor total", () => {
    const unassigned = project({
      id: 3,
      reviews: [{ reviewDate: dayInstant(TODAY), createdAt: `${TODAY}T09:00:00.000Z` }],
    });
    const data = response({
      customers: [customer({ id: 1, projects: [] })],
      unassignedProjects: [unassigned],
    });
    expect(computeDailyReviewStats(data).reviewedToday).toEqual({ count: 0, total: 0 });
  });

  it("sums project notes and operations notes separately and as a total", () => {
    const p = project({ notes: [note(1, "2026-08-24"), note(2, "2026-08-25")] });
    const c = customer({
      projects: [p],
      operationsNotes: [
        { ...note(3, "2026-08-24"), title: "Ops note" },
      ],
    });
    const stats = computeDailyReviewStats(response({ customers: [c] }));
    expect(stats.notesThisWeek).toEqual({ project: 2, operations: 1, total: 3 });
  });

  it("counts weekly-updates-done only against customers, excluding the unassigned group", () => {
    const done = customer({
      id: 1,
      weeklyUpdate: weeklyUpdate(),
    });
    const notDone = customer({ id: 2, weeklyUpdate: null });
    const data = response({ customers: [done, notDone], unassignedProjects: [project({ id: 9 })] });
    expect(computeDailyReviewStats(data).weeklyUpdatesDone).toEqual({ count: 1, total: 2 });
  });

  it("sums overdue tasks and open risks across all in-scope projects", () => {
    const p1 = project({
      id: 1,
      overdueTasks: [{ id: 1, title: "t", dueDate: "2026-08-20T00:00:00.000Z", status: "TODO" }],
      openRisks: [{ id: 1, description: "r", probability: 3, impact: 3, status: "OPEN" }],
    });
    const p2 = project({
      id: 2,
      overdueTasks: [{ id: 2, title: "t2", dueDate: "2026-08-21T00:00:00.000Z", status: "TODO" }],
    });
    const data = response({ customers: [customer({ projects: [p1] })], unassignedProjects: [p2] });
    const stats = computeDailyReviewStats(data);
    expect(stats.overdueTasks).toBe(2);
    expect(stats.openRisks).toBe(1);
  });
});

describe("isGroupCollapsible", () => {
  it("treats reviewDate as an ISO instant, not a bare day string — a naive === would never match", () => {
    const c = customer({
      projects: [project({ id: 1, reviews: [{ reviewDate: dayInstant(TODAY), createdAt: dayInstant(TODAY) }] })],
      weeklyUpdate: weeklyUpdate(),
    });
    expect(isGroupCollapsible(c, TODAY)).toBe(true);
  });

  it("is false for a customer with no projects, regardless of the weekly update", () => {
    const c = customer({
      projects: [],
      weeklyUpdate: weeklyUpdate(),
    });
    expect(isGroupCollapsible(c, TODAY)).toBe(false);
  });

  it("is false when a project is missing today's review, even if the weekly update is done", () => {
    const c = customer({
      projects: [
        project({ id: 1, reviews: [{ reviewDate: dayInstant(TODAY), createdAt: `${TODAY}T09:00:00.000Z` }] }),
        project({ id: 2, reviews: [] }),
      ],
      weeklyUpdate: weeklyUpdate(),
    });
    expect(isGroupCollapsible(c, TODAY)).toBe(false);
  });

  it("is false when every project is reviewed but the weekly update is only DRAFT", () => {
    const c = customer({
      projects: [project({ id: 1, reviews: [{ reviewDate: dayInstant(TODAY), createdAt: `${TODAY}T09:00:00.000Z` }] })],
      weeklyUpdate: weeklyUpdate({ health: null, status: "DRAFT", doneAt: null }),
    });
    expect(isGroupCollapsible(c, TODAY)).toBe(false);
  });

  it("is true when every project is reviewed today and the weekly update is DONE", () => {
    const c = customer({
      projects: [
        project({ id: 1, reviews: [{ reviewDate: dayInstant(TODAY), createdAt: `${TODAY}T09:00:00.000Z` }] }),
        project({ id: 2, reviews: [{ reviewDate: dayInstant(TODAY), createdAt: `${TODAY}T09:05:00.000Z` }] }),
      ],
      weeklyUpdate: weeklyUpdate({ health: "AMBER" }),
    });
    expect(isGroupCollapsible(c, TODAY)).toBe(true);
  });
});

describe("firstProjectId", () => {
  it("returns the first customer's first project when present", () => {
    const data = response({
      customers: [
        customer({ id: 1, projects: [project({ id: 10 }), project({ id: 11 })] }),
        customer({ id: 2, projects: [project({ id: 20 })] }),
      ],
      unassignedProjects: [project({ id: 30 })],
    });
    expect(firstProjectId(data)).toBe(10);
  });

  it("skips a customer with no projects and falls through to the next one", () => {
    const data = response({
      customers: [customer({ id: 1, projects: [] }), customer({ id: 2, projects: [project({ id: 20 })] })],
    });
    expect(firstProjectId(data)).toBe(20);
  });

  it("falls back to the first unassigned project when no customer has any", () => {
    const data = response({
      customers: [customer({ id: 1, projects: [] })],
      unassignedProjects: [project({ id: 30 })],
    });
    expect(firstProjectId(data)).toBe(30);
  });

  it("returns null when there are no projects anywhere", () => {
    expect(firstProjectId(response())).toBeNull();
  });
});

describe("dayLabel", () => {
  it("formats a day string as weekday abbreviation + day-of-month, in UTC", () => {
    expect(dayLabel("2026-08-24")).toBe("Mon 24");
    expect(dayLabel("2026-08-30")).toBe("Sun 30");
  });
});

describe("dueDateLabel", () => {
  // `dueDateLabel` omits the year only for the current year, so pin the clock.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-28T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats a day instant as day-of-month + month abbreviation, in UTC", () => {
    expect(dueDateLabel("2026-08-24T00:00:00.000Z")).toBe("24 Aug");
  });

  it("reads the UTC date-part regardless of a non-midnight time-of-day", () => {
    expect(dueDateLabel("2026-01-05T23:00:00.000Z")).toBe("5 Jan");
  });
});

describe("weekNumberLabel", () => {
  it("extracts the numeric week from a well-formed key", () => {
    expect(weekNumberLabel("2026-W35")).toBe("35");
    expect(weekNumberLabel("2026-W05")).toBe("5");
  });

  it("falls back to the raw key when malformed", () => {
    expect(weekNumberLabel("not-a-week")).toBe("not-a-week");
  });
});
