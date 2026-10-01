// Daily Review strip API (src/routes/itop.ts GET /daily). Exercises the
// unconfigured soft-answer, customer visibility (hidden TAM-owned customer
// excluded, unowned tamId:null customer included), the unmapped-customer
// exclusion, same-day counts across the UTC-midnight day boundary, the
// viewer-local-day `utcOffsetMinutes` shift of that boundary, slaBreached
// being restricted to ongoing rows, the recent-tickets per-customer
// top-3/order, isMine, and invalid `date`/`utcOffsetMinutes` validation.
// Tickets are seeded directly via prisma — no fake iTop server needed
// (that's sync.test.ts's job). Reuses test/itop/tickets.test.ts's fixture +
// scoped-reset pattern exactly. See docs/archive/plans/itop-integration.md
// Task 2.1.
import "../env.js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/prisma.js";
import { seal } from "../../src/lib/secretBox.js";
import { bustItopConfigCache } from "../../src/lib/itop/config.js";
import { seedRoles, createUserWithRole } from "../testAuth.js";

const app = createApp();

// Every Customer this file creates gets a name under this prefix — including
// the "unmapped" fixtures (itopOrgId left null), which resetItopTestState
// below can't otherwise distinguish from a Customer some unrelated suite
// created. No other suite uses this prefix (kept distinct from
// tickets.test.ts's own prefix so the two files' resets can never race on
// each other's rows if ever run in the same worker).
const ITOP_TEST_CUSTOMER_PREFIX = "iTop daily test customer";

function uniq(label: string): string {
  return `${label} ${Date.now()}-${Math.random()}`;
}

function call(method: "get", path: string, token?: string) {
  const req = request(app)[method](path);
  return token ? req.set("Authorization", `Bearer ${token}`) : req;
}

async function createCustomer(
  overrides: { name?: string; tamId?: number | null; itopOrgId?: number | null; itopOrgName?: string | null } = {},
) {
  return prisma.customer.create({
    data: {
      name: overrides.name ?? uniq(ITOP_TEST_CUSTOMER_PREFIX),
      description: "d",
      tamId: overrides.tamId ?? null,
      itopOrgId: overrides.itopOrgId ?? null,
      itopOrgName: overrides.itopOrgName ?? null,
    },
  });
}

let ticketIdCounter = 0;
function nextTicketId(): number {
  ticketIdCounter += 1;
  return 910_000_000 + ticketIdCounter;
}

interface TicketOverrides {
  id?: number;
  class?: string;
  ref?: string;
  title?: string;
  status?: string;
  agentPersonId?: number | null;
  orgId?: number;
  customerId?: number | null;
  startDate?: Date | null;
  lastUpdate?: Date;
  slaTtoPassed?: boolean;
  slaTtrPassed?: boolean;
  resolutionDate?: Date | null;
  syncedAt?: Date;
}

async function createTicket(overrides: TicketOverrides = {}) {
  const id = overrides.id ?? nextTicketId();
  return prisma.itopTicket.create({
    data: {
      id,
      class: overrides.class ?? "UserRequest",
      ref: overrides.ref ?? `D-${id}`,
      title: overrides.title ?? "Test ticket",
      status: overrides.status ?? "new",
      operationalStatus: null,
      priority: null,
      agentPersonId: overrides.agentPersonId ?? null,
      agentName: null,
      teamName: null,
      serviceName: null,
      callerName: null,
      orgId: overrides.orgId ?? 1,
      customerId: overrides.customerId ?? null,
      startDate: overrides.startDate ?? null,
      lastUpdate: overrides.lastUpdate ?? new Date(),
      tto: null,
      ttr: null,
      slaTtoPassed: overrides.slaTtoPassed ?? false,
      slaTtrPassed: overrides.slaTtrPassed ?? false,
      resolutionDate: overrides.resolutionDate ?? null,
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

// Same reset discipline as test/itop/tickets.test.ts: never a blanket
// user.deleteMany()/customer.deleteMany() (foreign-key violations, races
// with other suites' concurrently-running rows under `npm test`) — only the
// rows this file owns: itopTicket (exclusively this integration's table),
// the itop_config singleton, and Customer rows scoped by itopOrgId or this
// file's own name prefix. User rows are never targeted — every user here
// comes from createUserWithRole()'s auto-generated, timestamp-unique email.
// Run BEFORE every test so the first test starts clean regardless of what
// ran before it.
async function resetItopTestState(): Promise<void> {
  await prisma.itopTicket.deleteMany();
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
  await resetItopTestState();
});

describe("access control", () => {
  it("401s without a token", async () => {
    const res = await call("get", "/itop/daily?date=2026-09-22");
    expect(res.status).toBe(401);
  });
});

describe("GET /itop/daily — unconfigured", () => {
  it("returns configured:false with no customers when iTop isn't connected", async () => {
    const { token } = await createUserWithRole("TAM");
    const res = await call("get", "/itop/daily?date=2026-09-22", token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: false, date: "2026-09-22", utcOffsetMinutes: 0, customers: [] });
  });
});

describe("GET /itop/daily — validation", () => {
  it("400s validation_error for an invalid date", async () => {
    await configureItop();
    const { token } = await createUserWithRole("TAM");
    const res = await call("get", "/itop/daily?date=not-a-date", token);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation_error");
  });

  it("400s validation_error for a calendrically-invalid date (Feb 30)", async () => {
    await configureItop();
    const { token } = await createUserWithRole("TAM");
    const res = await call("get", "/itop/daily?date=2026-02-30", token);
    expect(res.status).toBe(400);
  });

  it("400s validation_error when the date query param is missing entirely", async () => {
    await configureItop();
    const { token } = await createUserWithRole("TAM");
    const res = await call("get", "/itop/daily", token);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation_error");
  });

  it("400s validation_error for a utcOffsetMinutes outside -840..840", async () => {
    await configureItop();
    const { token } = await createUserWithRole("TAM");
    const res = await call("get", "/itop/daily?date=2026-09-22&utcOffsetMinutes=999", token);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation_error");
  });

  it("defaults utcOffsetMinutes to 0 (UTC-midnight behaviour) when omitted", async () => {
    await configureItop();
    const { token } = await createUserWithRole("TAM");
    const res = await call("get", "/itop/daily?date=2026-09-22", token);
    expect(res.status).toBe(200);
    expect(res.body.utcOffsetMinutes).toBe(0);
  });
});

describe("GET /itop/daily — visibility and mapping", () => {
  it("excludes a customer owned by another TAM (hidden from the caller)", async () => {
    await configureItop();
    const owner = await createUserWithRole("TAM");
    const caller = await createUserWithRole("TAM");
    await createCustomer({ tamId: owner.userId, itopOrgId: 501, itopOrgName: "Hidden Org" });

    const res = await call("get", "/itop/daily?date=2026-09-22", caller.token);
    expect(res.status).toBe(200);
    expect(res.body.customers).toEqual([]);
  });

  it("includes an unowned (tamId: null) mapped customer for any TAM", async () => {
    await configureItop();
    const caller = await createUserWithRole("TAM");
    const customer = await createCustomer({ itopOrgId: 502, itopOrgName: "Open Org" });

    const res = await call("get", "/itop/daily?date=2026-09-22", caller.token);
    expect(res.status).toBe(200);
    expect(res.body.customers).toHaveLength(1);
    expect(res.body.customers[0].customerId).toBe(customer.id);
    expect(res.body.customers[0].orgName).toBe("Open Org");
  });

  it("excludes an unmapped customer (itopOrgId null) even when visible", async () => {
    await configureItop();
    const { token } = await createUserWithRole("TAM");
    await createCustomer(); // itopOrgId left null

    const res = await call("get", "/itop/daily?date=2026-09-22", token);
    expect(res.status).toBe(200);
    expect(res.body.customers).toEqual([]);
  });

  it("orders visible mapped customers by name", async () => {
    await configureItop();
    const { token } = await createUserWithRole("TAM");
    await createCustomer({ name: uniq(`${ITOP_TEST_CUSTOMER_PREFIX} Zeta`), itopOrgId: 510, itopOrgName: "Zeta Org" });
    await createCustomer({ name: uniq(`${ITOP_TEST_CUSTOMER_PREFIX} Alpha`), itopOrgId: 511, itopOrgName: "Alpha Org" });

    const res = await call("get", "/itop/daily?date=2026-09-22", token);
    expect(res.status).toBe(200);
    expect(res.body.customers).toHaveLength(2);
    expect(res.body.customers[0].customerName).toContain("Alpha");
    expect(res.body.customers[1].customerName).toContain("Zeta");
  });
});

describe("GET /itop/daily — counts across the day boundary", () => {
  it("newToday counts only tickets started within [dayStart, dayStart+24h)", async () => {
    await configureItop();
    const { token } = await createUserWithRole("TAM");
    const customer = await createCustomer({ itopOrgId: 520, itopOrgName: "Boundary Org" });

    // One tick before the day starts — must NOT count.
    await createTicket({
      customerId: customer.id,
      orgId: 520,
      startDate: new Date("2026-09-21T23:59:59.999Z"),
    });
    // Exactly at the day's start — must count.
    const onBoundary = await createTicket({
      customerId: customer.id,
      orgId: 520,
      startDate: new Date("2026-09-22T00:00:00.000Z"),
    });
    // Inside the day — must count.
    const midday = await createTicket({
      customerId: customer.id,
      orgId: 520,
      startDate: new Date("2026-09-22T12:00:00.000Z"),
    });
    // Exactly at the next day's start — must NOT count (exclusive upper bound).
    await createTicket({
      customerId: customer.id,
      orgId: 520,
      startDate: new Date("2026-09-23T00:00:00.000Z"),
    });

    const res = await call("get", "/itop/daily?date=2026-09-22", token);
    expect(res.status).toBe(200);
    const row = res.body.customers.find((c: { customerId: number }) => c.customerId === customer.id);
    expect(row.counts.newToday).toBe(2);
    const recentIds = row.recent.map((t: { id: number }) => t.id).sort((a: number, b: number) => a - b);
    expect(recentIds).toContain(onBoundary.id);
    expect(recentIds).toContain(midday.id);
  });

  it("newToday shifts to the viewer's local day at UTC+7 (utcOffsetMinutes=420): a ticket started 2026-09-21T17:00:00Z counts as new on 2026-09-22, one at 2026-09-22T17:00:00Z does not", async () => {
    await configureItop();
    const { token } = await createUserWithRole("TAM");
    const customer = await createCustomer({ itopOrgId: 560, itopOrgName: "Offset Org" });

    // Local midnight 2026-09-22 at UTC+7 is the UTC instant
    // 2026-09-21T17:00:00Z (7h before UTC midnight of the same date
    // string) — this is the new window's inclusive lower bound.
    const localMidnight = await createTicket({
      customerId: customer.id,
      orgId: 560,
      startDate: new Date("2026-09-21T17:00:00.000Z"),
    });
    // One tick before the shifted window — must NOT count.
    await createTicket({
      customerId: customer.id,
      orgId: 560,
      startDate: new Date("2026-09-21T16:59:59.999Z"),
    });
    // The shifted window's exclusive upper bound (local midnight the next
    // day, at UTC+7) — must NOT count.
    await createTicket({
      customerId: customer.id,
      orgId: 560,
      startDate: new Date("2026-09-22T17:00:00.000Z"),
    });

    const res = await call("get", "/itop/daily?date=2026-09-22&utcOffsetMinutes=420", token);
    expect(res.status).toBe(200);
    expect(res.body.utcOffsetMinutes).toBe(420);
    const row = res.body.customers.find((c: { customerId: number }) => c.customerId === customer.id);
    expect(row.counts.newToday).toBe(1);
    const recentIds = row.recent.map((t: { id: number }) => t.id);
    expect(recentIds).toContain(localMidnight.id);
  });

  it("newToday and resolvedToday shift the other way for a negative offset (utcOffsetMinutes=-300, UTC-5): the local day 2026-09-22 spans 05:00Z to 05:00Z next day", async () => {
    await configureItop();
    const { token } = await createUserWithRole("TAM");
    const customer = await createCustomer({ itopOrgId: 561, itopOrgName: "Negative Offset Org" });

    // Local midnight 2026-09-22 at UTC-5 is 2026-09-22T05:00:00Z — inclusive lower bound.
    await createTicket({ customerId: customer.id, orgId: 561, startDate: new Date("2026-09-22T05:00:00.000Z") });
    // 03:00Z is still 2026-09-21 local — must NOT count as new, but its resolution at 06:00Z is today.
    await createTicket({
      customerId: customer.id,
      orgId: 561,
      status: "resolved",
      startDate: new Date("2026-09-22T03:00:00.000Z"),
      resolutionDate: new Date("2026-09-22T06:00:00.000Z"),
    });
    // The exclusive upper bound — must NOT count.
    await createTicket({ customerId: customer.id, orgId: 561, startDate: new Date("2026-09-23T05:00:00.000Z") });

    const res = await call("get", "/itop/daily?date=2026-09-22&utcOffsetMinutes=-300", token);
    expect(res.status).toBe(200);
    expect(res.body.utcOffsetMinutes).toBe(-300);
    const row = res.body.customers.find((c: { customerId: number }) => c.customerId === customer.id);
    expect(row.counts.newToday).toBe(1);
    expect(row.counts.resolvedToday).toBe(1);
  });

  it("resolvedToday counts only tickets resolved within the day window, independent of status filtering elsewhere", async () => {
    await configureItop();
    const { token } = await createUserWithRole("TAM");
    const customer = await createCustomer({ itopOrgId: 521, itopOrgName: "Resolved Org" });

    await createTicket({
      customerId: customer.id,
      orgId: 521,
      status: "resolved",
      resolutionDate: new Date("2026-09-22T05:00:00.000Z"),
    });
    // Resolved the day before — must not count.
    await createTicket({
      customerId: customer.id,
      orgId: 521,
      status: "resolved",
      resolutionDate: new Date("2026-09-21T05:00:00.000Z"),
    });

    const res = await call("get", "/itop/daily?date=2026-09-22", token);
    expect(res.status).toBe(200);
    const row = res.body.customers.find((c: { customerId: number }) => c.customerId === customer.id);
    expect(row.counts.resolvedToday).toBe(1);
  });

  it("ongoing counts tickets not in resolved/closed status, regardless of date", async () => {
    await configureItop();
    const { token } = await createUserWithRole("TAM");
    const customer = await createCustomer({ itopOrgId: 522, itopOrgName: "Ongoing Org" });

    await createTicket({ customerId: customer.id, orgId: 522, status: "new" });
    await createTicket({ customerId: customer.id, orgId: 522, status: "assigned" });
    await createTicket({ customerId: customer.id, orgId: 522, status: "resolved" });
    await createTicket({ customerId: customer.id, orgId: 522, status: "closed" });

    const res = await call("get", "/itop/daily?date=2026-09-22", token);
    expect(res.status).toBe(200);
    const row = res.body.customers.find((c: { customerId: number }) => c.customerId === customer.id);
    expect(row.counts.ongoing).toBe(2);
  });

  it("slaBreached counts only ongoing rows with a passed SLA, excluding a resolved ticket with a passed SLA", async () => {
    await configureItop();
    const { token } = await createUserWithRole("TAM");
    const customer = await createCustomer({ itopOrgId: 523, itopOrgName: "SLA Org" });

    const breachedOngoing = await createTicket({
      customerId: customer.id,
      orgId: 523,
      status: "assigned",
      slaTtrPassed: true,
    });
    await createTicket({
      customerId: customer.id,
      orgId: 523,
      status: "new",
      slaTtoPassed: false,
      slaTtrPassed: false,
    });
    // Resolved AND SLA-passed — must not count as slaBreached (breach only
    // applies to ongoing tickets).
    await createTicket({
      customerId: customer.id,
      orgId: 523,
      status: "resolved",
      slaTtrPassed: true,
      resolutionDate: new Date(),
    });

    const res = await call("get", "/itop/daily?date=2026-09-22", token);
    expect(res.status).toBe(200);
    const row = res.body.customers.find((c: { customerId: number }) => c.customerId === customer.id);
    expect(row.counts.slaBreached).toBe(1);
    expect(row.counts.ongoing).toBe(2);
    const recentIds = row.recent.map((t: { id: number }) => t.id);
    expect(recentIds).toContain(breachedOngoing.id);
  });

  it("counts a different customer's tickets separately (no leakage)", async () => {
    await configureItop();
    const { token } = await createUserWithRole("TAM");
    const customerA = await createCustomer({ itopOrgId: 524, itopOrgName: "A Org" });
    const customerB = await createCustomer({ itopOrgId: 525, itopOrgName: "B Org" });

    await createTicket({ customerId: customerA.id, orgId: 524, status: "new" });
    await createTicket({ customerId: customerB.id, orgId: 525, status: "new" });
    await createTicket({ customerId: customerB.id, orgId: 525, status: "new" });

    const res = await call("get", "/itop/daily?date=2026-09-22", token);
    expect(res.status).toBe(200);
    const rowA = res.body.customers.find((c: { customerId: number }) => c.customerId === customerA.id);
    const rowB = res.body.customers.find((c: { customerId: number }) => c.customerId === customerB.id);
    expect(rowA.counts.ongoing).toBe(1);
    expect(rowB.counts.ongoing).toBe(2);
  });
});

describe("GET /itop/daily — recent tickets", () => {
  it("caps recent at 3, ordered lastUpdate desc", async () => {
    await configureItop();
    const { token } = await createUserWithRole("TAM");
    const customer = await createCustomer({ itopOrgId: 530, itopOrgName: "Recent Org" });

    const t1 = await createTicket({ customerId: customer.id, orgId: 530, lastUpdate: new Date("2026-01-01T00:00:00Z") });
    const t2 = await createTicket({ customerId: customer.id, orgId: 530, lastUpdate: new Date("2026-02-01T00:00:00Z") });
    const t3 = await createTicket({ customerId: customer.id, orgId: 530, lastUpdate: new Date("2026-03-01T00:00:00Z") });
    const t4 = await createTicket({ customerId: customer.id, orgId: 530, lastUpdate: new Date("2026-04-01T00:00:00Z") });

    const res = await call("get", "/itop/daily?date=2026-09-22", token);
    expect(res.status).toBe(200);
    const row = res.body.customers.find((c: { customerId: number }) => c.customerId === customer.id);
    expect(row.recent).toHaveLength(3);
    const ids = row.recent.map((t: { id: number }) => t.id);
    expect(ids).toEqual([t4.id, t3.id, t2.id]);
    expect(ids).not.toContain(t1.id);
  });

  it("sets isMine on a recent ticket assigned to the caller's itopPersonId", async () => {
    await configureItop();
    const tam = await createUserWithRole("TAM");
    await prisma.user.update({ where: { id: tam.userId }, data: { itopPersonId: 77 } });
    const customer = await createCustomer({ itopOrgId: 531, itopOrgName: "Mine Org" });

    const mine = await createTicket({ customerId: customer.id, orgId: 531, agentPersonId: 77 });
    const notMine = await createTicket({ customerId: customer.id, orgId: 531, agentPersonId: 78 });

    const res = await call("get", "/itop/daily?date=2026-09-22", tam.token);
    expect(res.status).toBe(200);
    const row = res.body.customers.find((c: { customerId: number }) => c.customerId === customer.id);
    const mineRow = row.recent.find((t: { id: number }) => t.id === mine.id);
    const notMineRow = row.recent.find((t: { id: number }) => t.id === notMine.id);
    expect(mineRow.isMine).toBe(true);
    expect(notMineRow.isMine).toBe(false);
  });

  it("does not starve a quiet customer of recent rows when another visible customer has hundreds of more-recently-updated tickets", async () => {
    await configureItop();
    const { token } = await createUserWithRole("TAM");
    const noisy = await createCustomer({ itopOrgId: 550, itopOrgName: "Noisy Org" });
    const quiet = await createCustomer({ itopOrgId: 551, itopOrgName: "Quiet Org" });

    // Quiet customer's only 3 tickets, all updated well before the noisy
    // customer's flood below.
    const q1 = await createTicket({ customerId: quiet.id, orgId: 551, lastUpdate: new Date("2026-01-01T00:00:00Z") });
    const q2 = await createTicket({ customerId: quiet.id, orgId: 551, lastUpdate: new Date("2026-01-02T00:00:00Z") });
    const q3 = await createTicket({ customerId: quiet.id, orgId: 551, lastUpdate: new Date("2026-01-03T00:00:00Z") });

    // 250 tickets for the noisy customer, every one updated AFTER all three
    // of the quiet customer's tickets. A global "ORDER BY lastUpdate DESC
    // LIMIT 200"-style cap across every in-scope customer would push all of
    // the quiet customer's rows past the cutoff, leaving it with zero
    // `recent` rows despite having 3 ongoing tickets — the per-customer
    // window-function query must not do that.
    const base = new Date("2026-06-01T00:00:00Z").getTime();
    await prisma.itopTicket.createMany({
      data: Array.from({ length: 250 }, (_, i) => ({
        id: 920_000_000 + i,
        class: "UserRequest",
        ref: `D-flood-${i}`,
        title: "Flood ticket",
        status: "new",
        orgId: 550,
        customerId: noisy.id,
        lastUpdate: new Date(base + i * 1000),
        syncedAt: new Date(),
      })),
    });

    const res = await call("get", "/itop/daily?date=2026-09-22", token);
    expect(res.status).toBe(200);
    const noisyRow = res.body.customers.find((c: { customerId: number }) => c.customerId === noisy.id);
    const quietRow = res.body.customers.find((c: { customerId: number }) => c.customerId === quiet.id);
    expect(noisyRow.recent).toHaveLength(3);
    expect(quietRow.recent).toHaveLength(3);
    const quietIds = quietRow.recent.map((t: { id: number }) => t.id);
    expect(quietIds).toEqual([q3.id, q2.id, q1.id]);
  });
});

describe("GET /itop/daily — syncedAt", () => {
  it("reports the max syncedAt across a customer's own tickets", async () => {
    await configureItop();
    const { token } = await createUserWithRole("TAM");
    const customer = await createCustomer({ itopOrgId: 540, itopOrgName: "Sync Org" });

    await createTicket({ customerId: customer.id, orgId: 540, syncedAt: new Date("2026-09-20T00:00:00Z") });
    await createTicket({ customerId: customer.id, orgId: 540, syncedAt: new Date("2026-09-21T12:00:00Z") });

    const res = await call("get", "/itop/daily?date=2026-09-22", token);
    expect(res.status).toBe(200);
    const row = res.body.customers.find((c: { customerId: number }) => c.customerId === customer.id);
    expect(row.syncedAt).toBe(new Date("2026-09-21T12:00:00Z").toISOString());
  });

  it("falls back to config.lastSyncAt for a mapped customer with no tickets yet", async () => {
    await configureItop();
    const lastSyncAt = new Date("2026-09-19T08:00:00Z");
    await prisma.itopConfig.update({ where: { id: "default" }, data: { lastSyncAt } });
    bustItopConfigCache();

    const { token } = await createUserWithRole("TAM");
    const customer = await createCustomer({ itopOrgId: 541, itopOrgName: "No Tickets Org" });

    const res = await call("get", "/itop/daily?date=2026-09-22", token);
    expect(res.status).toBe(200);
    const row = res.body.customers.find((c: { customerId: number }) => c.customerId === customer.id);
    expect(row.syncedAt).toBe(lastSyncAt.toISOString());
  });
});
