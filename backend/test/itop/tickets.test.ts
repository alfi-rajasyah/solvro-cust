// Read-side Tickets API (src/routes/itop.ts, mounted at /itop). Exercises
// customer visibility (reusing lib/visibility.ts's ensureCustomerVisible —
// 404, not 403, for a hidden customer), the unmapped-customer soft answer,
// scope/class filtering and their counts, the resolved_week ISO-Monday
// boundary, single-ticket lookup visibility, and the /refresh cooldown +
// not-configured guard. Tickets are seeded directly via prisma — no fake
// iTop server needed (that's sync.test.ts's job). See
// docs/plans/itop-integration.md Task 1.7.
import "../env.js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/prisma.js";
import { seal } from "../../src/lib/secretBox.js";
import { bustItopConfigCache } from "../../src/lib/itop/config.js";
import { weekKeyOf, parseWeekKey } from "../../src/lib/isoWeek.js";
import { utcMidnightOfDayString } from "../../src/lib/dateBoundary.js";
import { seedRoles, createUserWithRole } from "../testAuth.js";

const app = createApp();

// Every Customer this file creates gets a name under this prefix — including
// the "unmapped" fixtures (itopOrgId left null), which resetItopTestState
// below can't otherwise distinguish from a Customer some unrelated suite
// created. No other suite uses this prefix.
const ITOP_TEST_CUSTOMER_PREFIX = "iTop ticket test customer";

function uniq(label: string): string {
  return `${label} ${Date.now()}-${Math.random()}`;
}

function call(method: "get" | "post", path: string, token?: string) {
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
  return 900_000_000 + ticketIdCounter;
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
      ref: overrides.ref ?? `R-${id}`,
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
      startDate: null,
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

/** Same computation as src/routes/itop.ts#currentIsoWeekStart, kept
 * independent here so the test asserts against the contract, not the
 * implementation. */
function currentIsoWeekStartUTC(): Date {
  const todayDay = new Date().toISOString().slice(0, 10);
  const week = parseWeekKey(weekKeyOf(todayDay));
  if (!week) throw new Error("unreachable");
  return utcMidnightOfDayString(week.start);
}

async function configureItop(): Promise<void> {
  await prisma.itopConfig.upsert({
    where: { id: "default" },
    create: { id: "default", baseUrl: "https://itop.example.com", appTokenEnc: seal("app-token") },
    update: { baseUrl: "https://itop.example.com", appTokenEnc: seal("app-token") },
  });
  bustItopConfigCache();
}

// This suite doesn't get a fresh DB per test — globalSetup truncates once
// for the *whole* vitest run, and under the full suite (npm test) many
// other files' suites run concurrently against this same database. Reset
// ONLY what these iTop tests own — never a blanket `user.deleteMany()`/
// `customer.deleteMany()`, which throws a foreign-key violation the instant
// another suite has created a Project (Project.tamId → User has no ON
// DELETE) and, even without that, would race-delete rows concurrently
// running unrelated suites depend on. `itopTicket` and the `itop_config`
// singleton are exclusively this integration's tables, so a full wipe of
// those is safe; Customer is scoped to rows this file itself marks
// (itopOrgId, or the name prefix for the unmapped fixtures — no other suite
// ever uses either); User rows are never targeted here at all — every user
// this file creates goes through createUserWithRole()'s auto-generated,
// timestamp-unique email and is never reassigned to a fixed one, so there is
// nothing of this file's to reclaim (unlike test/itop/sync.test.ts and
// test/itopAdmin.test.ts, which reuse the fake iTop seed's fixed emails).
// Run BEFORE every test (not just after) so this file's very first test
// starts clean regardless of what ran before it.
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
  it("401s every route without a token", async () => {
    const routes: Array<{ method: "get" | "post"; path: string }> = [
      { method: "get", path: "/itop/status" },
      { method: "get", path: "/itop/customers/1/tickets" },
      { method: "get", path: "/itop/tickets/1" },
      { method: "post", path: "/itop/refresh" },
    ];
    for (const { method, path } of routes) {
      const res = await call(method, path);
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(401);
    }
  });
});

describe("GET /itop/status", () => {
  it("reports unconfigured with no stored config", async () => {
    const { token } = await createUserWithRole("TAM");
    const res = await call("get", "/itop/status", token);
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.baseUrl).toBeNull();
    expect(res.body).not.toHaveProperty("lastSyncError");
  });

  it("reports configured + baseUrl once connected, never the token or the raw sync error", async () => {
    await configureItop();
    // lastSyncError can hold iTop's raw error text (may name internal
    // hosts/paths) — this route has no admin gate, so it must never appear
    // here even though the admin settings endpoint does expose it.
    await prisma.itopConfig.update({
      where: { id: "default" },
      data: { lastSyncOk: false, lastSyncError: "connect ECONNREFUSED internal-itop.corp.local:443" },
    });
    bustItopConfigCache();

    const { token } = await createUserWithRole("TAM");
    const res = await call("get", "/itop/status", token);
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.baseUrl).toBe("https://itop.example.com");
    expect(res.body.lastSyncOk).toBe(false);
    expect(res.body).not.toHaveProperty("lastSyncError");
    expect(JSON.stringify(res.body)).not.toContain("app-token");
    expect(JSON.stringify(res.body)).not.toContain("internal-itop.corp.local");
  });
});

describe("GET /itop/customers/:id/tickets — visibility", () => {
  it("404s customer_not_found for a customer the caller cannot see", async () => {
    const owner = await createUserWithRole("TAM");
    const caller = await createUserWithRole("TAM");
    const hidden = await createCustomer({ tamId: owner.userId, itopOrgId: 5, itopOrgName: "Hidden Org" });

    const res = await call("get", `/itop/customers/${hidden.id}/tickets`, caller.token);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("customer_not_found");
  });

  it("200s for an unowned customer (tamId null) even for an unrelated TAM", async () => {
    const caller = await createUserWithRole("TAM");
    const customer = await createCustomer({ itopOrgId: 5, itopOrgName: "Open Org" });

    const res = await call("get", `/itop/customers/${customer.id}/tickets`, caller.token);
    expect(res.status).toBe(200);
    expect(res.body.mapped).toBe(true);
  });

  it("404s for a non-existent customer id", async () => {
    const { token } = await createUserWithRole("TAM");
    const res = await call("get", "/itop/customers/999999/tickets", token);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("customer_not_found");
  });
});

describe("GET /itop/customers/:id/tickets — unmapped customer", () => {
  it("returns mapped:false with zeroed counts and no tickets", async () => {
    const { token } = await createUserWithRole("TAM");
    const customer = await createCustomer(); // itopOrgId left null

    const res = await call("get", `/itop/customers/${customer.id}/tickets`, token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      mapped: false,
      tickets: [],
      counts: { ongoing: 0, resolvedWeek: 0, mine: 0, incidents: 0, requests: 0 },
      syncedAt: null,
    });
  });
});

describe("GET /itop/customers/:id/tickets — scopes, counts, class filter", () => {
  it("computes ongoing/mine/incidents/requests/resolvedWeek from the same row set the filters would return", async () => {
    const tam = await createUserWithRole("TAM");
    await prisma.user.update({ where: { id: tam.userId }, data: { itopPersonId: 5 } });
    const customer = await createCustomer({ itopOrgId: 10, itopOrgName: "Acme Freight" });

    const mine = await createTicket({
      class: "UserRequest",
      status: "new",
      agentPersonId: 5,
      customerId: customer.id,
      orgId: 10,
    });
    const otherOngoingIncident = await createTicket({
      class: "Incident",
      status: "assigned",
      agentPersonId: 7,
      customerId: customer.id,
      orgId: 10,
    });
    const unassignedOngoingRequest = await createTicket({
      class: "UserRequest",
      status: "new",
      agentPersonId: null,
      customerId: customer.id,
      orgId: 10,
    });
    const resolvedThisWeek = await createTicket({
      class: "UserRequest",
      status: "resolved",
      customerId: customer.id,
      orgId: 10,
      resolutionDate: new Date(),
    });
    // Outside the current ISO week — must not count toward resolvedWeek.
    await createTicket({
      class: "Incident",
      status: "closed",
      customerId: customer.id,
      orgId: 10,
      resolutionDate: new Date(currentIsoWeekStartUTC().getTime() - 24 * 60 * 60 * 1000),
    });
    // Different customer entirely — must never leak into these counts.
    const otherCustomer = await createCustomer({ itopOrgId: 11, itopOrgName: "Other Org" });
    await createTicket({ class: "UserRequest", status: "new", customerId: otherCustomer.id, orgId: 11 });

    const res = await call("get", `/itop/customers/${customer.id}/tickets`, tam.token);
    expect(res.status).toBe(200);
    expect(res.body.mapped).toBe(true);
    expect(res.body.orgName).toBe("Acme Freight");
    expect(res.body.counts).toEqual({ ongoing: 3, resolvedWeek: 1, mine: 1, incidents: 1, requests: 2 });

    const ids = res.body.tickets.map((t: { id: number }) => t.id).sort((a: number, b: number) => a - b);
    expect(ids).toEqual([mine.id, otherOngoingIncident.id, unassignedOngoingRequest.id].sort((a, b) => a - b));
    expect(ids).not.toContain(resolvedThisWeek.id);

    const mineRow = res.body.tickets.find((t: { id: number }) => t.id === mine.id);
    expect(mineRow.isMine).toBe(true);
    const otherRow = res.body.tickets.find((t: { id: number }) => t.id === otherOngoingIncident.id);
    expect(otherRow.isMine).toBe(false);
  });

  it("scope=mine returns only ongoing tickets assigned to the caller's itopPersonId", async () => {
    const tam = await createUserWithRole("TAM");
    await prisma.user.update({ where: { id: tam.userId }, data: { itopPersonId: 42 } });
    const customer = await createCustomer({ itopOrgId: 20, itopOrgName: "Mine Co" });

    const mine = await createTicket({ agentPersonId: 42, customerId: customer.id, orgId: 20, status: "new" });
    await createTicket({ agentPersonId: 43, customerId: customer.id, orgId: 20, status: "new" });
    // Resolved and assigned to me — must not appear under "mine" (mine = ongoing AND agent match).
    await createTicket({ agentPersonId: 42, customerId: customer.id, orgId: 20, status: "resolved" });

    const res = await call("get", `/itop/customers/${customer.id}/tickets?scope=mine`, tam.token);
    expect(res.status).toBe(200);
    expect(res.body.tickets).toHaveLength(1);
    expect(res.body.tickets[0].id).toBe(mine.id);
  });

  it("scope=mine is empty when the caller has no itopPersonId", async () => {
    const tam = await createUserWithRole("TAM"); // no itopPersonId set
    const customer = await createCustomer({ itopOrgId: 21, itopOrgName: "No Match Co" });
    await createTicket({ agentPersonId: 42, customerId: customer.id, orgId: 21, status: "new" });

    const res = await call("get", `/itop/customers/${customer.id}/tickets?scope=mine`, tam.token);
    expect(res.status).toBe(200);
    expect(res.body.tickets).toEqual([]);
    expect(res.body.counts.mine).toBe(0);
  });

  it("class filter restricts the ticket list and the ongoing/mine/resolvedWeek scope counts, but not the incidents/requests chips", async () => {
    const { token } = await createUserWithRole("TAM");
    const customer = await createCustomer({ itopOrgId: 30, itopOrgName: "Filter Co" });
    const incident = await createTicket({ class: "Incident", status: "new", customerId: customer.id, orgId: 30 });
    await createTicket({ class: "UserRequest", status: "new", customerId: customer.id, orgId: 30 });

    const res = await call("get", `/itop/customers/${customer.id}/tickets?class=Incident`, token);
    expect(res.status).toBe(200);
    expect(res.body.tickets).toHaveLength(1);
    expect(res.body.tickets[0].id).toBe(incident.id);
    // `ongoing` is narrowed to Incident (matches the filtered ticket list),
    // but `incidents`/`requests` report the customer's whole ongoing set
    // regardless of the `class` filter — a `?class=Incident` request must
    // not zero out the "requests" chip.
    expect(res.body.counts).toMatchObject({ ongoing: 1, incidents: 1, requests: 1 });
  });

  it("resolved_week boundary: exactly at Monday 00:00 UTC counts, one ms before does not", async () => {
    const { token } = await createUserWithRole("TAM");
    const customer = await createCustomer({ itopOrgId: 40, itopOrgName: "Boundary Co" });
    const weekStart = currentIsoWeekStartUTC();

    const onBoundary = await createTicket({
      status: "resolved",
      customerId: customer.id,
      orgId: 40,
      resolutionDate: weekStart,
    });
    await createTicket({
      status: "resolved",
      customerId: customer.id,
      orgId: 40,
      resolutionDate: new Date(weekStart.getTime() - 1),
    });

    const res = await call("get", `/itop/customers/${customer.id}/tickets?scope=resolved_week`, token);
    expect(res.status).toBe(200);
    expect(res.body.tickets).toHaveLength(1);
    expect(res.body.tickets[0].id).toBe(onBoundary.id);
    expect(res.body.counts.resolvedWeek).toBe(1);
  });

  it("orders by slaTtrPassed desc, then lastUpdate desc", async () => {
    const { token } = await createUserWithRole("TAM");
    const customer = await createCustomer({ itopOrgId: 50, itopOrgName: "Order Co" });
    const older = await createTicket({
      customerId: customer.id,
      orgId: 50,
      status: "new",
      slaTtrPassed: false,
      lastUpdate: new Date("2026-01-01T00:00:00Z"),
    });
    const newer = await createTicket({
      customerId: customer.id,
      orgId: 50,
      status: "new",
      slaTtrPassed: false,
      lastUpdate: new Date("2026-02-01T00:00:00Z"),
    });
    const breached = await createTicket({
      customerId: customer.id,
      orgId: 50,
      status: "new",
      slaTtrPassed: true,
      lastUpdate: new Date("2025-01-01T00:00:00Z"),
    });

    const res = await call("get", `/itop/customers/${customer.id}/tickets`, token);
    expect(res.status).toBe(200);
    const ids = res.body.tickets.map((t: { id: number }) => t.id);
    expect(ids).toEqual([breached.id, newer.id, older.id]);
  });
});

describe("GET /itop/tickets/:id", () => {
  it("200s the ticket row with isMine for a visible customer", async () => {
    const tam = await createUserWithRole("TAM");
    await prisma.user.update({ where: { id: tam.userId }, data: { itopPersonId: 9 } });
    const customer = await createCustomer({ itopOrgId: 60, itopOrgName: "Panel Co" });
    const ticket = await createTicket({ agentPersonId: 9, customerId: customer.id, orgId: 60, status: "new" });

    const res = await call("get", `/itop/tickets/${ticket.id}`, tam.token);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(ticket.id);
    expect(res.body.ref).toBe(ticket.ref);
    expect(res.body.isMine).toBe(true);
  });

  it("404s for a ticket whose customer is hidden from the caller", async () => {
    const owner = await createUserWithRole("TAM");
    const caller = await createUserWithRole("TAM");
    const hidden = await createCustomer({ tamId: owner.userId, itopOrgId: 61, itopOrgName: "Hidden Panel Co" });
    const ticket = await createTicket({ customerId: hidden.id, orgId: 61, status: "new" });

    const res = await call("get", `/itop/tickets/${ticket.id}`, caller.token);
    expect(res.status).toBe(404);
  });

  it("404s for a ticket with no customer link (unmapped)", async () => {
    const { token } = await createUserWithRole("TAM");
    const ticket = await createTicket({ customerId: null, orgId: 70, status: "new" });

    const res = await call("get", `/itop/tickets/${ticket.id}`, token);
    expect(res.status).toBe(404);
  });

  it("404s for a non-existent ticket id", async () => {
    const { token } = await createUserWithRole("TAM");
    const res = await call("get", "/itop/tickets/999999999", token);
    expect(res.status).toBe(404);
  });
});

describe("POST /itop/refresh", () => {
  it("409s itop_not_configured when iTop isn't connected", async () => {
    const { token } = await createUserWithRole("TAM");
    const res = await call("post", "/itop/refresh", token).send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("itop_not_configured");
  });

  it("202s requested:true, then 202s requested:false on an immediate second call (cooldown)", async () => {
    await configureItop();
    const { token } = await createUserWithRole("TAM");

    const first = await call("post", "/itop/refresh", token).send({});
    expect(first.status).toBe(202);
    expect(first.body.requested).toBe(true);

    const second = await call("post", "/itop/refresh", token).send({});
    expect(second.status).toBe(202);
    expect(second.body).toEqual({ requested: false, reason: "cooldown" });
  });

  it("404s when the given customerId is hidden from the caller, before touching the cooldown", async () => {
    await configureItop();
    const owner = await createUserWithRole("TAM");
    const caller = await createUserWithRole("TAM");
    const hidden = await createCustomer({ tamId: owner.userId });

    const res = await call("post", "/itop/refresh", caller.token).send({ customerId: hidden.id });
    expect(res.status).toBe(404);
  });
});
