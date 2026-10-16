// Phase 7 timer backend (src/routes/itop.ts's POST /tickets/:id/time and the
// myMinutesThisWeek addition to GET /tickets/:id). Exercises the precondition
// order (actionsEnabled, visibility, personal token, linked iTop USER
// identity), the start/end validation rules, that the write happens under
// the ACTING USER'S OWN token (never the application token), that a
// successful create is upserted into ItopTimeEntry immediately from iTop's
// own re-read, and the viewer-local ISO week window `myMinutesThisWeek` sums
// over. See docs/archive/plans/itop-integration.md Task 7.1.
import "../env.js";
import type { Server } from "node:http";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/prisma.js";
import { signToken } from "../../src/http/auth.js";
import { seal } from "../../src/lib/secretBox.js";
import { bustItopConfigCache } from "../../src/lib/itop/config.js";
import { syncTickets } from "../../src/lib/itop/sync.js";
import { utcToZonedWallTime } from "../../src/lib/itop/timezone.js";
import { weekKeyOf, parseWeekKey } from "../../src/lib/isoWeek.js";
import { seedRoles, createUserWithRole } from "../testAuth.js";
import { createFakeItop, seedFakeItop, type FakeItopState, FAKE_ITOP_TOKENS } from "./fakeItop.js";

const app = createApp();

/**
 * Independent (NOT calling lib/itop/timezone.ts) oracle for Europe/Paris's
 * DST offset: CEST (+2h) from the last Sunday of March 01:00 UTC to the
 * last Sunday of October 01:00 UTC, CET (+1h) otherwise. Used for exactly
 * one absolute-instant expectation in the "non-UTC iTop server timezone"
 * block below. The other assertions there compare the route's output
 * against `utcToZonedWallTime`, and the round-trip back against
 * `startedAt`/`endedAt` — but both directions (`utcToZonedWallTime` AND
 * `zonedWallTimeToUtc`) share the same offset-lookup primitive
 * (`offsetMinutesAt`), so a "symmetric" bug there (e.g. a sign error
 * applied consistently both ways) would cancel out across that round trip
 * and still pass. This hand-rolled, independently-implemented rule shares
 * no code with lib/itop/timezone.ts at all, so it still catches that case.
 */
function independentParisOffsetMs(date: Date): number {
  const year = date.getUTCFullYear();
  const lastSundayAt1amUtc = (month: number): Date => {
    // month: 0-11. Walk back from the first of the FOLLOWING month to the
    // preceding Sunday.
    const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 1) - 24 * 60 * 60 * 1000);
    lastDayOfMonth.setUTCDate(lastDayOfMonth.getUTCDate() - lastDayOfMonth.getUTCDay());
    lastDayOfMonth.setUTCHours(1, 0, 0, 0);
    return lastDayOfMonth;
  };
  const dstStart = lastSundayAt1amUtc(2); // March
  const dstEnd = lastSundayAt1amUtc(9); // October
  const isDst = date.getTime() >= dstStart.getTime() && date.getTime() < dstEnd.getTime();
  return (isDst ? 2 : 1) * 60 * 60 * 1000;
}

/** Formats `date` (a real instant) as the Paris wall-clock string per the independent oracle above — never via lib/itop/timezone.ts. */
function independentParisWallClock(date: Date): string {
  const paris = new Date(date.getTime() + independentParisOffsetMs(date));
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${paris.getUTCFullYear()}-${pad(paris.getUTCMonth() + 1)}-${pad(paris.getUTCDate())} ` +
    `${pad(paris.getUTCHours())}:${pad(paris.getUTCMinutes())}:${pad(paris.getUTCSeconds())}`
  );
}

// Shared with the other itop test files — the fake iTop seed's fixed
// Person/User emails are the only User rows any of these files need to
// reclaim between tests.
const ITOP_FIXTURE_EMAILS = [
  "rina.s@example.co.id",
  "dedi.p@example.co.id",
  "budi.h@example.co.id",
  "orphan.contact@example.co.id",
];

async function resetItopTestState(): Promise<void> {
  await prisma.itopTimeEntry.deleteMany();
  await prisma.itopTicket.deleteMany();
  await prisma.customer.deleteMany({ where: { itopOrgId: { not: null } } });
  await prisma.user.deleteMany({ where: { email: { in: ITOP_FIXTURE_EMAILS } } });
  await prisma.itopConfig.deleteMany({ where: { id: "default" } });
  bustItopConfigCache();
}

let fakeServer: Server | undefined;

async function startFake(state: FakeItopState): Promise<string> {
  const { listen } = createFakeItop(state);
  const { server, baseUrl } = await listen(0);
  fakeServer = server;
  return baseUrl;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

let userCounter = 0;

/** A TAM user with a caller-chosen (fixed) email, so `syncUsers` (run by `syncTickets({full:true})` below) matches it to the fake's Person/User rows by email, the same way production does. */
async function createUserWithEmail(email: string): Promise<{ userId: number; token: string }> {
  const role = await prisma.role.findUniqueOrThrow({ where: { roleName: "TAM" } });
  userCounter += 1;
  const user = await prisma.user.create({
    data: {
      username: `itop-time-test-${userCounter}-${Date.now()}`,
      email,
      passwordHash: null,
      roleId: role.id,
      active: true,
    },
  });
  const token = signToken({ sub: user.id, ver: 0 });
  return { userId: user.id, token };
}

async function linkPersonalToken(userId: number, itopToken: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { itopTokenEnc: seal(itopToken) } });
}

async function ticketIdByRef(ref: string): Promise<number> {
  const row = await prisma.itopTicket.findFirstOrThrow({ where: { ref } });
  return row.id;
}

function call(method: "get" | "post", path: string, token?: string, body?: unknown) {
  let req = request(app)[method](path);
  if (token) req = req.set("Authorization", `Bearer ${token}`);
  if (body !== undefined) req = req.send(body as Record<string, unknown>);
  return req;
}

interface Fixture {
  state: FakeItopState;
  rina: { userId: number; token: string };
  dedi: { userId: number; token: string };
}

let fixture: Fixture;

beforeAll(async () => {
  await seedRoles();
});

beforeEach(async () => {
  await resetItopTestState();

  const state = seedFakeItop();
  const baseUrl = await startFake(state);

  const rina = await createUserWithEmail("rina.s@example.co.id");
  const dedi = await createUserWithEmail("dedi.p@example.co.id");

  await prisma.customer.create({
    data: {
      name: `iTop time test customer 1 ${Date.now()}-${Math.random()}`,
      description: "d",
      tamId: rina.userId,
      itopOrgId: 1,
      itopOrgName: "Northwind Freight Sdn Bhd",
    },
  });
  await prisma.customer.create({
    data: {
      name: `iTop time test customer 2 ${Date.now()}-${Math.random()}`,
      description: "d",
      tamId: dedi.userId,
      itopOrgId: 2,
      itopOrgName: "PT Sinar Logistik",
    },
  });

  await prisma.itopConfig.upsert({
    where: { id: "default" },
    create: { id: "default", baseUrl, appTokenEnc: seal(FAKE_ITOP_TOKENS.app), actionsEnabled: true },
    update: {
      baseUrl,
      appTokenEnc: seal(FAKE_ITOP_TOKENS.app),
      actionsEnabled: true,
      lastSyncAt: null,
      lastFullSyncAt: null,
    },
  });
  bustItopConfigCache();

  // Pulls all 12 fake tickets AND the fake's seeded TimeSpent rows into the
  // real snapshot, and matches rina/dedi's Solvro accounts to their fake
  // Person/User by email (itopPersonId AND itopUserId) — exactly like
  // production. None of the seeded TimeSpent rows reference "R-004535",
  // which every test below uses, so they never interfere with this file's
  // own myMinutesThisWeek assertions.
  await syncTickets({ full: true });

  fixture = { state, rina, dedi };
});

afterEach(async () => {
  if (fakeServer) {
    await closeServer(fakeServer);
    fakeServer = undefined;
  }
});

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

describe("preconditions", () => {
  it("404s when actionsEnabled is false", async () => {
    await prisma.itopConfig.update({ where: { id: "default" }, data: { actionsEnabled: false } });
    bustItopConfigCache();
    await linkPersonalToken(fixture.rina.userId, FAKE_ITOP_TOKENS.rina);

    const id = await ticketIdByRef("R-004535");
    const now = new Date();
    const res = await call("post", `/itop/tickets/${id}/time`, fixture.rina.token, {
      startedAt: new Date(now.getTime() - 30 * MINUTE_MS).toISOString(),
      endedAt: now.toISOString(),
    });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("not_found");
  });

  it("403s when the caller has no personal token saved", async () => {
    const id = await ticketIdByRef("R-004535");
    const now = new Date();
    const res = await call("post", `/itop/tickets/${id}/time`, fixture.rina.token, {
      startedAt: new Date(now.getTime() - 30 * MINUTE_MS).toISOString(),
      endedAt: now.toISOString(),
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("itop_token_missing");
  });

  it("403s itop_user_unmatched when the caller has a token but no linked iTop User", async () => {
    await linkPersonalToken(fixture.rina.userId, FAKE_ITOP_TOKENS.rina);
    // syncTickets({full:true}) in beforeEach already matched Rina's
    // itopUserId via email — force it back to null to simulate an account
    // an admin hasn't (yet) re-run "Match users" for.
    await prisma.user.update({ where: { id: fixture.rina.userId }, data: { itopUserId: null } });

    const id = await ticketIdByRef("R-004535");
    const now = new Date();
    const res = await call("post", `/itop/tickets/${id}/time`, fixture.rina.token, {
      startedAt: new Date(now.getTime() - 30 * MINUTE_MS).toISOString(),
      endedAt: now.toISOString(),
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("itop_user_unmatched");
  });

  it("404s a ticket whose customer the caller cannot see", async () => {
    const outsider = await createUserWithRole("TAM");
    const id = await ticketIdByRef("R-004535"); // belongs to customer 1, owned by rina
    const now = new Date();
    const res = await call("post", `/itop/tickets/${id}/time`, outsider.token, {
      startedAt: new Date(now.getTime() - 30 * MINUTE_MS).toISOString(),
      endedAt: now.toISOString(),
    });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("customer_not_found");
  });
});

describe("task:write gating", () => {
  it("403s a STAKEHOLDER on POST /itop/tickets/:id/time even with a valid personal token", async () => {
    const user = await createUserWithRole("STAKEHOLDER");
    await linkPersonalToken(user.userId, FAKE_ITOP_TOKENS.rina);
    const id = await ticketIdByRef("R-004535");

    const now = new Date();
    const res = await call("post", `/itop/tickets/${id}/time`, user.token, {
      startedAt: new Date(now.getTime() - 30 * MINUTE_MS).toISOString(),
      endedAt: now.toISOString(),
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("forbidden");
    expect(fixture.state.writeLog.filter((w) => w.operation === "core/create")).toHaveLength(0);
  });
});

describe("happy path", () => {
  it("creates one TimeSpent entry under the caller's own token and upserts the snapshot", async () => {
    await linkPersonalToken(fixture.rina.userId, FAKE_ITOP_TOKENS.rina);
    const ref = "R-004535";
    const id = await ticketIdByRef(ref);

    const now = new Date();
    const startedAt = new Date(now.getTime() - 45 * MINUTE_MS);

    const res = await call("post", `/itop/tickets/${id}/time`, fixture.rina.token, {
      startedAt: startedAt.toISOString(),
      endedAt: now.toISOString(),
      title: "Investigated the firewall rule request",
    });

    expect(res.status).toBe(201);
    expect(res.body.entry.durationMinutes).toBe(45);
    expect(res.body.entry.ticketRef).toBe(ref);
    expect(res.body.entry.title).toBe("Investigated the firewall rule request");
    // No myMinutesThisWeek on this response — see the route's own comment:
    // this route has no utcOffsetMinutes input, so it would be a UTC-week
    // figure silently contradicting GET /tickets/:id's viewer-local one.
    expect(res.body.myMinutesThisWeek).toBeUndefined();

    const row = await prisma.itopTimeEntry.findUniqueOrThrow({ where: { id: res.body.entry.id } });
    expect(row.userId).toBe(fixture.rina.userId);
    expect(row.customerId).not.toBeNull();
    expect(row.ticketId).toBe(id);
    expect(row.ticketRef).toBe(ref);
    expect(row.durationMinutes).toBe(45);

    // The create itself ran under Rina's OWN token — never the application
    // token (docs/archive/plans/itop-integration.md §1 decision 8/11).
    const writes = fixture.state.writeLog.filter((w) => w.operation === "core/create");
    expect(writes).toHaveLength(1);
    expect(writes[0].token).toBe(FAKE_ITOP_TOKENS.rina);
    expect(writes[0].comment).toBe("Solvro: time logged by rina.s@example.co.id");
  });

  it("defaults the title to the ticket's ref when none is given", async () => {
    await linkPersonalToken(fixture.rina.userId, FAKE_ITOP_TOKENS.rina);
    const ref = "R-004535";
    const id = await ticketIdByRef(ref);

    const now = new Date();
    const res = await call("post", `/itop/tickets/${id}/time`, fixture.rina.token, {
      startedAt: new Date(now.getTime() - 10 * MINUTE_MS).toISOString(),
      endedAt: now.toISOString(),
    });

    expect(res.status).toBe(201);
    expect(res.body.entry.title).toBe(ref);
  });
});

describe("non-UTC iTop server timezone (Europe/Paris)", () => {
  it("sends start_date/end_date zoned to the server's own timezone, and the snapshot round-trips to the same UTC instant", async () => {
    // The fixture's beforeEach already started the fake and synced against
    // it at the UTC default — reconfigure both the fake and ItopConfig to
    // Europe/Paris for this test alone (mutating the SAME state object the
    // already-listening fake server closes over).
    fixture.state.timezone = "Europe/Paris";
    await prisma.itopConfig.update({ where: { id: "default" }, data: { timezone: "Europe/Paris" } });
    bustItopConfigCache();

    await linkPersonalToken(fixture.rina.userId, FAKE_ITOP_TOKENS.rina);
    const ref = "R-004535";
    const id = await ticketIdByRef(ref);

    // Real instants close to "now" (must land inside the 8-week sync window
    // and not in the future) — the zone under test is whatever Europe/Paris
    // actually observes today (DST or not), computed via the SAME
    // production conversion the route itself uses, never a hardcoded
    // "assume summer" literal.
    // iTop's wall-clock format has no sub-second precision — floor to the
    // second first so the round-trip comparison below can be exact rather
    // than tolerating up to 999ms of expected truncation.
    const now = new Date(Math.floor(Date.now() / 1000) * 1000);
    const startedAt = new Date(now.getTime() - 30 * MINUTE_MS);
    const endedAt = now;

    const res = await call("post", `/itop/tickets/${id}/time`, fixture.rina.token, {
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
    });
    expect(res.status).toBe(201);
    expect(res.body.entry.durationMinutes).toBe(30);

    // The fake stores exactly what the route sent it — zoned to Paris, never
    // the bare UTC reading of the same instant (asserted explicitly below).
    const created = [...fixture.state.timeSpent.values()].find((t) => t.id === res.body.entry.id)!;
    expect(created.start_date).toBe(utcToZonedWallTime(startedAt, "Europe/Paris"));
    expect(created.end_date).toBe(utcToZonedWallTime(endedAt, "Europe/Paris"));
    // Distinguishing assertion: if the route had silently defaulted to UTC
    // instead of threading the configured zone through, the fake would have
    // received the bare UTC reading instead — different whenever Paris
    // isn't at a zero offset (true for every date, since Europe/Paris is
    // never UTC+0).
    expect(created.start_date).not.toBe(utcToZonedWallTime(startedAt, "UTC"));

    // Absolute-instant expectation from a SEPARATE, hand-rolled DST oracle
    // (independentParisWallClock, top of file) that shares no code with
    // lib/itop/timezone.ts — the two assertions above compare the route's
    // output against `utcToZonedWallTime` itself, and the round-trip check
    // below compares back against `startedAt`/`endedAt`, but BOTH
    // directions of lib/itop/timezone.ts share the same offset-lookup
    // primitive, so a bug that cancels out symmetrically across that round
    // trip (e.g. a sign error applied consistently both ways) could still
    // pass every check so far. An independently-computed expectation closes
    // that gap.
    expect(created.start_date).toBe(independentParisWallClock(startedAt));
    expect(created.end_date).toBe(independentParisWallClock(endedAt));

    // The snapshot re-read (under the read-only app client, also
    // Europe/Paris-configured) correctly converts those zoned strings back
    // to the SAME real UTC instants — not off by the zone's offset.
    const row = await prisma.itopTimeEntry.findUniqueOrThrow({ where: { id: res.body.entry.id } });
    expect(row.startDate.getTime()).toBe(startedAt.getTime());
    expect(row.endDate?.getTime()).toBe(endedAt.getTime());
    expect(row.startDate.toISOString()).toBe(startedAt.toISOString());
    expect(row.endDate?.toISOString()).toBe(endedAt.toISOString());
  });
});

describe("myMinutesThisWeek", () => {
  // Pinned to a fixed mid-week UTC instant (Wednesday noon) so the
  // week-boundary arithmetic these two tests exercise — "this week" vs
  // "last week", and a Sunday-20:00Z instant's local-offset shift into the
  // FOLLOWING week — is deterministic regardless of what day/hour this
  // suite actually runs at, rather than merely unlikely to land on a
  // boundary. Only `Date` is faked (never timers) — the DB/HTTP/fake-iTop
  // I/O these tests do all still run on real event-loop timers; `new Date()`
  // calls inside the app under test (same process, same global `Date`) see
  // this same fixed instant too, which is exactly what makes it safe as a
  // shared "now" between the test and the route.
  const FIXED_NOW = new Date("2026-09-23T12:00:00.000Z"); // a Wednesday

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sums this week's entries on the ticket and ignores an entry from last week", async () => {
    await linkPersonalToken(fixture.rina.userId, FAKE_ITOP_TOKENS.rina);
    const ref = "R-004535";
    const id = await ticketIdByRef(ref);

    const now = new Date();
    const first = await call("post", `/itop/tickets/${id}/time`, fixture.rina.token, {
      startedAt: new Date(now.getTime() - 90 * MINUTE_MS).toISOString(),
      endedAt: new Date(now.getTime() - 60 * MINUTE_MS).toISOString(),
    });
    expect(first.status).toBe(201);
    expect(first.body.entry.durationMinutes).toBe(30);

    const second = await call("post", `/itop/tickets/${id}/time`, fixture.rina.token, {
      startedAt: new Date(now.getTime() - 30 * MINUTE_MS).toISOString(),
      endedAt: now.toISOString(),
    });
    expect(second.status).toBe(201);
    expect(second.body.entry.durationMinutes).toBe(30);

    const ticketRow = await prisma.itopTicket.findUniqueOrThrow({ where: { id } });

    // A last-week entry on the SAME ticket for the SAME user, inserted
    // directly (the route itself would refuse anything past the 8-week
    // window's OTHER end, not this one, but going through it would also
    // need it to be at least a week old — simplest to insert the snapshot
    // row exactly like a sync would). 8 calendar days back always falls
    // outside the current Mon..Sun ISO week, regardless of what day this
    // test happens to run on.
    await prisma.itopTimeEntry.create({
      data: {
        id: 9_000_001,
        itopUserId: 1,
        userId: fixture.rina.userId,
        orgId: 1,
        customerId: ticketRow.customerId,
        ticketId: id,
        ticketRef: ref,
        startDate: new Date(now.getTime() - 8 * 24 * HOUR_MS),
        endDate: new Date(now.getTime() - 8 * 24 * HOUR_MS + HOUR_MS),
        durationMinutes: 999,
        title: "Last week",
        syncedAt: new Date(),
      },
    });

    const read = await call("get", `/itop/tickets/${id}`, fixture.rina.token);
    expect(read.status).toBe(200);
    expect(read.body.myMinutesThisWeek).toBe(60);
  });

  it("shifts the week boundary by the viewer's local utcOffsetMinutes", async () => {
    await linkPersonalToken(fixture.rina.userId, FAKE_ITOP_TOKENS.rina);
    const ref = "R-004535";
    const id = await ticketIdByRef(ref);
    const ticketRow = await prisma.itopTicket.findUniqueOrThrow({ where: { id } });

    // Sunday 20:00 UTC of the ISO week containing "now" — the last day of
    // the CURRENT UTC week, computed via the same isoWeek helper the route
    // itself uses rather than hand-rolled day-of-week arithmetic.
    const todayUtc = new Date().toISOString().slice(0, 10);
    const week = parseWeekKey(weekKeyOf(todayUtc))!;
    const sunday = week.days[6];
    const sunday20Utc = new Date(`${sunday}T20:00:00.000Z`);

    await prisma.itopTimeEntry.create({
      data: {
        id: 9_000_002,
        itopUserId: 1,
        userId: fixture.rina.userId,
        orgId: 1,
        customerId: ticketRow.customerId,
        ticketId: id,
        ticketRef: ref,
        startDate: sunday20Utc,
        endDate: new Date(sunday20Utc.getTime() + 30 * MINUTE_MS),
        durationMinutes: 30,
        title: "Sunday evening",
        syncedAt: new Date(),
      },
    });

    // At UTC (no shift), Sunday 20:00 is still THIS week.
    const utcRead = await call("get", `/itop/tickets/${id}`, fixture.rina.token);
    expect(utcRead.status).toBe(200);
    expect(utcRead.body.myMinutesThisWeek).toBe(30);

    // At UTC+7 (utcOffsetMinutes: 420), that same instant is Monday 03:00
    // LOCAL — the FOLLOWING local ISO week — so it must be excluded here.
    const localRead = await call("get", `/itop/tickets/${id}?utcOffsetMinutes=420`, fixture.rina.token);
    expect(localRead.status).toBe(200);
    expect(localRead.body.myMinutesThisWeek).toBe(0);
  });
});

describe("validation", () => {
  it("400s when endedAt is not after startedAt", async () => {
    await linkPersonalToken(fixture.rina.userId, FAKE_ITOP_TOKENS.rina);
    const id = await ticketIdByRef("R-004535");
    const now = new Date();

    const res = await call("post", `/itop/tickets/${id}/time`, fixture.rina.token, {
      startedAt: now.toISOString(),
      endedAt: now.toISOString(),
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_time_range");
  });

  it("400s an entry longer than 24 hours", async () => {
    await linkPersonalToken(fixture.rina.userId, FAKE_ITOP_TOKENS.rina);
    const id = await ticketIdByRef("R-004535");
    const now = new Date();

    const res = await call("post", `/itop/tickets/${id}/time`, fixture.rina.token, {
      startedAt: new Date(now.getTime() - 25 * HOUR_MS).toISOString(),
      endedAt: now.toISOString(),
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_duration");
  });

  it("400s an entry shorter than 1 minute", async () => {
    await linkPersonalToken(fixture.rina.userId, FAKE_ITOP_TOKENS.rina);
    const id = await ticketIdByRef("R-004535");
    const now = new Date();

    const res = await call("post", `/itop/tickets/${id}/time`, fixture.rina.token, {
      startedAt: new Date(now.getTime() - 30_000).toISOString(),
      endedAt: now.toISOString(),
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_duration");
  });

  it("400s a start time in the future", async () => {
    await linkPersonalToken(fixture.rina.userId, FAKE_ITOP_TOKENS.rina);
    const id = await ticketIdByRef("R-004535");
    const now = new Date();

    const res = await call("post", `/itop/tickets/${id}/time`, fixture.rina.token, {
      startedAt: new Date(now.getTime() + 10 * MINUTE_MS).toISOString(),
      endedAt: new Date(now.getTime() + 40 * MINUTE_MS).toISOString(),
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("started_in_future");
  });

  it("400s a start time older than the 8-week sync window", async () => {
    await linkPersonalToken(fixture.rina.userId, FAKE_ITOP_TOKENS.rina);
    const id = await ticketIdByRef("R-004535");
    const now = new Date();
    const nineWeeksAgo = new Date(now.getTime() - 9 * 7 * 24 * HOUR_MS);

    const res = await call("post", `/itop/tickets/${id}/time`, fixture.rina.token, {
      startedAt: nineWeeksAgo.toISOString(),
      endedAt: new Date(nineWeeksAgo.getTime() + 30 * MINUTE_MS).toISOString(),
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("started_too_old");
  });
});

describe("iTop refusal", () => {
  it("surfaces iTop's refusal verbatim when the ticket ref no longer exists in iTop", async () => {
    await linkPersonalToken(fixture.rina.userId, FAKE_ITOP_TOKENS.rina);
    const ref = "R-004535";
    const id = await ticketIdByRef(ref);

    // Makes the fake and Solvro's own snapshot disagree about the ticket,
    // so the fake's create refuses the ref exactly like a real iTop
    // foreign-key check would — Solvro's own preconditions have nothing to
    // say about this case, so it's the one genuine "iTop refused it" path
    // reachable through this route.
    const fakeTicket = [...fixture.state.tickets.values()].find((t) => t.ref === ref);
    if (fakeTicket) fixture.state.tickets.delete(fakeTicket.id);

    const now = new Date();
    const res = await call("post", `/itop/tickets/${id}/time`, fixture.rina.token, {
      startedAt: new Date(now.getTime() - 30 * MINUTE_MS).toISOString(),
      endedAt: now.toISOString(),
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("itop_refused");
    expect(res.body.error).toContain(ref);

    const writes = fixture.state.writeLog.filter((w) => w.operation === "core/create");
    expect(writes).toHaveLength(1);
    expect(writes[0].token).toBe(FAKE_ITOP_TOKENS.rina);

    const stored = await prisma.itopTimeEntry.findFirst({ where: { ticketId: id } });
    expect(stored).toBeNull();
  });
});

describe("re-read after a successful create", () => {
  it("202s with created:true and staleAfterWrite:true when the post-create re-read fails", async () => {
    await linkPersonalToken(fixture.rina.userId, FAKE_ITOP_TOKENS.rina);
    const id = await ticketIdByRef("R-004535");

    // The create itself (under Rina's own token) must succeed normally —
    // only the APPLICATION token's subsequent core/get is made to fail,
    // simulating e.g. iTop going briefly unreachable right after.
    // disabledClasses only gates core/get (never core/create — see the
    // similar 202 test in ticketCreate.test.ts), so the create still goes
    // through.
    fixture.state.disabledClasses.add("TimeSpent");

    const now = new Date();
    const res = await call("post", `/itop/tickets/${id}/time`, fixture.rina.token, {
      startedAt: new Date(now.getTime() - 30 * MINUTE_MS).toISOString(),
      endedAt: now.toISOString(),
    });

    expect(res.status).toBe(202);
    expect(res.body.created).toBe(true);
    expect(res.body.staleAfterWrite).toBe(true);
    expect(typeof res.body.id).toBe("number");

    // The create itself must not have been retried.
    const writes = fixture.state.writeLog.filter((w) => w.operation === "core/create");
    expect(writes).toHaveLength(1);
  });
});
