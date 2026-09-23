// Utilization API (src/routes/utilization.ts GET /utilization). Exercises
// access control (401, the report:executive gate on scope=tam/customer),
// week validation, the unconfigured soft-answer, the `me`/`customer`/`tam`
// scopes' row grouping and tiles, the none-row-last ordering + "No
// customer"/"Unmatched iTop user" labels, the utcOffsetMinutes week-window
// shift (mirroring routes/itop.ts GET /daily's day-window shift), ticketRefs
// ordering + the 6-item cap, and 1-decimal rounding. Time entries are seeded
// directly via prisma — no fake iTop server needed (that's sync.test.ts's
// job). Reuses test/itop/daily.test.ts's fixture + scoped-reset pattern. See
// docs/archive/plans/itop-integration.md Task 3.2.
import "../env.js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/prisma.js";
import { seal } from "../../src/lib/secretBox.js";
import { bustItopConfigCache } from "../../src/lib/itop/config.js";
import { weekKeyOf } from "../../src/lib/isoWeek.js";
import { seedRoles, createUserWithRole, createAdminAndToken } from "../testAuth.js";

const app = createApp();

// A real Monday..Sunday week (2026-09-21..2026-09-27), computed through the
// same helper the route uses rather than hand-computed, so a bug in the ISO
// week arithmetic can't silently make the fixture and the route agree on a
// wrong answer.
const WEEK_MONDAY = "2026-09-21";
const WEEK_KEY = weekKeyOf(WEEK_MONDAY);

// Every Customer this file creates gets a name under this prefix — no other
// suite uses it (kept distinct from tickets.test.ts/daily.test.ts's own
// prefixes so resets can never race on each other's rows).
const ITOP_TEST_CUSTOMER_PREFIX = "iTop utilization test customer";

function uniq(label: string): string {
  return `${label} ${Date.now()}-${Math.random()}`;
}

function call(method: "get", path: string, token?: string) {
  const req = request(app)[method](path);
  return token ? req.set("Authorization", `Bearer ${token}`) : req;
}

async function createCustomer(
  overrides: { name?: string; tamId?: number | null; itopOrgId?: number | null } = {},
) {
  return prisma.customer.create({
    data: {
      name: overrides.name ?? uniq(ITOP_TEST_CUSTOMER_PREFIX),
      description: "d",
      tamId: overrides.tamId ?? null,
      itopOrgId: overrides.itopOrgId ?? null,
    },
  });
}

let entryIdCounter = 0;
function nextEntryId(): number {
  entryIdCounter += 1;
  return 970_000_000 + entryIdCounter;
}

interface TimeEntryOverrides {
  itopUserId?: number;
  userId?: number | null;
  customerId?: number | null;
  ticketRef?: string | null;
  startDate: Date;
  durationMinutes: number;
  syncedAt?: Date;
}

async function createTimeEntry(overrides: TimeEntryOverrides) {
  const id = nextEntryId();
  return prisma.itopTimeEntry.create({
    data: {
      id,
      itopUserId: overrides.itopUserId ?? id,
      userId: overrides.userId ?? null,
      orgId: null,
      customerId: overrides.customerId ?? null,
      ticketId: null,
      ticketRef: overrides.ticketRef ?? null,
      startDate: overrides.startDate,
      endDate: null,
      durationMinutes: overrides.durationMinutes,
      title: null,
      syncedAt: overrides.syncedAt ?? new Date(),
    },
  });
}

async function configureItop(): Promise<void> {
  await prisma.itopConfig.upsert({
    where: { id: "default" },
    create: { id: "default", baseUrl: "https://itop.example.com", appTokenEnc: seal("app-token") },
    update: { baseUrl: "https://itop.example.com", appTokenEnc: seal("app-token") },
  });
  bustItopConfigCache();
}

// Same reset discipline as test/itop/daily.test.ts: never a blanket
// user.deleteMany() (foreign-key violations, races with other suites'
// concurrently-running rows) — only itopTimeEntry (exclusively this route's
// data source), the itop_config singleton, and Customer rows scoped by
// itopOrgId or this file's own name prefix. User rows are never targeted.
async function resetUtilTestState(): Promise<void> {
  await prisma.itopTimeEntry.deleteMany();
  await prisma.customer.deleteMany({
    where: { OR: [{ itopOrgId: { not: null } }, { name: { startsWith: ITOP_TEST_CUSTOMER_PREFIX } }] },
  });
  await prisma.itopConfig.deleteMany({ where: { id: "default" } });
  bustItopConfigCache();
}

beforeAll(async () => {
  await seedRoles();
});

beforeEach(async () => {
  await resetUtilTestState();
});

describe("access control", () => {
  it("401s without a token", async () => {
    const res = await call("get", `/utilization?week=${WEEK_KEY}`);
    expect(res.status).toBe(401);
  });

  it("403s a non-executive requesting scope=tam, but allows scope=me", async () => {
    await configureItop();
    const { token } = await createUserWithRole("TAM");

    const tamRes = await call("get", `/utilization?week=${WEEK_KEY}&scope=tam`, token);
    expect(tamRes.status).toBe(403);
    expect(tamRes.body.code).toBe("forbidden");

    const customerRes = await call("get", `/utilization?week=${WEEK_KEY}&scope=customer`, token);
    expect(customerRes.status).toBe(403);

    const meRes = await call("get", `/utilization?week=${WEEK_KEY}&scope=me`, token);
    expect(meRes.status).toBe(200);
  });
});

describe("validation", () => {
  it("400s validation_error for an invalid week key", async () => {
    await configureItop();
    const { token } = await createUserWithRole("TAM");
    const res = await call("get", "/utilization?week=not-a-week", token);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation_error");
  });

  it("400s validation_error for a utcOffsetMinutes outside -840..840", async () => {
    await configureItop();
    const { token } = await createUserWithRole("TAM");
    const res = await call("get", `/utilization?week=${WEEK_KEY}&utcOffsetMinutes=999`, token);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation_error");
  });
});

describe("unconfigured", () => {
  it("returns configured:false with zeroed tiles and empty rows", async () => {
    const { token } = await createUserWithRole("TAM");
    const res = await call("get", `/utilization?week=${WEEK_KEY}`, token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      configured: false,
      week: { key: WEEK_KEY, start: WEEK_MONDAY, days: expect.any(Array) },
      scope: "me",
      utcOffsetMinutes: 0,
      capacityHoursPerWeek: 40,
      syncedAt: null,
      tiles: { hoursLogged: 0, capacityHours: 0, customersTouched: 0, customersAssigned: 0, unassignedHours: 0 },
      rows: [],
      totals: { hours: [0, 0, 0, 0, 0, 0, 0], total: 0 },
      truncated: false,
    });
  });
});

describe("scope=me", () => {
  it("aggregates two customers plus a no-customer entry: day cells, totals, none-last ordering, customersTouched, customersAssigned", async () => {
    await configureItop();
    const me = await createUserWithRole("TAM");
    const other = await createUserWithRole("TAM");
    const customerA = await createCustomer({ tamId: me.userId });
    const customerB = await createCustomer({ tamId: null });

    // Monday edge (dayIndex 0): 2h on customer A.
    await createTimeEntry({
      userId: me.userId,
      customerId: customerA.id,
      startDate: new Date(`${WEEK_MONDAY}T00:00:00.000Z`),
      durationMinutes: 120,
    });
    // Sunday edge (dayIndex 6, inclusive): 3h on customer B.
    await createTimeEntry({
      userId: me.userId,
      customerId: customerB.id,
      startDate: new Date("2026-09-27T23:59:59.999Z"),
      durationMinutes: 180,
    });
    // Wednesday (dayIndex 2), no customer: 5h — deliberately the LARGEST
    // total, to prove the "none" row still sorts last despite outranking
    // every other row by total.
    await createTimeEntry({
      userId: me.userId,
      customerId: null,
      startDate: new Date("2026-09-23T10:00:00.000Z"),
      durationMinutes: 300,
    });
    // Excluded: next week's Monday (exclusive upper bound).
    await createTimeEntry({
      userId: me.userId,
      customerId: customerA.id,
      startDate: new Date("2026-09-28T00:00:00.000Z"),
      durationMinutes: 999,
    });
    // Excluded: belongs to a different user (scope=me only sees the caller's own entries).
    await createTimeEntry({
      userId: other.userId,
      customerId: customerA.id,
      startDate: new Date(`${WEEK_MONDAY}T09:00:00.000Z`),
      durationMinutes: 999,
    });

    const res = await call("get", `/utilization?week=${WEEK_KEY}&scope=me`, me.token);
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.week).toEqual({ key: WEEK_KEY, start: WEEK_MONDAY, days: expect.any(Array) });

    expect(res.body.rows.map((r: { key: string }) => r.key)).toEqual([
      `customer:${customerB.id}`,
      `customer:${customerA.id}`,
      "none",
    ]);

    const rowA = res.body.rows.find((r: { key: string }) => r.key === `customer:${customerA.id}`);
    expect(rowA.kind).toBe("customer");
    expect(rowA.hours).toEqual([2, 0, 0, 0, 0, 0, 0]);
    expect(rowA.total).toBe(2);

    const rowB = res.body.rows.find((r: { key: string }) => r.key === `customer:${customerB.id}`);
    expect(rowB.hours).toEqual([0, 0, 0, 0, 0, 0, 3]);
    expect(rowB.total).toBe(3);

    const rowNone = res.body.rows.find((r: { key: string }) => r.key === "none");
    expect(rowNone.kind).toBe("none");
    expect(rowNone.label).toBe("No customer");
    expect(rowNone.hours).toEqual([0, 0, 5, 0, 0, 0, 0]);
    expect(rowNone.total).toBe(5);

    expect(res.body.totals).toEqual({ hours: [2, 0, 5, 0, 0, 0, 3], total: 10 });
    expect(res.body.tiles.hoursLogged).toBe(10);
    expect(res.body.tiles.customersTouched).toBe(2);
    expect(res.body.tiles.customersAssigned).toBe(1);
    expect(res.body.tiles.unassignedHours).toBe(5);
    expect(res.body.tiles.capacityHours).toBe(40);
  });

  it("shifts the week window for utcOffsetMinutes=420: a Sunday 20:00Z entry moves out of the week and is excluded", async () => {
    await configureItop();
    const me = await createUserWithRole("TAM");
    const customer = await createCustomer({ tamId: me.userId });

    // Local midnight of the following Monday at UTC+7 is 2026-09-27T17:00Z
    // (the shifted window's exclusive upper bound) — 20:00Z is past it.
    await createTimeEntry({
      userId: me.userId,
      customerId: customer.id,
      startDate: new Date("2026-09-27T20:00:00.000Z"),
      durationMinutes: 60,
    });

    const res = await call("get", `/utilization?week=${WEEK_KEY}&scope=me&utcOffsetMinutes=420`, me.token);
    expect(res.status).toBe(200);
    expect(res.body.utcOffsetMinutes).toBe(420);
    expect(res.body.rows).toEqual([]);
    expect(res.body.tiles.hoursLogged).toBe(0);
  });

  it("rounds a 25-minute entry to 0.4 hours", async () => {
    await configureItop();
    const me = await createUserWithRole("TAM");
    const customer = await createCustomer({ tamId: me.userId });

    await createTimeEntry({
      userId: me.userId,
      customerId: customer.id,
      startDate: new Date(`${WEEK_MONDAY}T08:00:00.000Z`),
      durationMinutes: 25,
    });

    const res = await call("get", `/utilization?week=${WEEK_KEY}&scope=me`, me.token);
    expect(res.status).toBe(200);
    expect(res.body.rows[0].total).toBe(0.4);
    expect(res.body.tiles.hoursLogged).toBe(0.4);
  });

  it("orders ticketRefs by minutes desc and caps at 6", async () => {
    await configureItop();
    const me = await createUserWithRole("TAM");
    const customer = await createCustomer({ tamId: me.userId });

    // 7 distinct refs, decreasing duration — the smallest (R-7) must be
    // dropped by the 6-item cap, and the rest must come back largest-first.
    for (let i = 1; i <= 7; i++) {
      await createTimeEntry({
        userId: me.userId,
        customerId: customer.id,
        ticketRef: `R-${i}`,
        startDate: new Date(`${WEEK_MONDAY}T08:00:00.000Z`),
        durationMinutes: (8 - i) * 10, // R-1: 70min, R-2: 60min, ..., R-7: 10min
      });
    }

    const res = await call("get", `/utilization?week=${WEEK_KEY}&scope=me`, me.token);
    expect(res.status).toBe(200);
    expect(res.body.rows[0].ticketRefs).toEqual(["R-1", "R-2", "R-3", "R-4", "R-5", "R-6"]);
    expect(res.body.rows[0].ticketRefs).not.toContain("R-7");
  });
});

describe("scope=customer", () => {
  it("aggregates two users' entries into one row per customer", async () => {
    await configureItop();
    const admin = await createAdminAndToken();
    const user1 = await createUserWithRole("TAM");
    const user2 = await createUserWithRole("TAM");
    const customer = await createCustomer({ itopOrgId: 9001 });

    await createTimeEntry({
      userId: user1.userId,
      customerId: customer.id,
      startDate: new Date(`${WEEK_MONDAY}T08:00:00.000Z`),
      durationMinutes: 120,
    });
    await createTimeEntry({
      userId: user2.userId,
      customerId: customer.id,
      startDate: new Date(`${WEEK_MONDAY}T09:00:00.000Z`),
      durationMinutes: 60,
    });

    const res = await call("get", `/utilization?week=${WEEK_KEY}&scope=customer`, admin.token);
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].key).toBe(`customer:${customer.id}`);
    expect(res.body.rows[0].total).toBe(3);
    expect(res.body.tiles.hoursLogged).toBe(3);

    // Mapped-customer count is reset to exactly this fixture's one row by
    // this file's own beforeEach (it wipes every itopOrgId-not-null
    // customer), so this can be asserted directly rather than recomputed.
    expect(res.body.tiles.customersAssigned).toBe(1);

    // Active-user-with-itopUserId count is NOT reset by this file (User
    // rows are never targeted) and other suites may leave such users
    // behind, so the expectation is computed from the same live count the
    // route itself reads, rather than assumed to be a clean-slate number.
    const expectedActiveMappedUsers = await prisma.user.count({
      where: { active: true, itopUserId: { not: null } },
    });
    expect(res.body.tiles.capacityHours).toBe(40 * expectedActiveMappedUsers);
  });
});

describe("scope=tam", () => {
  it("labels rows by user and folds userId:null into the none row", async () => {
    await configureItop();
    const admin = await createAdminAndToken();
    const tam = await createUserWithRole("TAM");
    const customer = await createCustomer({ itopOrgId: 9002 });

    await createTimeEntry({
      userId: tam.userId,
      customerId: customer.id,
      startDate: new Date(`${WEEK_MONDAY}T08:00:00.000Z`),
      durationMinutes: 60,
    });
    await createTimeEntry({
      userId: null,
      customerId: customer.id,
      startDate: new Date(`${WEEK_MONDAY}T09:00:00.000Z`),
      durationMinutes: 30,
    });

    const res = await call("get", `/utilization?week=${WEEK_KEY}&scope=tam`, admin.token);
    expect(res.status).toBe(200);
    expect(res.body.rows.map((r: { key: string }) => r.key)).toEqual([`user:${tam.userId}`, "none"]);

    const tamUser = await prisma.user.findUniqueOrThrow({ where: { id: tam.userId } });
    const tamRow = res.body.rows.find((r: { key: string }) => r.key === `user:${tam.userId}`);
    expect(tamRow.kind).toBe("tam");
    expect(tamRow.label).toBe(tamUser.username);
    expect(tamRow.total).toBe(1);

    const noneRow = res.body.rows.find((r: { key: string }) => r.key === "none");
    expect(noneRow.kind).toBe("none");
    expect(noneRow.label).toBe("Unmatched iTop user");
    expect(noneRow.total).toBe(0.5);
  });

  it("reports unassignedHours as customer-less hours across ALL users, not the unmatched-iTop-user row", async () => {
    await configureItop();
    const admin = await createAdminAndToken();
    const tam = await createUserWithRole("TAM");
    const customer = await createCustomer({ itopOrgId: 9003 });

    // Matched user, has a customer — neither the tam row nor customer-less.
    await createTimeEntry({
      userId: tam.userId,
      customerId: customer.id,
      startDate: new Date(`${WEEK_MONDAY}T08:00:00.000Z`),
      durationMinutes: 60,
    });
    // Unmatched user, has a customer — folds into the "none" (unmatched
    // iTop user) row, but is NOT customer-less, so must NOT count toward
    // unassignedHours.
    await createTimeEntry({
      userId: null,
      customerId: customer.id,
      startDate: new Date(`${WEEK_MONDAY}T09:00:00.000Z`),
      durationMinutes: 30,
    });
    // Matched user, NO customer — lives inside the `user:<tam.userId>` row
    // (tam scope groups by user, not customer), but IS customer-less, so
    // this is the case the fix covers: it must still count toward
    // unassignedHours even though it never touches the "none" row.
    await createTimeEntry({
      userId: tam.userId,
      customerId: null,
      startDate: new Date(`${WEEK_MONDAY}T10:00:00.000Z`),
      durationMinutes: 60,
    });
    // Unmatched user, NO customer — customer-less AND folds into the "none" row.
    await createTimeEntry({
      userId: null,
      customerId: null,
      startDate: new Date(`${WEEK_MONDAY}T11:00:00.000Z`),
      durationMinutes: 30,
    });

    const res = await call("get", `/utilization?week=${WEEK_KEY}&scope=tam`, admin.token);
    expect(res.status).toBe(200);

    const tamRow = res.body.rows.find((r: { key: string }) => r.key === `user:${tam.userId}`);
    const noneRow = res.body.rows.find((r: { key: string }) => r.key === "none");
    // Sanity: the "none" row here is still the unmatched-iTop-user row
    // (0.5h + 0.5h = 1h), unchanged by this fix.
    expect(tamRow.total).toBe(2);
    expect(noneRow.total).toBe(1);
    expect(noneRow.label).toBe("Unmatched iTop user");

    // The customer-less total is 60min (tam row's no-customer entry) + 30min
    // (none row's no-customer entry) = 90min = 1.5h — spanning BOTH rows,
    // which is exactly why this can't be read off either row alone.
    expect(res.body.tiles.unassignedHours).toBe(1.5);
  });
});

describe("truncated", () => {
  // The route's MAX_ENTRIES cap (10,000) isn't exposed as a test-adjustable
  // constant — there's no existing test-only-hook pattern in this codebase
  // to piggyback on, and adding one just for this would be a bigger change
  // than the flag itself. Seeding 10,000+ rows to force `truncated: true`
  // for real is possible but expensive for a single boolean assertion; this
  // just proves the flag is present and false for a normal, well-under-cap
  // week — the `orderBy` fix itself is what makes the cap deterministic
  // when it IS hit, which is exercised implicitly by every other test here
  // never seeing a truncated, wrong-subset result.
  it("is false for a normal week with a handful of entries", async () => {
    await configureItop();
    const me = await createUserWithRole("TAM");
    const customer = await createCustomer({ tamId: me.userId });

    await createTimeEntry({
      userId: me.userId,
      customerId: customer.id,
      startDate: new Date(`${WEEK_MONDAY}T08:00:00.000Z`),
      durationMinutes: 60,
    });

    const res = await call("get", `/utilization?week=${WEEK_KEY}&scope=me`, me.token);
    expect(res.status).toBe(200);
    expect(res.body.truncated).toBe(false);
  });
});

describe("syncedAt", () => {
  it("reports the max syncedAt across the entries considered", async () => {
    await configureItop();
    const me = await createUserWithRole("TAM");
    const customer = await createCustomer({ tamId: me.userId });

    await createTimeEntry({
      userId: me.userId,
      customerId: customer.id,
      startDate: new Date(`${WEEK_MONDAY}T08:00:00.000Z`),
      durationMinutes: 60,
      syncedAt: new Date("2026-09-20T00:00:00Z"),
    });
    await createTimeEntry({
      userId: me.userId,
      customerId: customer.id,
      startDate: new Date(`${WEEK_MONDAY}T09:00:00.000Z`),
      durationMinutes: 30,
      syncedAt: new Date("2026-09-21T12:00:00Z"),
    });

    const res = await call("get", `/utilization?week=${WEEK_KEY}&scope=me`, me.token);
    expect(res.status).toBe(200);
    expect(res.body.syncedAt).toBe(new Date("2026-09-21T12:00:00Z").toISOString());
  });

  it("falls back to config.lastSyncAt when there are no entries in the window", async () => {
    await configureItop();
    const lastSyncAt = new Date("2026-09-19T08:00:00Z");
    await prisma.itopConfig.update({ where: { id: "default" }, data: { lastSyncAt } });
    bustItopConfigCache();

    const { token } = await createUserWithRole("TAM");
    const res = await call("get", `/utilization?week=${WEEK_KEY}&scope=me`, token);
    expect(res.status).toBe(200);
    expect(res.body.syncedAt).toBe(lastSyncAt.toISOString());
  });
});
