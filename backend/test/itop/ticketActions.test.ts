// Phase 5 write path (src/routes/itop.ts's POST /tickets/:id/actions and
// POST /tickets/:id/log). Exercises the precondition order (actionsEnabled,
// visibility, token presence), the assign_to_me team-resolution/ambiguity
// paths, iTop's own refusal passing through verbatim, that the snapshot only
// ever reflects iTop's re-read (never a client-side guess), and — the
// central Phase 5 invariant — that every write happens under the ACTING
// USER'S OWN personal token, never the application token. See
// docs/archive/plans/itop-integration.md Task 5.3.
import "../env.js";
import type { Server } from "node:http";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/prisma.js";
import { signToken } from "../../src/http/auth.js";
import { seal } from "../../src/lib/secretBox.js";
import { bustItopConfigCache } from "../../src/lib/itop/config.js";
import { syncTickets } from "../../src/lib/itop/sync.js";
import { seedRoles, createUserWithRole } from "../testAuth.js";
import { createFakeItop, seedFakeItop, type FakeItopState, FAKE_ITOP_TOKENS } from "./fakeItop.js";

const app = createApp();

// Shared with test/itop/sync.test.ts and test/itop/itopToken.test.ts — the
// fake iTop seed's fixed Person/User emails are the only User rows any of
// these files need to reclaim between tests.
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
      username: `itop-action-test-${userCounter}-${Date.now()}`,
      email,
      passwordHash: null,
      roleId: role.id,
      active: true,
    },
  });
  const token = signToken({ sub: user.id, role: role.roleName, permissions: role.permissions as string[] });
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
      name: `iTop action test customer 1 ${Date.now()}-${Math.random()}`,
      description: "d",
      tamId: rina.userId,
      itopOrgId: 1,
      itopOrgName: "Northwind Freight Sdn Bhd",
    },
  });
  await prisma.customer.create({
    data: {
      name: `iTop action test customer 2 ${Date.now()}-${Math.random()}`,
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

  // Pulls all 12 fake tickets into the real snapshot (with real customerId
  // links) AND matches rina/dedi's Solvro accounts to their fake Person by
  // email — exactly like production, rather than hand-crafting ItopTicket
  // rows here.
  await syncTickets({ full: true });

  fixture = { state, rina, dedi };
});

afterEach(async () => {
  if (fakeServer) {
    await closeServer(fakeServer);
    fakeServer = undefined;
  }
});

describe("preconditions", () => {
  it("404s when actionsEnabled is false", async () => {
    await prisma.itopConfig.update({ where: { id: "default" }, data: { actionsEnabled: false } });
    bustItopConfigCache();
    await linkPersonalToken(fixture.rina.userId, FAKE_ITOP_TOKENS.rina);

    const id = await ticketIdByRef("R-004535");
    const res = await call("post", `/itop/tickets/${id}/actions`, fixture.rina.token, { action: "pending" });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("not_found");
  });

  it("403s when the caller has no personal token saved", async () => {
    const id = await ticketIdByRef("R-004535");
    const res = await call("post", `/itop/tickets/${id}/actions`, fixture.rina.token, { action: "pending" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("itop_token_missing");
  });

  it("404s a ticket whose customer the caller cannot see", async () => {
    const outsider = await createUserWithRole("TAM");
    const id = await ticketIdByRef("R-004535"); // belongs to customer 1, owned by rina
    const res = await call("post", `/itop/tickets/${id}/actions`, outsider.token, { action: "pending" });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("customer_not_found");
  });

  it("403s when the caller's saved token can no longer be decrypted", async () => {
    await prisma.user.update({
      where: { id: fixture.rina.userId },
      data: { itopTokenEnc: "v1:not-a-real-iv:bad-tag:bad-ciphertext" },
    });
    const id = await ticketIdByRef("R-004535");
    const res = await call("post", `/itop/tickets/${id}/actions`, fixture.rina.token, { action: "pending" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("itop_token_unreadable");
  });
});

describe("assign_to_me", () => {
  it("assigns a new ticket to the caller, resolving their single team automatically", async () => {
    await linkPersonalToken(fixture.rina.userId, FAKE_ITOP_TOKENS.rina);
    const id = await ticketIdByRef("R-004535"); // status "new", org 1

    const res = await call("post", `/itop/tickets/${id}/actions`, fixture.rina.token, { action: "assign_to_me" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("assigned");
    expect(res.body.agentName).toBe("Rina S.");
    expect(res.body.agentPersonId).toBe(1);

    const row = await prisma.itopTicket.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("assigned");
  });

  it("requires a team when the caller belongs to more than one, then accepts an explicit one", async () => {
    await linkPersonalToken(fixture.dedi.userId, FAKE_ITOP_TOKENS.dedi);
    const id = await ticketIdByRef("R-004519"); // status "new", org 2

    const first = await call("post", `/itop/tickets/${id}/actions`, fixture.dedi.token, { action: "assign_to_me" });
    expect(first.status).toBe(409);
    expect(first.body.code).toBe("itop_team_required");
    expect(first.body.details.teams).toHaveLength(2);

    const second = await call("post", `/itop/tickets/${id}/actions`, fixture.dedi.token, {
      action: "assign_to_me",
      fields: { team_id: 10 },
    });
    expect(second.status).toBe(200);
    expect(second.body.status).toBe("assigned");
    expect(second.body.agentPersonId).toBe(2);
  });

  it("refuses a caller-supplied team the caller isn't actually a member of", async () => {
    await linkPersonalToken(fixture.dedi.userId, FAKE_ITOP_TOKENS.dedi);
    const id = await ticketIdByRef("R-004519"); // status "new", org 2

    const res = await call("post", `/itop/tickets/${id}/actions`, fixture.dedi.token, {
      action: "assign_to_me",
      fields: { team_id: 99 },
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("itop_team_required");
    expect(res.body.details.teams).toHaveLength(2);
    expect(res.body.details.teams.map((t: { id: number }) => t.id)).not.toContain(99);

    const row = await prisma.itopTicket.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("new");
  });
});

describe("resolve", () => {
  it("400s a resolve with no fields", async () => {
    await linkPersonalToken(fixture.rina.userId, FAKE_ITOP_TOKENS.rina);
    const id = await ticketIdByRef("R-004530"); // status "assigned"

    const res = await call("post", `/itop/tickets/${id}/actions`, fixture.rina.token, { action: "resolve" });
    expect(res.status).toBe(400);
  });

  it("resolves an assigned ticket and updates the snapshot from iTop's own answer", async () => {
    await linkPersonalToken(fixture.rina.userId, FAKE_ITOP_TOKENS.rina);
    const id = await ticketIdByRef("R-004530"); // status "assigned", agent Rina

    const res = await call("post", `/itop/tickets/${id}/actions`, fixture.rina.token, {
      action: "resolve",
      fields: { resolution_code: "assistance", solution: "Added the 2 users to the Acronis console." },
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("resolved");

    const row = await prisma.itopTicket.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("resolved");
  });
});

describe("close", () => {
  it("surfaces iTop's refusal verbatim and leaves the snapshot unchanged", async () => {
    await linkPersonalToken(fixture.rina.userId, FAKE_ITOP_TOKENS.rina);
    const id = await ticketIdByRef("R-004535"); // status "new" — ev_close needs "resolved"

    const res = await call("post", `/itop/tickets/${id}/actions`, fixture.rina.token, { action: "close" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("itop_refused");
    expect(res.body.error).toContain("ev_close");

    const row = await prisma.itopTicket.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("new");
  });
});

describe("POST /tickets/:id/log", () => {
  it("appends a public log entry authored by the caller, visible in the response and on the single-ticket read", async () => {
    await linkPersonalToken(fixture.rina.userId, FAKE_ITOP_TOKENS.rina);
    const id = await ticketIdByRef("R-004535");

    const res = await call("post", `/itop/tickets/${id}/log`, fixture.rina.token, {
      visibility: "public",
      text: "Called the customer, waiting on confirmation.",
    });

    expect(res.status).toBe(200);
    expect(res.body.publicLog).toHaveLength(1);
    expect(res.body.publicLog[0].author).toBe("Rina S.");
    expect(res.body.publicLog[0].message).toBe("Called the customer, waiting on confirmation.");

    const read = await call("get", `/itop/tickets/${id}`, fixture.rina.token);
    expect(read.status).toBe(200);
    expect(read.body.publicLog).toHaveLength(1);
    expect(read.body.publicLog[0].author).toBe("Rina S.");
  });
});

describe("re-read after a successful write", () => {
  it("answers 200 with staleAfterWrite:true and the pre-write snapshot when the post-write re-read fails, without retrying the write", async () => {
    await linkPersonalToken(fixture.rina.userId, FAKE_ITOP_TOKENS.rina);
    const id = await ticketIdByRef("R-004530"); // status "assigned", agent Rina

    // The write itself (apply_stimulus, under Rina's own token) must
    // succeed normally — only the APPLICATION token's next read is made to
    // fail, simulating e.g. iTop going briefly unreachable right after.
    fixture.state.failNextGetForToken = {
      token: FAKE_ITOP_TOKENS.app,
      message: "Simulated iTop outage during the post-write re-read",
    };

    const res = await call("post", `/itop/tickets/${id}/actions`, fixture.rina.token, {
      action: "resolve",
      fields: { resolution_code: "assistance", solution: "Done." },
    });

    expect(res.status).toBe(200);
    expect(res.body.staleAfterWrite).toBe(true);
    // The pre-write snapshot row is returned — the client-visible status is
    // still "assigned", NOT the "resolved" the write actually achieved in
    // iTop, since the re-read that would have told Solvro that failed.
    expect(res.body.status).toBe("assigned");

    // Exactly one write happened — the failed re-read is a core/get, never
    // logged in writeLog, and the failure must not have triggered a retry
    // of the stimulus itself.
    const writes = fixture.state.writeLog.filter((w) => w.operation === "core/apply_stimulus");
    expect(writes).toHaveLength(1);
    expect(writes[0].token).toBe(FAKE_ITOP_TOKENS.rina);
  });
});

describe("write identity", () => {
  it("never uses the application token for a write", async () => {
    await linkPersonalToken(fixture.rina.userId, FAKE_ITOP_TOKENS.rina);
    const id = await ticketIdByRef("R-004530");

    await call("post", `/itop/tickets/${id}/actions`, fixture.rina.token, {
      action: "resolve",
      fields: { resolution_code: "assistance", solution: "Done." },
    });

    expect(fixture.state.writeLog.length).toBeGreaterThan(0);
    for (const entry of fixture.state.writeLog) {
      expect(entry.token).not.toBe(FAKE_ITOP_TOKENS.app);
    }
  });
});
