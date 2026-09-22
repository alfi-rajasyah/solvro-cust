// Admin API for the iTop integration (src/routes/itopAdmin.ts, mounted at
// /admin/itop). Exercises access control, settings PATCH/GET (token sealed
// at rest, never echoed), the "Test connection" probe passthrough against
// the in-memory fake iTop, org↔customer mapping, and the user↔iTop-person
// match report. See docs/archive/plans/itop-integration.md Task 1.5.
import "./env.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { open, seal } from "../src/lib/secretBox.js";
import { bustItopConfigCache } from "../src/lib/itop/config.js";
import { createAdminAndToken, createUserWithRole, seedRoles } from "./testAuth.js";
import { createFakeItop, seedFakeItop, type FakeItopState } from "./itop/fakeItop.js";

const app = createApp();

const ALL_ROUTES: Array<{ method: "get" | "patch" | "post"; path: string }> = [
  { method: "get", path: "/admin/itop/settings" },
  { method: "patch", path: "/admin/itop/settings" },
  { method: "post", path: "/admin/itop/test" },
  { method: "post", path: "/admin/itop/sync" },
  { method: "get", path: "/admin/itop/organizations" },
  { method: "get", path: "/admin/itop/customers" },
  { method: "patch", path: "/admin/itop/customers/1" },
  { method: "post", path: "/admin/itop/customers/automatch" },
  { method: "get", path: "/admin/itop/persons" },
  { method: "post", path: "/admin/itop/persons/match" },
];

function call(method: "get" | "patch" | "post", path: string, token?: string) {
  const req = request(app)[method](path);
  return token ? req.set("Authorization", `Bearer ${token}`) : req;
}

function uniq(label: string): string {
  return `${label} ${Date.now()}-${Math.random()}`;
}

async function createCustomer(
  overrides: { name?: string; itopOrgId?: number | null; itopOrgName?: string | null } = {},
) {
  return prisma.customer.create({
    data: {
      name: overrides.name ?? uniq("Customer"),
      description: "d",
      itopOrgId: overrides.itopOrgId ?? null,
      itopOrgName: overrides.itopOrgName ?? null,
    },
  });
}

async function startFake(state: FakeItopState) {
  const { listen } = createFakeItop(state);
  const { server, baseUrl } = await listen(0);
  return { server, baseUrl };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POST /admin/itop/sync is fire-and-forget (it must return before nginx's
 * 60s proxy timeout even on a large first sync — see itopAdmin.ts#syncInFlight),
 * so tests that need to observe the result poll the DB instead of awaiting
 * the HTTP response. Polls up to `timeoutMs` for at least one ItopTicket row
 * to exist for `customerId`.
 */
async function waitForSyncedTickets(customerId: number, timeoutMs = 5000) {
  const start = Date.now();
  for (;;) {
    const tickets = await prisma.itopTicket.findMany({ where: { customerId } });
    if (tickets.length > 0) return tickets;
    if (Date.now() - start > timeoutMs) return tickets;
    await sleep(100);
  }
}

let adminToken: string;

beforeAll(async () => {
  await seedRoles();
});

// The fake iTop seed's Person/User emails, shared by this file's own
// person-match test and test/itop/sync.test.ts's equivalents — the only
// User rows either file needs to reclaim between tests.
const ITOP_FIXTURE_EMAILS = [
  "rina.s@example.co.id",
  "dedi.p@example.co.id",
  "budi.h@example.co.id",
  "orphan.contact@example.co.id",
  "no-such-person@example.co.id",
];

// This file doesn't get a fresh DB per test — globalSetup truncates once for
// the *whole* vitest run, and under the full suite (npm test) many other
// files' suites run concurrently against this same database. Reset ONLY
// what these iTop tests own — never a blanket `user.deleteMany()`/
// `customer.deleteMany()`, which previously threw a foreign-key violation
// the instant another suite had created a Project (Project.tamId → User has
// no ON DELETE SET NULL) and, even without that, would race-delete rows
// concurrently-running unrelated suites depend on. `itopTicket` and the
// `itop_config` singleton are exclusively this integration's tables, so a
// full wipe of those is safe; Customer is scoped to rows this integration
// itself marks (itopOrgId — no other suite ever sets it); User is scoped to
// the fixed fixture emails above (no other suite ever uses them — every
// other user in the DB carries an auto-generated, timestamp-unique email,
// including the admin/TAM users this file itself creates via
// createAdminAndToken()/createUserWithRole()). Registered before the
// admin-creation beforeEach below so it always runs first, and before every
// test (not just after) so this file's very first test starts clean
// regardless of what ran before it.
async function resetItopTestState(): Promise<void> {
  await prisma.itopTicket.deleteMany();
  await prisma.customer.deleteMany({ where: { itopOrgId: { not: null } } });
  await prisma.user.deleteMany({ where: { email: { in: ITOP_FIXTURE_EMAILS } } });
  await prisma.itopConfig.deleteMany({ where: { id: "default" } });
  bustItopConfigCache();
}

beforeEach(async () => {
  await resetItopTestState();
});

beforeEach(async () => {
  const admin = await createAdminAndToken();
  adminToken = admin.token;
});

// Writes ItopConfig directly rather than through PATCH /settings: the admin
// route's baseUrl validation requires https:// (a real-install guardrail),
// but the fake iTop test double only serves http — same bypass the sibling
// sync suite uses (test/itop/sync.test.ts#configureItop).
async function configureItop(baseUrl: string, appToken = "app-token-readonly"): Promise<void> {
  await prisma.itopConfig.upsert({
    where: { id: "default" },
    create: { id: "default", baseUrl, appTokenEnc: seal(appToken) },
    update: {
      baseUrl,
      appTokenEnc: seal(appToken),
      lastSyncAt: null,
      lastSyncOk: null,
      lastSyncError: null,
      lastFullSyncAt: null,
    },
  });
  bustItopConfigCache();
}

async function clearItopConfig(): Promise<void> {
  await prisma.itopConfig.upsert({
    where: { id: "default" },
    create: { id: "default", baseUrl: null, appTokenEnc: null },
    update: { baseUrl: null, appTokenEnc: null },
  });
  bustItopConfigCache();
}

describe("access control", () => {
  it("401s every route without a token", async () => {
    for (const { method, path } of ALL_ROUTES) {
      const res = await call(method, path);
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(401);
    }
  });

  it("403s every route for a non-admin", async () => {
    const { token } = await createUserWithRole("TAM");
    for (const { method, path } of ALL_ROUTES) {
      const res = await call(method, path, token);
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(403);
    }
  });
});

describe("GET/PATCH /admin/itop/settings", () => {
  it("PATCH stores the token sealed; GET never echoes plaintext or ciphertext", async () => {
    const patchRes = await call("patch", "/admin/itop/settings", adminToken).send({
      baseUrl: "https://itop.example.com/",
      appToken: "super-secret-token",
      refreshMinutes: 10,
      readClasses: ["UserRequest"],
      capacityHoursPerWeek: 35,
      actionsEnabled: true,
    });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.baseUrl).toBe("https://itop.example.com"); // trailing slash stripped
    expect(patchRes.body.appTokenSet).toBe(true);
    expect(patchRes.body.refreshMinutes).toBe(10);
    expect(patchRes.body.readClasses).toEqual(["UserRequest"]);
    expect(patchRes.body.capacityHoursPerWeek).toBe(35);
    expect(patchRes.body.actionsEnabled).toBe(true);
    expect(patchRes.body).not.toHaveProperty("appToken");
    expect(JSON.stringify(patchRes.body)).not.toContain("super-secret-token");

    const row = await prisma.itopConfig.findUniqueOrThrow({ where: { id: "default" } });
    expect(row.appTokenEnc).not.toBeNull();
    expect(row.appTokenEnc).not.toBe("super-secret-token");
    expect(row.appTokenEnc).not.toContain("super-secret-token");
    expect(open(row.appTokenEnc as string)).toBe("super-secret-token");

    const getRes = await call("get", "/admin/itop/settings", adminToken);
    expect(getRes.status).toBe(200);
    expect(getRes.body.appTokenSet).toBe(true);
    expect(getRes.body).not.toHaveProperty("appToken");
    expect(getRes.body).not.toHaveProperty("appTokenEnc");
    expect(JSON.stringify(getRes.body)).not.toContain("super-secret-token");
    expect(JSON.stringify(getRes.body)).not.toContain(row.appTokenEnc as string);
    expect(getRes.body.updatedBy).toMatchObject({ username: expect.any(String) });
  });

  it("400s on an empty-string appToken", async () => {
    const res = await call("patch", "/admin/itop/settings", adminToken).send({ appToken: "" });
    expect(res.status).toBe(400);
  });

  it("400s on refreshMinutes: 0", async () => {
    const res = await call("patch", "/admin/itop/settings", adminToken).send({ refreshMinutes: 0 });
    expect(res.status).toBe(400);
  });
});

describe("POST /admin/itop/test", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await closeServer(server);
      server = undefined;
    }
  });

  it("409s itop_not_configured with no stored config and no body", async () => {
    await clearItopConfig();
    const res = await call("post", "/admin/itop/test", adminToken).send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("itop_not_configured");
  });

  it("400s a body-supplied http:// baseUrl (only https:// is accepted, same as PATCH /settings)", async () => {
    const started = await startFake(seedFakeItop());
    server = started.server;
    const res = await call("post", "/admin/itop/test", adminToken).send({
      baseUrl: started.baseUrl, // http://127.0.0.1:<port> — the fake iTop only serves http
      appToken: "app-token-readonly",
    });
    expect(res.status).toBe(400);
  });

  it("bad token: ok:false, list_operations message contains iTop's Invalid login", async () => {
    const started = await startFake(seedFakeItop());
    server = started.server;
    // baseUrl comes from the stored config (written directly via prisma,
    // bypassing the https-only body validation exercised above); only the
    // token is body-supplied here.
    await configureItop(started.baseUrl);
    const res = await call("post", "/admin/itop/test", adminToken).send({ appToken: "not-a-real-token" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    const listOps = res.body.probes.find((p: { name: string }) => p.name === "list_operations");
    expect(listOps.ok).toBe(false);
    expect(listOps.message).toContain("Invalid login");
  });

  it("seeded read token: 6 probes ok", async () => {
    const started = await startFake(seedFakeItop());
    server = started.server;
    await configureItop(started.baseUrl);
    const res = await call("post", "/admin/itop/test", adminToken).send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.probes).toHaveLength(6);
    expect(res.body.probes.every((p: { ok: boolean }) => p.ok)).toBe(true);
  });

  it("disabledClasses TimeSpent: only that probe fails", async () => {
    const state = seedFakeItop();
    state.disabledClasses.add("TimeSpent");
    const started = await startFake(state);
    server = started.server;
    await configureItop(started.baseUrl);
    const res = await call("post", "/admin/itop/test", adminToken).send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    const timeSpent = res.body.probes.find((p: { name: string }) => p.name === "TimeSpent");
    expect(timeSpent.ok).toBe(false);
    expect(res.body.probes.filter((p: { name: string }) => p.name !== "TimeSpent").every((p: { ok: boolean }) => p.ok)).toBe(
      true,
    );
  });
});

describe("organizations + customer↔org mapping", () => {
  let server: Server | undefined;
  let baseUrl: string;

  beforeEach(async () => {
    const started = await startFake(seedFakeItop());
    server = started.server;
    baseUrl = started.baseUrl;
    await configureItop(baseUrl);
  });

  afterEach(async () => {
    if (server) {
      await closeServer(server);
      server = undefined;
    }
    // Only two orgs exist in the fake seed; clear mappings between tests so
    // the unique Customer.itopOrgId index never collides across cases.
    // Scoped (not a blanket deleteMany({})) — an unscoped wipe here would
    // also delete customers created by unrelated suites running concurrently
    // under the full `npm test` run; the top-level resetItopTestState()
    // beforeEach already does this same scoped reset before every test, this
    // is just belt-and-braces within the describe block.
    await prisma.customer.deleteMany({ where: { itopOrgId: { not: null } } });
  });

  it("GET /organizations lists live orgs with mappedCustomerId", async () => {
    const customer = await createCustomer({
      name: "Northwind Freight Sdn Bhd",
      itopOrgId: 1,
      itopOrgName: "Northwind Freight Sdn Bhd",
    });
    const res = await call("get", "/admin/itop/organizations", adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 1, name: "Northwind Freight Sdn Bhd", mappedCustomerId: customer.id },
      { id: 2, name: "PT Sinar Logistik", mappedCustomerId: null },
    ]);
  });

  it("corrupted stored token (e.g. after a SECRETS_KEY rotation): 409 itop_token_unreadable, not a 500", async () => {
    // Well-formed sealed-value shape ("v1:<iv>:<tag>:<ciphertext>") but not
    // something the current SECRETS_KEY can decrypt — open() throws
    // SecretBoxError, which the route boundary must map to a 409, not a 500.
    await prisma.itopConfig.update({
      where: { id: "default" },
      data: { appTokenEnc: "v1:anVuaw==:anVuaw==:anVuaw==" },
    });
    bustItopConfigCache();

    const orgsRes = await call("get", "/admin/itop/organizations", adminToken);
    expect(orgsRes.status).toBe(409);
    expect(orgsRes.body.code).toBe("itop_token_unreadable");

    const testRes = await call("post", "/admin/itop/test", adminToken).send({});
    expect(testRes.status).toBe(409);
    expect(testRes.body.code).toBe("itop_token_unreadable");
  });

  it("PATCH /customers/:id maps to a valid org (happy path)", async () => {
    const customer = await createCustomer({ name: "Some Other Name" });
    const res = await call("patch", `/admin/itop/customers/${customer.id}`, adminToken).send({ itopOrgId: 2 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: customer.id,
      name: customer.name,
      itopOrgId: 2,
      itopOrgName: "PT Sinar Logistik",
      match: "manual",
    });
  });

  it("PATCH with an unknown org id: 400 itop_org_not_found", async () => {
    const customer = await createCustomer();
    const res = await call("patch", `/admin/itop/customers/${customer.id}`, adminToken).send({ itopOrgId: 999 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("itop_org_not_found");
  });

  it("PATCH to an org already mapped to another customer: 409 naming the holder", async () => {
    const holder = await createCustomer({ itopOrgId: 1, itopOrgName: "Northwind Freight Sdn Bhd" });
    const other = await createCustomer();
    const res = await call("patch", `/admin/itop/customers/${other.id}`, adminToken).send({ itopOrgId: 1 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("itop_org_already_mapped");
    expect(res.body.details).toEqual({ customerId: holder.id, customerName: holder.name });
  });

  it("PATCH with itopOrgId: null clears the mapping", async () => {
    const customer = await createCustomer({ itopOrgId: 1, itopOrgName: "Northwind Freight Sdn Bhd" });
    const res = await call("patch", `/admin/itop/customers/${customer.id}`, adminToken).send({ itopOrgId: null });
    expect(res.status).toBe(200);
    expect(res.body.itopOrgId).toBeNull();
    expect(res.body.itopOrgName).toBeNull();
    expect(res.body.match).toBe("unmatched");
  });

  it("POST /customers/automatch maps only exact (case-insensitive, trimmed) names", async () => {
    const exact = await createCustomer({ name: "  pt sinar logistik  " });
    const notExact = await createCustomer({ name: "Sinar Logistik Co" });
    const res = await call("post", "/admin/itop/customers/automatch", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.matched).toBe(1);

    const exactRow = res.body.customers.find((c: { id: number }) => c.id === exact.id);
    const notExactRow = res.body.customers.find((c: { id: number }) => c.id === notExact.id);
    expect(exactRow.itopOrgId).toBe(2);
    expect(exactRow.itopOrgName).toBe("PT Sinar Logistik");
    expect(exactRow.match).toBe("name");
    expect(notExactRow.itopOrgId).toBeNull();
    expect(notExactRow.match).toBe("unmatched");
  });

  it("POST /customers/automatch never double-maps an org already claimed", async () => {
    // Customer.name is unique, so use two distinct strings that both
    // normalize (trim + lowercase) to the same org name — automatch must
    // still map at most one of them.
    const first = await createCustomer({ name: "PT Sinar Logistik" });
    const second = await createCustomer({ name: "  pt sinar logistik  " });
    const res = await call("post", "/admin/itop/customers/automatch", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.matched).toBe(1);
    const rows = res.body.customers.filter((c: { id: number }) => c.id === first.id || c.id === second.id);
    const mappedCount = rows.filter((c: { itopOrgId: number | null }) => c.itopOrgId === 2).length;
    expect(mappedCount).toBe(1);
  });
});

describe("persons match report + sync trigger", () => {
  let server: Server | undefined;
  let baseUrl: string;

  beforeEach(async () => {
    const started = await startFake(seedFakeItop());
    server = started.server;
    baseUrl = started.baseUrl;
    await configureItop(baseUrl);
  });

  afterEach(async () => {
    if (server) {
      await closeServer(server);
      server = undefined;
    }
    // Scoped for the same reason as the describe block above — never a
    // blanket wipe of every customer in the shared test database.
    await prisma.customer.deleteMany({ where: { itopOrgId: { not: null } } });
  });

  it("GET /persons before/after POST /persons/match resolves an email match via syncUsers", async () => {
    const tam = await createUserWithRole("TAM");
    // The fake iTop seed's Person #1 has this email (fakeItop.ts#seedFakeItop).
    await prisma.user.update({ where: { id: tam.userId }, data: { email: "rina.s@example.co.id" } });

    const before = await call("get", "/admin/itop/persons", adminToken);
    expect(before.status).toBe(200);
    const beforeRow = before.body.users.find((u: { id: number }) => u.id === tam.userId);
    expect(beforeRow.matched).toBe(false);
    expect(beforeRow.itopPersonId).toBeNull();

    const matchRes = await call("post", "/admin/itop/persons/match", adminToken);
    expect(matchRes.status).toBe(200);
    const matchedRow = matchRes.body.users.find((u: { id: number }) => u.id === tam.userId);
    expect(matchedRow.matched).toBe(true);
    expect(matchedRow.itopPersonId).toBe(1);

    const after = await call("get", "/admin/itop/persons", adminToken);
    const afterRow = after.body.users.find((u: { id: number }) => u.id === tam.userId);
    expect(afterRow.matched).toBe(true);
    expect(afterRow.itopPersonId).toBe(1);
  });

  it("POST /sync 202s { started:true, lastSyncAt } immediately and lands tickets in the background", async () => {
    const customer = await createCustomer({ itopOrgId: 1, itopOrgName: "Northwind Freight Sdn Bhd" });
    const res = await call("post", "/admin/itop/sync", adminToken).send({ full: true });
    // Fire-and-forget: the route answers before the pull finishes, so it
    // must not carry sync results (upserted/orgs/etc.) — those only exist
    // once the background run completes.
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ started: true, lastSyncAt: null });

    const tickets = await waitForSyncedTickets(customer.id);
    expect(tickets.length).toBeGreaterThan(0);
  });

  it("POST /sync answers 202 { started:false, reason:'busy' } for a second call while one is in flight", async () => {
    await createCustomer({ itopOrgId: 1, itopOrgName: "Northwind Freight Sdn Bhd" });
    const first = await call("post", "/admin/itop/sync", adminToken).send({ full: true });
    expect(first.status).toBe(202);
    expect(first.body.started).toBe(true);

    // Fired immediately after, before the background run below can finish —
    // the module-level in-flight guard (not the DB) is what this exercises.
    const second = await call("post", "/admin/itop/sync", adminToken).send({ full: true });
    expect(second.status).toBe(202);
    expect(second.body).toEqual({ started: false, reason: "busy" });
  });

  it("POST /sync 409s itop_not_configured when iTop isn't connected", async () => {
    await clearItopConfig();
    const res = await call("post", "/admin/itop/sync", adminToken).send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("itop_not_configured");
  });
});
