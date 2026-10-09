// Phase 6 "New ticket" backend (src/routes/itop.ts's GET /services, GET
// /customers/:id/contacts, POST /tickets). Exercises the services picklist's
// 5-minute in-process cache, the contacts picklist's org-scoped Person
// lookup, and the creation route's precondition order + the central
// invariant that the create itself runs under the ACTING USER'S OWN
// personal token, never the application token. See
// docs/archive/plans/itop-integration.md Task 6.2.
import "../env.js";
import type { Server } from "node:http";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/prisma.js";
import { signToken } from "../../src/http/auth.js";
import { seal } from "../../src/lib/secretBox.js";
import { bustItopConfigCache } from "../../src/lib/itop/config.js";
import { bustItopServicesCache } from "../../src/routes/itop.js";
import { syncTickets } from "../../src/lib/itop/sync.js";
import { seedRoles, createUserWithRole } from "../testAuth.js";
import { createFakeItop, seedFakeItop, type FakeItopState, FAKE_ITOP_TOKENS } from "./fakeItop.js";

const app = createApp();

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
  // GET /services' 5-minute cache is module-level, so it survives across
  // tests/fake-iTop instances unless explicitly busted here — without this,
  // the caching test below would be vacuous (already warmed by whichever
  // test ran before it) rather than proving anything about THIS test's fake.
  bustItopServicesCache();
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
      username: `itop-create-test-${userCounter}-${Date.now()}`,
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
  customer1Id: number;
  customer2Id: number;
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

  const customer1 = await prisma.customer.create({
    data: {
      name: `iTop create test customer 1 ${Date.now()}-${Math.random()}`,
      description: "d",
      tamId: rina.userId,
      itopOrgId: 1,
      itopOrgName: "Northwind Freight Sdn Bhd",
    },
  });
  const customer2 = await prisma.customer.create({
    data: {
      name: `iTop create test customer 2 ${Date.now()}-${Math.random()}`,
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

  // Matches rina/dedi's Solvro accounts to their fake Person by email, same
  // as production — needed for the "writes as" identity, not for tickets
  // themselves (this suite creates its own, it doesn't need the 12 seeded
  // ones synced in).
  await syncTickets({ full: true });

  fixture = { state, rina, dedi, customer1Id: customer1.id, customer2Id: customer2.id };
});

afterEach(async () => {
  if (fakeServer) {
    await closeServer(fakeServer);
    fakeServer = undefined;
  }
});

describe("GET /itop/services", () => {
  it("returns the service picklist sorted by name, with the provider org as providerName", async () => {
    const res = await call("get", "/itop/services", fixture.rina.token);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 3, name: "Backup", providerName: "Northwind Freight Sdn Bhd" },
      { id: 1, name: "Network / WAN", providerName: "Northwind Freight Sdn Bhd" },
      { id: 2, name: "Service Desk", providerName: "PT Sinar Logistik" },
    ]);
  });

  it("caches the result for 5 minutes — a second call never reaches the fake", async () => {
    // `resetItopTestState` (beforeEach) busts the module-level services
    // cache, so this test starts uncached regardless of what earlier tests
    // in this file left warm — without that bust, this assertion would be
    // vacuous: the FIRST call below could already be served from a
    // previous test's (now-closed) fake via the leftover cache, making
    // `requestCount` rise only because of this test's own beforeEach sync,
    // never proving the /services call itself hit (or skipped) the fake.
    const before = fixture.state.requestCount;

    const first = await call("get", "/itop/services", fixture.rina.token);
    expect(first.status).toBe(200);
    expect(fixture.state.requestCount).toBeGreaterThan(before);
    const countAfterFirst = fixture.state.requestCount;

    const second = await call("get", "/itop/services", fixture.rina.token);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(fixture.state.requestCount).toBe(countAfterFirst);
  });
});

describe("GET /itop/customers/:id/contacts", () => {
  it("returns the mapped customer's org contacts sorted by name", async () => {
    const res = await call("get", `/itop/customers/${fixture.customer1Id}/contacts`, fixture.rina.token);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 3, name: "Budi H.", email: "budi.h@example.co.id" },
      { id: 1, name: "Rina S.", email: "rina.s@example.co.id" },
    ]);
  });

  it("returns [] for a customer with no iTop org mapping", async () => {
    const unmapped = await prisma.customer.create({
      data: {
        name: `iTop create test unmapped customer ${Date.now()}-${Math.random()}`,
        description: "d",
        tamId: fixture.rina.userId,
      },
    });

    const res = await call("get", `/itop/customers/${unmapped.id}/contacts`, fixture.rina.token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("404s a customer the caller cannot see", async () => {
    const outsider = await createUserWithRole("TAM");
    const res = await call("get", `/itop/customers/${fixture.customer1Id}/contacts`, outsider.token);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("customer_not_found");
  });
});

describe("permission gating", () => {
  // The permission check runs before validation, visibility and the
  // personal-token check, so a valid saved token doesn't help a caller whose
  // role cannot write.
  it("403s a STAKEHOLDER on POST /itop/tickets even with a valid personal token", async () => {
    const user = await createUserWithRole("STAKEHOLDER");
    await linkPersonalToken(user.userId, FAKE_ITOP_TOKENS.rina);

    const res = await call("post", "/itop/tickets", user.token, {
      customerId: fixture.customer1Id,
      class: "UserRequest",
      title: "Should not be created",
      description: "Blocked by task:write.",
      callerId: 1,
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("forbidden");
    expect(fixture.state.writeLog.filter((w) => w.operation === "core/create")).toHaveLength(0);
  });

  it("403s a PENDING user on the picklists and on POST /itop/tickets", async () => {
    const pending = await createUserWithRole("PENDING");
    expect((await call("get", "/itop/services", pending.token)).status).toBe(403);
    expect((await call("get", `/itop/customers/${fixture.customer1Id}/contacts`, pending.token)).status).toBe(403);
    expect((await call("post", "/itop/tickets", pending.token, {})).status).toBe(403);
  });

  it("keeps the read-only picklists open to a project:read-only STAKEHOLDER", async () => {
    const stakeholder = await createUserWithRole("STAKEHOLDER");
    expect((await call("get", "/itop/services", stakeholder.token)).status).toBe(200);
  });
});

describe("POST /itop/tickets", () => {
  it("creates a ticket under the caller's own token and returns it with iTop's ref", async () => {
    await linkPersonalToken(fixture.rina.userId, FAKE_ITOP_TOKENS.rina);

    const res = await call("post", "/itop/tickets", fixture.rina.token, {
      customerId: fixture.customer1Id,
      class: "UserRequest",
      title: "New laptop for a starter",
      description: "Needs a laptop provisioned before Monday.",
      callerId: 1, // Rina herself is a Person in org 1
      serviceId: 1, // Network / WAN, org 1
    });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("new");
    expect(res.body.ref).toMatch(/^R-\d{6}$/);

    const row = await prisma.itopTicket.findUniqueOrThrow({ where: { ref: res.body.ref } });
    expect(row.customerId).toBe(fixture.customer1Id);
    expect(row.status).toBe("new");

    const writes = fixture.state.writeLog.filter((w) => w.operation === "core/create");
    expect(writes).toHaveLength(1);
    expect(writes[0].token).toBe(FAKE_ITOP_TOKENS.rina);
    expect(writes[0].token).not.toBe(FAKE_ITOP_TOKENS.app);
    expect(writes[0].comment).toBe("Solvro: ticket created by rina.s@example.co.id");
  });

  it("400s when description is missing", async () => {
    await linkPersonalToken(fixture.rina.userId, FAKE_ITOP_TOKENS.rina);

    const res = await call("post", "/itop/tickets", fixture.rina.token, {
      customerId: fixture.customer1Id,
      class: "UserRequest",
      title: "New laptop for a starter",
      callerId: 1,
    });

    expect(res.status).toBe(400);
  });

  it("400s customer_not_found for a customer the caller cannot see (customerId is a BODY field, not an id-keyed param)", async () => {
    const outsider = await createUserWithRole("TAM");

    const res = await call("post", "/itop/tickets", outsider.token, {
      customerId: fixture.customer1Id, // owned by rina; the outsider has no visibility into it
      class: "UserRequest",
      title: "New laptop for a starter",
      description: "Needs a laptop provisioned before Monday.",
      callerId: 1,
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("customer_not_found");
  });

  it("400s itop_caller_not_in_org when the caller belongs to a different organisation", async () => {
    await linkPersonalToken(fixture.rina.userId, FAKE_ITOP_TOKENS.rina);

    const res = await call("post", "/itop/tickets", fixture.rina.token, {
      customerId: fixture.customer1Id, // org 1
      class: "UserRequest",
      title: "New laptop for a starter",
      description: "Needs a laptop provisioned before Monday.",
      callerId: 2, // Dedi is a Person in org 2
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("itop_caller_not_in_org");
  });

  it("404s when actionsEnabled is false", async () => {
    await prisma.itopConfig.update({ where: { id: "default" }, data: { actionsEnabled: false } });
    bustItopConfigCache();
    await linkPersonalToken(fixture.rina.userId, FAKE_ITOP_TOKENS.rina);

    const res = await call("post", "/itop/tickets", fixture.rina.token, {
      customerId: fixture.customer1Id,
      class: "UserRequest",
      title: "New laptop for a starter",
      description: "Needs a laptop provisioned before Monday.",
      callerId: 1,
    });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("not_found");
  });

  it("403s when the caller has no personal token saved", async () => {
    const res = await call("post", "/itop/tickets", fixture.rina.token, {
      customerId: fixture.customer1Id,
      class: "UserRequest",
      title: "New laptop for a starter",
      description: "Needs a laptop provisioned before Monday.",
      callerId: 1,
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("itop_token_missing");
  });

  it("surfaces iTop's refusal verbatim as 409", async () => {
    await linkPersonalToken(fixture.rina.userId, FAKE_ITOP_TOKENS.rina);

    // serviceId isn't re-validated by Solvro's own pre-checks (unlike
    // org_id/caller_id) — a nonexistent one reaches the fake's core/create
    // unchanged and gets refused there, exercising the "iTop's own message
    // passes through verbatim" path.
    const res = await call("post", "/itop/tickets", fixture.rina.token, {
      customerId: fixture.customer1Id,
      class: "UserRequest",
      title: "New laptop for a starter",
      description: "Needs a laptop provisioned before Monday.",
      callerId: 1,
      serviceId: 999,
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("itop_refused");
    expect(res.body.error).toContain("Service::999");

    const writes = fixture.state.writeLog.filter((w) => w.operation === "core/create");
    expect(writes).toHaveLength(1);
  });

  it("202s with created:true and staleAfterWrite:true when the post-create re-read fails", async () => {
    await linkPersonalToken(fixture.rina.userId, FAKE_ITOP_TOKENS.rina);

    // Simulates the read-only re-read (APPLICATION client) failing right
    // after the create itself (under Rina's own token) already succeeded —
    // e.g. iTop briefly unreachable. `disabledClasses` only affects
    // core/get, never core/create, and the pre-create caller-in-org check
    // reads a DIFFERENT class (Person) — so the create still goes through
    // normally and only the post-create re-read of UserRequest fails. The
    // token-scoped `failNextGetForToken` trap used by ticketActions.test.ts
    // doesn't fit here: this route makes an app-token core/get (the
    // caller-in-org check) BEFORE the write, which would consume a one-shot
    // trap meant for the write's own re-read.
    fixture.state.disabledClasses.add("UserRequest");

    const res = await call("post", "/itop/tickets", fixture.rina.token, {
      customerId: fixture.customer1Id,
      class: "UserRequest",
      title: "New laptop for a starter",
      description: "Needs a laptop provisioned before Monday.",
      callerId: 1,
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
