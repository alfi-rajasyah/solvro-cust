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
import { setMappingLockTimeoutMs, waitForItopSyncIdle } from "../src/routes/itopAdmin.js";
import { ADVISORY_LOCK_KEY } from "../src/lib/itop/sync.js";
import { createAdminAndToken, createUserWithRole, seedRoles } from "./testAuth.js";
import { createFakeItop, seedFakeItop, type FakeItopState, FAKE_ITOP_TOKENS } from "./itop/fakeItop.js";

const app = createApp();

const ALL_ROUTES: Array<{ method: "get" | "patch" | "post" | "delete"; path: string }> = [
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
  { method: "post", path: "/admin/itop/webhook-secret" },
  { method: "delete", path: "/admin/itop/webhook-secret" },
];

function call(method: "get" | "patch" | "post" | "delete", path: string, token?: string) {
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
async function configureItop(baseUrl: string, appToken = FAKE_ITOP_TOKENS.app): Promise<void> {
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

  it("defaults to UTC, and GET/PATCH round-trip a real IANA zone", async () => {
    const before = await call("get", "/admin/itop/settings", adminToken);
    expect(before.body.timezone).toBe("UTC");

    const res = await call("patch", "/admin/itop/settings", adminToken).send({ timezone: "Europe/Paris" });
    expect(res.status).toBe(200);
    expect(res.body.timezone).toBe("Europe/Paris");

    const after = await call("get", "/admin/itop/settings", adminToken);
    expect(after.body.timezone).toBe("Europe/Paris");
  });

  it("400s invalid_timezone for a made-up zone name, and leaves the stored value untouched", async () => {
    // beforeEach's resetItopTestState() deletes the singleton row before
    // every test — create it (at the UTC default) via a plain GET first, so
    // the PATCH below (which 400s before ever calling getItopConfig()
    // itself) has an existing row to leave untouched.
    await call("get", "/admin/itop/settings", adminToken);

    const res = await call("patch", "/admin/itop/settings", adminToken).send({ timezone: "Not/AZone" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_timezone");

    const row = await prisma.itopConfig.findUniqueOrThrow({ where: { id: "default" } });
    expect(row.timezone).toBe("UTC");
  });

  it("changing the timezone clears lastFullSyncAt so the next sync tick is a full one", async () => {
    await prisma.itopConfig.upsert({
      where: { id: "default" },
      create: { id: "default", timezone: "UTC", lastFullSyncAt: new Date(), lastSyncAt: new Date() },
      update: { timezone: "UTC", lastFullSyncAt: new Date(), lastSyncAt: new Date() },
    });
    bustItopConfigCache();

    const res = await call("patch", "/admin/itop/settings", adminToken).send({ timezone: "Asia/Jakarta" });
    expect(res.status).toBe(200);
    expect(res.body.timezone).toBe("Asia/Jakarta");
    expect(res.body.lastFullSyncAt).toBeNull();

    const row = await prisma.itopConfig.findUniqueOrThrow({ where: { id: "default" } });
    expect(row.lastFullSyncAt).toBeNull();
    // lastSyncAt (the incremental watermark) is untouched — only the
    // full-sync marker is cleared.
    expect(row.lastSyncAt).not.toBeNull();
  });

  it("re-sending the SAME timezone does not clear lastFullSyncAt", async () => {
    const fullSyncAt = new Date();
    await prisma.itopConfig.upsert({
      where: { id: "default" },
      create: { id: "default", timezone: "Europe/Paris", lastFullSyncAt: fullSyncAt },
      update: { timezone: "Europe/Paris", lastFullSyncAt: fullSyncAt },
    });
    bustItopConfigCache();

    const res = await call("patch", "/admin/itop/settings", adminToken).send({ timezone: "Europe/Paris" });
    expect(res.status).toBe(200);
    expect(res.body.lastFullSyncAt).not.toBeNull();

    const row = await prisma.itopConfig.findUniqueOrThrow({ where: { id: "default" } });
    expect(row.lastFullSyncAt?.getTime()).toBe(fullSyncAt.getTime());
  });

  it("backfills an ItopTimeEntry outside the 8-week sync window when the timezone changes (Europe/Paris summer, +2)", async () => {
    await prisma.itopConfig.upsert({
      where: { id: "default" },
      create: { id: "default", timezone: "UTC" },
      update: { timezone: "UTC" },
    });
    bustItopConfigCache();

    const user = await createUserWithRole("TAM");
    // Stored as if iTop's wall-clock digits were UTC (the OLD, wrong
    // assumption) — a decade-old-style stale row well outside
    // TIME_ENTRY_WINDOW_MS (8 weeks), which a forced full re-sync would
    // never re-fetch, let alone correct, on its own.
    await prisma.itopTimeEntry.create({
      data: {
        id: 960_000_001,
        itopUserId: 1,
        userId: user.userId,
        startDate: new Date("2026-07-01T14:00:00.000Z"),
        endDate: new Date("2026-07-01T14:30:00.000Z"),
        durationMinutes: 30,
        syncedAt: new Date(),
      },
    });

    const res = await call("patch", "/admin/itop/settings", adminToken).send({ timezone: "Europe/Paris" });
    expect(res.status).toBe(200);

    const row = await prisma.itopTimeEntry.findUniqueOrThrow({ where: { id: 960_000_001 } });
    // The wall-clock reading "2026-07-01 14:00:00" is now correctly
    // reinterpreted as Paris CEST (+2) instead of UTC — 2h earlier in real
    // time (both start and end shift by the same amount).
    expect(row.startDate.toISOString()).toBe("2026-07-01T12:00:00.000Z");
    expect(row.endDate?.toISOString()).toBe("2026-07-01T12:30:00.000Z");
  });

  it("backfills a non-null User.itopTokenExpiresAt when the timezone changes (Europe/Paris winter, +1)", async () => {
    await prisma.itopConfig.upsert({
      where: { id: "default" },
      create: { id: "default", timezone: "UTC" },
      update: { timezone: "UTC" },
    });
    bustItopConfigCache();

    const user = await createUserWithRole("TAM");
    await prisma.user.update({
      where: { id: user.userId },
      data: { itopTokenExpiresAt: new Date("2026-01-15T14:00:00.000Z") },
    });

    const res = await call("patch", "/admin/itop/settings", adminToken).send({ timezone: "Europe/Paris" });
    expect(res.status).toBe(200);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.userId } });
    // CET (+1) in January — 1h earlier in real time than the old UTC
    // reading, a different shift than the summer (+2) case above, proving
    // the backfill is DST-correct per row rather than a flat delta.
    expect(row.itopTokenExpiresAt?.toISOString()).toBe("2026-01-15T13:00:00.000Z");
  });
});

describe("POST/DELETE /admin/itop/webhook-secret", () => {
  it("generates a secret shown once; GET /settings only flips webhookSecretSet, never echoes it", async () => {
    const before = await call("get", "/admin/itop/settings", adminToken);
    expect(before.body.webhookSecretSet).toBe(false);

    const genRes = await call("post", "/admin/itop/webhook-secret", adminToken);
    expect(genRes.status).toBe(200);
    expect(typeof genRes.body.secret).toBe("string");
    expect(genRes.body.secret.length).toBeGreaterThan(20);
    expect(genRes.body.path).toBe("/api/webhook/itop");
    expect(genRes.body.header).toBe("X-Solvro-Webhook-Secret");

    const row = await prisma.itopConfig.findUniqueOrThrow({ where: { id: "default" } });
    expect(row.webhookSecretEnc).not.toBeNull();
    expect(row.webhookSecretEnc).not.toContain(genRes.body.secret);
    expect(open(row.webhookSecretEnc as string)).toBe(genRes.body.secret);

    const after = await call("get", "/admin/itop/settings", adminToken);
    expect(after.body.webhookSecretSet).toBe(true);
    expect(after.body).not.toHaveProperty("webhookSecretEnc");
    expect(JSON.stringify(after.body)).not.toContain(genRes.body.secret);
  });

  it("regenerating replaces the stored secret", async () => {
    const first = await call("post", "/admin/itop/webhook-secret", adminToken);
    const second = await call("post", "/admin/itop/webhook-secret", adminToken);
    expect(first.body.secret).not.toBe(second.body.secret);

    const row = await prisma.itopConfig.findUniqueOrThrow({ where: { id: "default" } });
    expect(open(row.webhookSecretEnc as string)).toBe(second.body.secret);
  });

  it("DELETE clears the secret; webhookSecretSet flips back to false", async () => {
    await call("post", "/admin/itop/webhook-secret", adminToken);
    const del = await call("delete", "/admin/itop/webhook-secret", adminToken);
    expect(del.status).toBe(204);

    const row = await prisma.itopConfig.findUniqueOrThrow({ where: { id: "default" } });
    expect(row.webhookSecretEnc).toBeNull();

    const after = await call("get", "/admin/itop/settings", adminToken);
    expect(after.body.webhookSecretSet).toBe(false);
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
      appToken: FAKE_ITOP_TOKENS.app,
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

  describe("ticket snapshot re-linking on (re)mapping", () => {
    let ticketSeq = 930_000_000;
    async function seedSnapshotTicket(orgId: number, customerId: number | null) {
      ticketSeq += 1;
      return prisma.itopTicket.create({
        data: {
          id: ticketSeq,
          class: "UserRequest",
          ref: `R-${ticketSeq}`,
          title: "Snapshot ticket",
          status: "new",
          orgId,
          customerId,
          lastUpdate: new Date(),
          syncedAt: new Date(),
        },
      });
    }
    async function listTicketIds(customerId: number): Promise<number[]> {
      const res = await call("get", `/itop/customers/${customerId}/tickets`, adminToken);
      expect(res.status).toBe(200);
      return res.body.tickets.map((t: { id: number }) => t.id);
    }

    it("remapping a customer to another org releases the old org's tickets and links the new org's", async () => {
      const customer = await createCustomer({ itopOrgId: 1, itopOrgName: "Northwind Freight Sdn Bhd" });
      const orgXTicket = await seedSnapshotTicket(1, customer.id);
      const orgYTicket = await seedSnapshotTicket(2, null);
      expect(await listTicketIds(customer.id)).toEqual([orgXTicket.id]);

      const res = await call("patch", `/admin/itop/customers/${customer.id}`, adminToken).send({ itopOrgId: 2 });
      expect(res.status).toBe(200);

      expect(await listTicketIds(customer.id)).toEqual([orgYTicket.id]);
      const stale = await prisma.itopTicket.findUniqueOrThrow({ where: { id: orgXTicket.id } });
      expect(stale.customerId).toBeNull();
    });

    it("unmapping a customer (itopOrgId: null) unlinks its tickets from the snapshot", async () => {
      const customer = await createCustomer({ itopOrgId: 1, itopOrgName: "Northwind Freight Sdn Bhd" });
      const ticket = await seedSnapshotTicket(1, customer.id);

      const res = await call("patch", `/admin/itop/customers/${customer.id}`, adminToken).send({ itopOrgId: null });
      expect(res.status).toBe(200);

      expect((await prisma.itopTicket.findUniqueOrThrow({ where: { id: ticket.id } })).customerId).toBeNull();
    });

    it("mapping a customer to an org that already has snapshot rows makes them visible immediately", async () => {
      const customer = await createCustomer();
      const t1 = await seedSnapshotTicket(2, null);
      const t2 = await seedSnapshotTicket(2, null);
      const otherOrg = await seedSnapshotTicket(1, null);

      const res = await call("patch", `/admin/itop/customers/${customer.id}`, adminToken).send({ itopOrgId: 2 });
      expect(res.status).toBe(200);

      expect((await listTicketIds(customer.id)).sort()).toEqual([t1.id, t2.id].sort());
      expect((await prisma.itopTicket.findUniqueOrThrow({ where: { id: otherOrg.id } })).customerId).toBeNull();
    });

    it("a rejected mapping (org already held by another customer) leaves the snapshot untouched", async () => {
      const holder = await createCustomer({ itopOrgId: 1, itopOrgName: "Northwind Freight Sdn Bhd" });
      const other = await createCustomer();
      const ticket = await seedSnapshotTicket(1, holder.id);

      const res = await call("patch", `/admin/itop/customers/${other.id}`, adminToken).send({ itopOrgId: 1 });
      expect(res.status).toBe(409);
      expect((await prisma.itopTicket.findUniqueOrThrow({ where: { id: ticket.id } })).customerId).toBe(holder.id);
    });

    it("POST /customers/automatch links the matched org's existing snapshot rows", async () => {
      const customer = await createCustomer({ name: "  pt sinar logistik  " });
      const ticket = await seedSnapshotTicket(2, null);

      const res = await call("post", "/admin/itop/customers/automatch", adminToken);
      expect(res.status).toBe(200);
      expect((await prisma.itopTicket.findUniqueOrThrow({ where: { id: ticket.id } })).customerId).toBe(customer.id);
    });
  });

  it("a remap waits for an in-flight sync to release the iTop sync advisory lock, then applies", async () => {
    const customer = await createCustomer({ itopOrgId: 1, itopOrgName: "Northwind Freight Sdn Bhd" });
    let releaseSync!: () => void;
    const syncHeld = new Promise<void>((resolve) => {
      releaseSync = resolve;
    });
    let lockTaken!: () => void;
    const lockAcquired = new Promise<void>((resolve) => {
      lockTaken = resolve;
    });
    // Stands in for a running sync: its interactive transaction holds the same
    // `pg_try_advisory_xact_lock(hashtext(ADVISORY_LOCK_KEY))`.
    const fakeSync = prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext(${ADVISORY_LOCK_KEY})) AS locked`;
        expect(rows[0]?.locked).toBe(true);
        lockTaken();
        await syncHeld;
      },
      { timeout: 30_000 },
    );
    await lockAcquired;

    let settled = false;
    const patch = Promise.resolve(
      call("patch", `/admin/itop/customers/${customer.id}`, adminToken).send({ itopOrgId: 2 }),
    ).then((res) => {
      settled = true;
      return res;
    });

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(settled).toBe(false);
    // Blocked on the lock before its first write: nothing has changed yet.
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).itopOrgId).toBe(1);

    releaseSync();
    await fakeSync;
    const res = await patch;
    expect(res.status).toBe(200);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).itopOrgId).toBe(2);
  });

  it("a remap that cannot get the sync lock within the lock timeout answers 409 itop_sync_in_progress and changes nothing (PATCH and automatch)", async () => {
    const customer = await createCustomer({ itopOrgId: 1, itopOrgName: "Northwind Freight Sdn Bhd" });
    const ticket = await prisma.itopTicket.create({
      data: {
        id: 931_000_001,
        class: "UserRequest",
        ref: "R-931000001",
        title: "Snapshot ticket",
        status: "new",
        orgId: 1,
        customerId: customer.id,
        lastUpdate: new Date(),
        syncedAt: new Date(),
      },
    });
    const unmapped = await createCustomer({ name: "  pt sinar logistik  " });

    let releaseSync!: () => void;
    const syncHeld = new Promise<void>((resolve) => {
      releaseSync = resolve;
    });
    let lockTaken!: () => void;
    const lockAcquired = new Promise<void>((resolve) => {
      lockTaken = resolve;
    });
    const fakeSync = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext(${ADVISORY_LOCK_KEY})) AS locked`;
        lockTaken();
        await syncHeld;
      },
      { timeout: 30_000 },
    );
    await lockAcquired;

    setMappingLockTimeoutMs(250);
    try {
      const patch = await call("patch", `/admin/itop/customers/${customer.id}`, adminToken).send({ itopOrgId: 2 });
      expect(patch.status).toBe(409);
      expect(patch.body.code).toBe("itop_sync_in_progress");
      expect(patch.body.error).toBe("An iTop sync is running. Try again in a minute.");

      const unmap = await call("patch", `/admin/itop/customers/${customer.id}`, adminToken).send({ itopOrgId: null });
      expect(unmap.status).toBe(409);
      expect(unmap.body.code).toBe("itop_sync_in_progress");

      const automatch = await call("post", "/admin/itop/customers/automatch", adminToken);
      expect(automatch.status).toBe(409);
      expect(automatch.body.code).toBe("itop_sync_in_progress");
    } finally {
      setMappingLockTimeoutMs(15_000);
      releaseSync();
      await fakeSync;
    }

    // Nothing changed: mapping and snapshot link are as before.
    const after = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(after.itopOrgId).toBe(1);
    expect((await prisma.itopTicket.findUniqueOrThrow({ where: { id: ticket.id } })).customerId).toBe(customer.id);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: unmapped.id } })).itopOrgId).toBeNull();

    // Once the sync finishes the same request goes through.
    const ok = await call("patch", `/admin/itop/customers/${customer.id}`, adminToken).send({ itopOrgId: 2 });
    expect(ok.status).toBe(200);

    // Unmapped customers aren't swept by resetItopTestState; later automatch
    // tests create a customer with this exact name.
    await prisma.customer.delete({ where: { id: unmapped.id } });
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
    // Wait for any fire-and-forget sync from this test to finish BEFORE
    // closing the fake server or resetting state below — otherwise it can
    // still be mid-flight when the next test's beforeEach/test body runs,
    // racing that test's own /sync calls or its ItopConfig reads/writes
    // (the cause of an intermittent 202 instead of 409 on the
    // "not configured" test in full-suite runs).
    await waitForItopSyncIdle();
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

    // Let the one real background run (from `first`) finish before this test
    // ends, so it can't still be in flight when the next test starts.
    await waitForItopSyncIdle();
  });

  it("POST /sync 409s itop_not_configured when iTop isn't connected", async () => {
    await clearItopConfig();
    const res = await call("post", "/admin/itop/sync", adminToken).send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("itop_not_configured");
  });
});

// A changed iTop address must not carry personal tokens issued for the old
// host: routes/itop.ts would decrypt each one and send it in the Auth-Token
// header to the new baseUrl. Before this guard, PATCH /settings changed only
// the address and every user's token survived.
describe("PATCH /admin/itop/settings — a baseUrl change disconnects every personal token", () => {
  async function userWithToken(): Promise<number> {
    const { userId } = await createUserWithRole("TAM");
    await prisma.user.update({
      where: { id: userId },
      data: {
        itopTokenEnc: seal(`personal-${userId}`),
        itopTokenPersonName: "Someone",
        itopTokenCheckedAt: new Date(),
        itopTokenExpiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    return userId;
  }

  it("nulls every user's token columns when the address really changes, and reports the count", async () => {
    await configureItop("https://itop-old.example.com");
    const a = await userWithToken();
    const b = await userWithToken();
    const { userId: untouched } = await createUserWithRole("TAM"); // never connected

    const res = await call("patch", "/admin/itop/settings", adminToken).send({
      baseUrl: "https://itop-new.example.com/",
    });
    expect(res.status).toBe(200);
    expect(res.body.baseUrl).toBe("https://itop-new.example.com");
    expect(res.body.disconnectedUsers).toBe(2);

    for (const id of [a, b, untouched]) {
      const user = await prisma.user.findUniqueOrThrow({ where: { id } });
      expect(user.itopTokenEnc).toBeNull();
      expect(user.itopTokenPersonName).toBeNull();
      expect(user.itopTokenCheckedAt).toBeNull();
      expect(user.itopTokenExpiresAt).toBeNull();
    }
  });

  it("keeps every token on a PATCH that repeats the stored address (also with a trailing slash) or changes other fields only", async () => {
    await configureItop("https://itop.example.com");
    const a = await userWithToken();

    const same = await call("patch", "/admin/itop/settings", adminToken).send({
      baseUrl: "https://itop.example.com/",
      refreshMinutes: 7,
    });
    expect(same.status).toBe(200);
    expect(same.body.disconnectedUsers).toBe(0);

    const other = await call("patch", "/admin/itop/settings", adminToken).send({ actionsEnabled: false });
    expect(other.status).toBe(200);
    expect(other.body.disconnectedUsers).toBe(0);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: a } });
    expect(user.itopTokenEnc).not.toBeNull();
    expect(user.itopTokenPersonName).toBe("Someone");
  });
});
