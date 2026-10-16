// Exercises backend/src/lib/itop/sync.ts against the in-memory fake iTop and
// a real (isolated) database: full/incremental ticket pulls, the full-sync
// drop of tickets iTop no longer returns, user↔Person/User email matching,
// the advisory-lock single-runner guarantee, and iTop-error handling. See
// docs/archive/plans/itop-integration.md Task 1.4.
import "../env.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { prisma } from "../../src/prisma.js";
import { seal } from "../../src/lib/secretBox.js";
import { bustItopConfigCache } from "../../src/lib/itop/config.js";
import {
  formatItopDate,
  parseItopBoolean,
  parseItopDate,
  parseItopInt,
  syncTickets,
  syncTimeEntries,
  syncUsers,
  TIME_ENTRY_WINDOW_MS,
} from "../../src/lib/itop/sync.js";
import { zonedWallTimeToUtc } from "../../src/lib/itop/timezone.js";
import { seedRoles, createUserWithRole } from "../testAuth.js";
import { createFakeItop, seedFakeItop, type FakeItopState, type TicketRecord, FAKE_ITOP_TOKENS } from "./fakeItop.js";

let fakeServer: Server | undefined;

async function startFake(state: FakeItopState): Promise<{ state: FakeItopState; baseUrl: string }> {
  const { listen, state: returnedState } = createFakeItop(state);
  const { server, baseUrl } = await listen(0);
  fakeServer = server;
  return { state: returnedState, baseUrl };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

// NOTE: deliberately NOT named `formatItopDate` — this file also imports the
// real (zone-aware) `formatItopDate` from lib/itop/sync.ts above, and a
// same-named local declaration here would shadow that import at runtime
// (esbuild's per-file transpile doesn't flag the collision as a type error
// the way a full tsc build normally would), silently making every "Paris"
// test below format in UTC regardless of the `tz` argument. Discovered via
// the "incremental cutoff is expressed in the server's own zone" test
// intermittently computing a UTC-shaped cutoff no matter what zone was
// requested.
function formatUtcDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}

/** Inverse of formatUtcDate, for comparing/offsetting the fixture's own seeded timestamps. Assumes the fixture's own timezone is UTC — use `parseFakeDateInZone` for a non-UTC fake. */
function parseFakeDate(value: string): Date {
  const [datePart, timePart] = value.split(" ");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, mi, s] = timePart.split(":").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
}

/** Same idea as `parseFakeDate`, but interprets the wall-clock string in `tz` (via the real `zonedWallTimeToUtc` conversion) rather than assuming UTC — for fixtures seeded against a non-UTC fake (`state.timezone`). */
function parseFakeDateInZone(value: string, tz: string): Date {
  const [datePart, timePart] = value.split(" ");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, mi, s] = timePart.split(":").map(Number);
  return zonedWallTimeToUtc(y, mo, d, h, mi, s, tz);
}

async function configureItop(baseUrl: string, token: string, timezone = "UTC"): Promise<void> {
  await prisma.itopConfig.upsert({
    where: { id: "default" },
    create: { id: "default", baseUrl, appTokenEnc: seal(token), timezone },
    update: {
      baseUrl,
      appTokenEnc: seal(token),
      timezone,
      lastSyncAt: null,
      lastSyncOk: null,
      lastSyncError: null,
      lastFullSyncAt: null,
    },
  });
  bustItopConfigCache();
}

/** Swaps only the app token — unlike configureItop, preserves lastSyncAt/lastFullSyncAt, for simulating an outage mid-run without resetting the watermark under test. */
async function setAppToken(token: string): Promise<void> {
  await prisma.itopConfig.update({ where: { id: "default" }, data: { appTokenEnc: seal(token) } });
  bustItopConfigCache();
}

let customerCounter = 0;
async function createMappedCustomer(itopOrgId: number, itopOrgName: string): Promise<number> {
  customerCounter += 1;
  const customer = await prisma.customer.create({
    data: {
      name: `Sync test customer ${customerCounter}-${Date.now()}-${Math.random()}`,
      description: "",
      itopOrgId,
      itopOrgName,
    },
  });
  return customer.id;
}

function extraTicket(overrides: Partial<TicketRecord> & { id: number }): TicketRecord {
  return {
    class: "UserRequest",
    ref: `R-EXTRA-${overrides.id}`,
    title: "Extra ticket",
    status: "new",
    operational_status: "normal",
    priority: "3",
    agent_id: "0",
    agent_id_friendlyname: "",
    team_id_friendlyname: "",
    service_id_friendlyname: "",
    caller_id_friendlyname: "",
    org_id: "1",
    start_date: "2026-01-01 00:00:00",
    last_update: "2026-01-01 00:00:00",
    tto: 0,
    ttr: 0,
    tto_escalation_deadline: "",
    ttr_escalation_deadline: "",
    sla_tto_passed: "0",
    sla_ttr_passed: "0",
    resolution_date: "",
    public_log: { entries: [] },
    private_log: { entries: [] },
    ...overrides,
  };
}

beforeAll(async () => {
  await seedRoles();
});

// The fake iTop seed's Person/User emails, shared by this file and
// test/itopAdmin.test.ts's own person-match tests — the only User rows
// either file needs to reclaim between tests. "no-such-person@example.co.id"
// is this file's own deliberately-unmatched fixture email.
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
// other user in the DB carries an auto-generated, timestamp-unique email).
// Run BEFORE every test (not just after) so this file's very first test
// starts clean regardless of what ran before it.
async function resetItopTestState(): Promise<void> {
  // itop_time_entries is exclusively this integration's table too (Task
  // 3.1), same reasoning as itopTicket below — a full wipe is safe.
  await prisma.itopTimeEntry.deleteMany();
  await prisma.itopTicket.deleteMany();
  await prisma.customer.deleteMany({ where: { itopOrgId: { not: null } } });
  await prisma.user.deleteMany({ where: { email: { in: ITOP_FIXTURE_EMAILS } } });
  await prisma.itopConfig.deleteMany({ where: { id: "default" } });
  bustItopConfigCache();
}

beforeEach(async () => {
  await resetItopTestState();
});

afterEach(async () => {
  if (fakeServer) {
    await closeServer(fakeServer);
    fakeServer = undefined;
  }
});

describe("syncTickets", () => {
  it("first full pull upserts all tickets for mapped customers only; an unmapped org's tickets are not pulled", async () => {
    const state = seedFakeItop();
    // A third org with a ticket that no Solvro customer maps to.
    state.organizations.set(3, { id: 3, name: "Unmapped Org" });
    const unmappedId = state.nextId++;
    state.tickets.set(unmappedId, extraTicket({ id: unmappedId, ref: "R-UNMAPPED-1", org_id: "3" }));

    const { baseUrl } = await startFake(state);
    await configureItop(baseUrl, FAKE_ITOP_TOKENS.app);

    const customer1 = await createMappedCustomer(1, "Northwind Freight Sdn Bhd");
    const customer2 = await createMappedCustomer(2, "PT Sinar Logistik");

    const summary = await syncTickets({ full: true });

    expect(summary.ran).toBe(true);
    expect(summary.full).toBe(true);
    expect(summary.orgs).toBe(2);
    expect(summary.error).toBeUndefined();

    const expectedRefs = [...state.tickets.values()]
      .filter((t) => t.org_id === "1" || t.org_id === "2")
      .map((t) => t.ref);
    expect(summary.upserted).toBe(expectedRefs.length);

    const rows = await prisma.itopTicket.findMany();
    expect(rows).toHaveLength(expectedRefs.length);
    expect(rows.some((r) => r.ref === "R-UNMAPPED-1")).toBe(false);

    const org1Ticket = rows.find((r) => r.orgId === 1);
    expect(org1Ticket?.customerId).toBe(customer1);
    const org2Ticket = rows.find((r) => r.orgId === 2);
    expect(org2Ticket?.customerId).toBe(customer2);

    const config = await prisma.itopConfig.findUniqueOrThrow({ where: { id: "default" } });
    expect(config.lastSyncOk).toBe(true);
    expect(config.lastSyncAt).not.toBeNull();
    expect(config.lastFullSyncAt).not.toBeNull();
  });

  it("maps the escalation-deadline attributes into tto/ttr, never the elapsed-clock integers", async () => {
    const state = seedFakeItop();
    const { baseUrl } = await startFake(state);
    await configureItop(baseUrl, FAKE_ITOP_TOKENS.app);
    await createMappedCustomer(1, "Northwind Freight Sdn Bhd");
    await createMappedCustomer(2, "PT Sinar Logistik");

    // A real iTop 3.2.2 install returns `tto`/`ttr` as JSON integers (elapsed
    // SLA-stopwatch seconds) — values that used to crash the whole sync
    // (`value.trim is not a function`) when fed to parseItopDate. Set them
    // here to prove they're no longer even read, while the DEADLINE
    // attributes are what actually lands in the snapshot.
    const ticket = [...state.tickets.values()].find((t) => t.ref === "R-004512")!;
    ticket.tto = 182;
    ticket.ttr = 540;
    ticket.tto_escalation_deadline = "2026-06-01 10:00:00";
    ticket.ttr_escalation_deadline = "2026-06-02 12:00:00";

    const summary = await syncTickets({ full: true });
    expect(summary.error).toBeUndefined();
    expect(summary.skipped).toBe(0);

    const row = await prisma.itopTicket.findUniqueOrThrow({ where: { ref: "R-004512" } });
    expect(row.tto?.toISOString()).toBe("2026-06-01T10:00:00.000Z");
    expect(row.ttr?.toISOString()).toBe("2026-06-02T12:00:00.000Z");
  });

  it("a ticket with a malformed field is skipped — the rest of the sync still completes and lastSyncOk stays true", async () => {
    const state = seedFakeItop();
    // A field a real install could plausibly omit/rename — missing entirely
    // once it round-trips through JSON (a key with value `undefined` is
    // dropped by JSON.stringify), so `fields.status` arrives as `undefined`
    // and Prisma refuses the write for this one row's required column.
    const malformedId = state.nextId++;
    state.tickets.set(
      malformedId,
      extraTicket({ id: malformedId, ref: "R-MALFORMED-1", org_id: "1", status: undefined as unknown as string }),
    );

    const { baseUrl } = await startFake(state);
    await configureItop(baseUrl, FAKE_ITOP_TOKENS.app);
    await createMappedCustomer(1, "Northwind Freight Sdn Bhd");
    await createMappedCustomer(2, "PT Sinar Logistik");

    const summary = await syncTickets({ full: true });

    expect(summary.ran).toBe(true);
    expect(summary.error).toBeUndefined();
    expect(summary.skipped).toBe(1);

    const config = await prisma.itopConfig.findUniqueOrThrow({ where: { id: "default" } });
    expect(config.lastSyncOk).toBe(true);
    // Non-fatal: folded into lastSyncError as an admin-visible note even
    // though the run itself succeeded (lastSyncOk stays true) — there's no
    // dedicated "skipped count" column.
    expect(config.lastSyncError).toBe("Skipped 1 row that could not be read (see server log)");

    const rows = await prisma.itopTicket.findMany();
    expect(rows.some((r) => r.ref === "R-MALFORMED-1")).toBe(false);
    // The rest of org 1 and org 2's tickets synced normally despite the one
    // bad row.
    expect(rows.length).toBeGreaterThan(0);
  });

  it("a duplicate ref triggers a REAL Postgres unique-constraint error mid-loop — the rest of the sync still completes", async () => {
    const state = seedFakeItop();
    // Same `ref` as the seeded R-004512 (Incident, org 1, id 1) but a
    // DIFFERENT iTop object id and a different (still-mapped) org. This is a
    // genuine Postgres unique-constraint violation (P2002 on
    // ItopTicket.ref) raised by the database itself — not something any of
    // sync.ts's own field-level validation catches ahead of time — so it
    // exercises the per-row try/catch against a real database error rather
    // than a synthetic one.
    const duplicateId = state.nextId++;
    state.tickets.set(
      duplicateId,
      extraTicket({ id: duplicateId, ref: "R-004512", class: "Incident", org_id: "2" }),
    );

    const { baseUrl } = await startFake(state);
    await configureItop(baseUrl, FAKE_ITOP_TOKENS.app);
    await createMappedCustomer(1, "Northwind Freight Sdn Bhd");
    await createMappedCustomer(2, "PT Sinar Logistik");

    const summary = await syncTickets({ full: true });

    expect(summary.ran).toBe(true);
    expect(summary.error).toBeUndefined();
    expect(summary.skipped).toBe(1);

    const config = await prisma.itopConfig.findUniqueOrThrow({ where: { id: "default" } });
    expect(config.lastSyncOk).toBe(true);
    expect(config.lastSyncError).toBe("Skipped 1 row that could not be read (see server log)");

    // Org 2's OTHER tickets still synced normally despite the one row that
    // collided on ref.
    const org2Rows = await prisma.itopTicket.findMany({ where: { orgId: 2 } });
    expect(org2Rows.length).toBeGreaterThan(0);

    // Exactly one row holds this ref — the original (org 1), never the
    // duplicate.
    const rows = await prisma.itopTicket.findMany({ where: { ref: "R-004512" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.orgId).toBe(1);
  });

  it("incremental sync only updates a ticket whose last_update moved past the cutoff", async () => {
    const state = seedFakeItop();
    const { baseUrl } = await startFake(state);
    await configureItop(baseUrl, FAKE_ITOP_TOKENS.app);
    await createMappedCustomer(1, "Northwind Freight Sdn Bhd");
    await createMappedCustomer(2, "PT Sinar Logistik");

    const first = await syncTickets({ full: true });
    expect(first.ran).toBe(true);

    // Pin the cutoff relative to the fixture's own timestamps instead of the
    // real wall clock: several seeded tickets use a fixed "today at 09:00"
    // last_update (mkTicket's ageDays: 0/1 both resolve to `daysAgo(0)`),
    // which is in the future whenever the suite happens to run before 09:00
    // — so anchoring to `Date.now()` intermittently pulled 5 rows instead of
    // just the one we mutate. Anchor to the latest last_update already in
    // the fixture instead.
    const latestSeedUpdate = Math.max(
      ...[...state.tickets.values()].map((t) => parseFakeDate(t.last_update).getTime()),
    );
    const anchor = new Date(latestSeedUpdate + 61_000);
    await prisma.itopConfig.update({ where: { id: "default" }, data: { lastSyncAt: anchor } });
    bustItopConfigCache();

    const mutated = [...state.tickets.values()].find((t) => t.ref === "R-004530")!;
    mutated.status = "resolved";
    mutated.last_update = formatUtcDate(new Date(latestSeedUpdate + 120_000));

    const second = await syncTickets();
    expect(second.ran).toBe(true);
    expect(second.full).toBe(false);
    expect(second.upserted).toBe(1);

    const row = await prisma.itopTicket.findUniqueOrThrow({ where: { ref: "R-004530" } });
    expect(row.status).toBe("resolved");

    const config = await prisma.itopConfig.findUniqueOrThrow({ where: { id: "default" } });
    expect(config.lastSyncAt!.getTime()).toBeGreaterThan(first.startedAt.getTime());
  });

  it("a full sync drops a ticket iTop no longer returns", async () => {
    const state = seedFakeItop();
    const { baseUrl } = await startFake(state);
    await configureItop(baseUrl, FAKE_ITOP_TOKENS.app);
    await createMappedCustomer(1, "Northwind Freight Sdn Bhd");
    await createMappedCustomer(2, "PT Sinar Logistik");

    await syncTickets({ full: true });
    const before = await prisma.itopTicket.findUnique({ where: { ref: "R-004512" } });
    expect(before).not.toBeNull();

    const [deletedId] = [...state.tickets.entries()].find(([, t]) => t.ref === "R-004512")!;
    state.tickets.delete(deletedId);

    const summary = await syncTickets({ full: true });
    expect(summary.ran).toBe(true);
    expect(summary.removed).toBeGreaterThanOrEqual(1);

    const after = await prisma.itopTicket.findUnique({ where: { ref: "R-004512" } });
    expect(after).toBeNull();
  });

  it("unmapping a customer purges its tickets on the next full sync, not just a stale customerId", async () => {
    const state = seedFakeItop();
    const { baseUrl } = await startFake(state);
    await configureItop(baseUrl, FAKE_ITOP_TOKENS.app);
    const customer1 = await createMappedCustomer(1, "Northwind Freight Sdn Bhd");
    await createMappedCustomer(2, "PT Sinar Logistik");

    await syncTickets({ full: true });
    const org1RowsBefore = await prisma.itopTicket.findMany({ where: { orgId: 1 } });
    expect(org1RowsBefore.length).toBeGreaterThan(0);

    // Unmap the customer — ON DELETE SET NULL on ItopTicket.customerId means
    // these rows would otherwise sit around with a stale/null customerId
    // forever, invisible to any admin re-mapping flow.
    await prisma.customer.update({ where: { id: customer1 }, data: { itopOrgId: null, itopOrgName: null } });

    const summary = await syncTickets({ full: true });
    expect(summary.ran).toBe(true);
    expect(summary.orgs).toBe(1);
    expect(summary.removed).toBeGreaterThanOrEqual(org1RowsBefore.length);

    const org1RowsAfter = await prisma.itopTicket.findMany({ where: { orgId: 1 } });
    expect(org1RowsAfter).toHaveLength(0);

    // The still-mapped org's tickets are untouched.
    const org2RowsAfter = await prisma.itopTicket.findMany({ where: { orgId: 2 } });
    expect(org2RowsAfter.length).toBeGreaterThan(0);
  });

  it("two concurrent syncTickets() calls result in exactly one ran:true", async () => {
    const state = seedFakeItop();
    const { baseUrl } = await startFake(state);
    await configureItop(baseUrl, FAKE_ITOP_TOKENS.app);
    await createMappedCustomer(1, "Northwind Freight Sdn Bhd");
    await createMappedCustomer(2, "PT Sinar Logistik");

    const [a, b] = await Promise.all([syncTickets({ full: true }), syncTickets({ full: true })]);
    const ranCount = [a, b].filter((s) => s.ran).length;
    expect(ranCount).toBe(1);
  });

  it("an iTop error (bad token) is recorded and leaves tickets untouched, on a fresh (never-synced) config", async () => {
    const state = seedFakeItop();
    const { baseUrl } = await startFake(state);
    await configureItop(baseUrl, "not-a-real-token");
    await createMappedCustomer(1, "Northwind Freight Sdn Bhd");
    await createMappedCustomer(2, "PT Sinar Logistik");

    const summary = await syncTickets({ full: true });

    expect(summary.ran).toBe(true);
    expect(summary.error).toBeTruthy();
    expect(summary.upserted).toBe(0);

    const rows = await prisma.itopTicket.findMany();
    expect(rows).toHaveLength(0);

    const config = await prisma.itopConfig.findUniqueOrThrow({ where: { id: "default" } });
    expect(config.lastSyncOk).toBe(false);
    expect(config.lastSyncError).toBeTruthy();
    expect(config.lastSyncAt).toBeNull();
  });

  it("a failed run never advances lastSyncAt — a ticket updated during the outage is still picked up once iTop is reachable again", async () => {
    const state = seedFakeItop();
    const { baseUrl } = await startFake(state);
    await configureItop(baseUrl, FAKE_ITOP_TOKENS.app);
    await createMappedCustomer(1, "Northwind Freight Sdn Bhd");
    await createMappedCustomer(2, "PT Sinar Logistik");

    const first = await syncTickets({ full: true });
    expect(first.ran).toBe(true);
    expect(first.error).toBeUndefined();

    // Pin the watermark to the fixture's own timestamps for the same reason
    // as the incremental test above — several seeded tickets share a fixed
    // "today at 09:00" last_update, which real-wall-clock anchoring would
    // intermittently swallow.
    const latestSeedUpdate = Math.max(
      ...[...state.tickets.values()].map((t) => parseFakeDate(t.last_update).getTime()),
    );
    const anchor = new Date(latestSeedUpdate + 61_000);
    await prisma.itopConfig.update({ where: { id: "default" }, data: { lastSyncAt: anchor } });
    bustItopConfigCache();
    const configBefore = await prisma.itopConfig.findUniqueOrThrow({ where: { id: "default" } });

    // A ticket changes in iTop *during* the outage.
    const mutated = [...state.tickets.values()].find((t) => t.ref === "R-004530")!;
    mutated.status = "resolved";
    mutated.last_update = formatUtcDate(new Date(latestSeedUpdate + 120_000));

    // setAppToken (not configureItop) — an outage doesn't reset the watermark.
    await setAppToken("not-a-real-token");
    const failed = await syncTickets();

    expect(failed.ran).toBe(true);
    expect(failed.error).toBeTruthy();
    expect(failed.upserted).toBe(0);

    const rowDuringOutage = await prisma.itopTicket.findUnique({ where: { ref: "R-004530" } });
    expect(rowDuringOutage?.status).not.toBe("resolved");

    const configAfterFailure = await prisma.itopConfig.findUniqueOrThrow({ where: { id: "default" } });
    expect(configAfterFailure.lastSyncOk).toBe(false);
    expect(configAfterFailure.lastSyncError).toBeTruthy();
    // The regression: a failed run must not move the watermark forward.
    expect(configAfterFailure.lastSyncAt!.getTime()).toBe(configBefore.lastSyncAt!.getTime());

    // Outage over — the next incremental run's cutoff is still anchored to
    // the last *successful* sync, so it must pick up the change that
    // happened while iTop was unreachable.
    await setAppToken(FAKE_ITOP_TOKENS.app);
    const recovered = await syncTickets();

    expect(recovered.ran).toBe(true);
    expect(recovered.error).toBeUndefined();
    expect(recovered.upserted).toBe(1);

    const row = await prisma.itopTicket.findUniqueOrThrow({ where: { ref: "R-004530" } });
    expect(row.status).toBe("resolved");
  });
});

describe("syncTickets against a non-UTC iTop server timezone (Europe/Paris)", () => {
  it("a ticket created at a known summer instant syncs back to the same UTC instant", async () => {
    const state = seedFakeItop();
    state.timezone = "Europe/Paris";
    // R-004512's start_date, explicitly overwritten to a known Paris
    // wall-clock reading in summer (CEST, +2) — the fake now emits every
    // OTHER date it seeds in Paris time too (state.timezone), but pinning
    // this one to a literal string makes the expected UTC instant obvious.
    const ticket = [...state.tickets.values()].find((t) => t.ref === "R-004512")!;
    ticket.start_date = "2026-07-01 14:00:00";

    const { baseUrl } = await startFake(state);
    await configureItop(baseUrl, FAKE_ITOP_TOKENS.app, "Europe/Paris");
    await createMappedCustomer(1, "Northwind Freight Sdn Bhd");
    await createMappedCustomer(2, "PT Sinar Logistik");

    const summary = await syncTickets({ full: true });
    expect(summary.error).toBeUndefined();

    const row = await prisma.itopTicket.findUniqueOrThrow({ where: { ref: "R-004512" } });
    // 14:00 CEST (+2) is 12:00 UTC — correctly converted, not taken literally.
    expect(row.startDate?.toISOString()).toBe("2026-07-01T12:00:00.000Z");
  });

  it("the incremental cutoff is expressed in the server's own zone, not UTC", async () => {
    const state = seedFakeItop();
    state.timezone = "Europe/Paris";
    const { baseUrl } = await startFake(state);
    await configureItop(baseUrl, FAKE_ITOP_TOKENS.app, "Europe/Paris");
    await createMappedCustomer(1, "Northwind Freight Sdn Bhd");
    await createMappedCustomer(2, "PT Sinar Logistik");

    const first = await syncTickets({ full: true });
    expect(first.ran).toBe(true);

    // Anchor relative to the fixture's own latest Paris-zoned last_update —
    // parsed with parseFakeDateInZone (NOT parseFakeDate, which would
    // wrongly treat these Paris wall-clock strings as if they were UTC).
    const latestSeedUpdateMs = Math.max(
      ...[...state.tickets.values()].map((t) => parseFakeDateInZone(t.last_update, "Europe/Paris").getTime()),
    );
    const anchor = new Date(latestSeedUpdateMs + 61_000);
    await prisma.itopConfig.update({ where: { id: "default" }, data: { lastSyncAt: anchor } });
    bustItopConfigCache();

    const mutated = [...state.tickets.values()].find((t) => t.ref === "R-004530")!;
    mutated.status = "resolved";
    // A fresh last_update, formatted in Paris time via the SAME
    // formatItopDate the production sync code uses to build its OQL cutoff —
    // if that cutoff were built in UTC instead, this Paris-zoned string
    // (2h+ away from a UTC reading of the same instant) would fail to
    // compare correctly against it and this row would never be picked up.
    mutated.last_update = formatItopDate(new Date(latestSeedUpdateMs + 120_000), "Europe/Paris");

    const second = await syncTickets();
    expect(second.ran).toBe(true);
    expect(second.full).toBe(false);
    expect(second.upserted).toBe(1);

    const row = await prisma.itopTicket.findUniqueOrThrow({ where: { ref: "R-004530" } });
    expect(row.status).toBe("resolved");
  });

  it("leaving ItopConfig at UTC against a Paris-zoned install reproduces the 2h skew (documents the misconfiguration)", async () => {
    const state = seedFakeItop();
    state.timezone = "Europe/Paris";
    const ticket = [...state.tickets.values()].find((t) => t.ref === "R-004512")!;
    ticket.start_date = "2026-07-01 14:00:00"; // Paris CEST (+2) -> real instant 12:00Z

    const { baseUrl } = await startFake(state);
    // Deliberately LEFT at the UTC default even though the fake (like the
    // real reference install) is actually Europe/Paris.
    await configureItop(baseUrl, FAKE_ITOP_TOKENS.app, "UTC");
    await createMappedCustomer(1, "Northwind Freight Sdn Bhd");
    await createMappedCustomer(2, "PT Sinar Logistik");

    await syncTickets({ full: true });

    const row = await prisma.itopTicket.findUniqueOrThrow({ where: { ref: "R-004512" } });
    // Misread as if the wall-clock digits were already UTC: 2h AHEAD of the
    // real instant (12:00Z) — exactly the bug this task fixes when the
    // admin sets the zone correctly instead.
    expect(row.startDate?.toISOString()).toBe("2026-07-01T14:00:00.000Z");
    expect(row.startDate?.toISOString()).not.toBe("2026-07-01T12:00:00.000Z");
  });
});

describe("resilience to an invalid stored ItopConfig.timezone", () => {
  // configureItop writes the timezone column directly, bypassing PATCH
  // /admin/itop/settings's own isValidTimeZone check — simulates a stored
  // value going bad some other way (a direct column edit, a Node/ICU
  // version dropping a zone name) rather than exercising the admin route.
  it("syncTickets falls back to UTC and still completes instead of aborting the whole tick", async () => {
    const state = seedFakeItop();
    const { baseUrl } = await startFake(state);
    await configureItop(baseUrl, FAKE_ITOP_TOKENS.app, "Not/AZone");
    await createMappedCustomer(1, "Northwind Freight Sdn Bhd");
    await createMappedCustomer(2, "PT Sinar Logistik");

    const summary = await syncTickets({ full: true });

    expect(summary.ran).toBe(true);
    expect(summary.error).toBeUndefined();
    expect(summary.upserted).toBeGreaterThan(0);

    // Fallen back to UTC, not crashed — the fake itself defaults to UTC
    // (state.timezone left unset), so a correct UTC fallback round-trips
    // its seeded dates exactly.
    const ticket = [...state.tickets.values()].find((t) => t.ref === "R-004512")!;
    const row = await prisma.itopTicket.findUniqueOrThrow({ where: { ref: "R-004512" } });
    expect(row.startDate?.toISOString()).toBe(parseFakeDate(ticket.start_date).toISOString());
  });

  it("syncTimeEntries falls back to UTC and still completes instead of aborting the whole pass", async () => {
    const state = seedFakeItop();
    const { baseUrl } = await startFake(state);
    await configureItop(baseUrl, FAKE_ITOP_TOKENS.app, "Not/AZone");

    const userA = await createUserWithRole("TAM");
    await prisma.user.update({ where: { id: userA.userId }, data: { email: "rina.s@example.co.id" } });
    await syncUsers();

    const summary = await syncTimeEntries({ full: true });

    expect(summary.ran).toBe(true);
    expect(summary.error).toBeUndefined();
    expect(summary.upserted).toBeGreaterThan(0);
  });
});

describe("syncUsers", () => {
  it("maps a user whose email matches a seeded Person (and its User), leaves an unmatched user null", async () => {
    const state = seedFakeItop();
    const { baseUrl } = await startFake(state);
    await configureItop(baseUrl, FAKE_ITOP_TOKENS.app);

    const matched = await createUserWithRole("TAM");
    const unmatched = await createUserWithRole("TAM");
    await prisma.user.update({ where: { id: matched.userId }, data: { email: "rina.s@example.co.id" } });
    await prisma.user.update({ where: { id: unmatched.userId }, data: { email: "no-such-person@example.co.id" } });

    await syncUsers();

    const matchedRow = await prisma.user.findUniqueOrThrow({ where: { id: matched.userId } });
    expect(matchedRow.itopPersonId).toBe(1);
    expect(matchedRow.itopUserId).toBe(1);

    const unmatchedRow = await prisma.user.findUniqueOrThrow({ where: { id: unmatched.userId } });
    expect(unmatchedRow.itopPersonId).toBeNull();
    expect(unmatchedRow.itopUserId).toBeNull();
  });

  it("does not clear an existing mapping when the iTop lookup itself fails", async () => {
    const state = seedFakeItop();
    const { baseUrl } = await startFake(state);
    await configureItop(baseUrl, FAKE_ITOP_TOKENS.app);

    const user = await createUserWithRole("TAM");
    await prisma.user.update({
      where: { id: user.userId },
      data: { email: "rina.s@example.co.id", itopPersonId: 999, itopUserId: 999 },
    });

    // Reconfigure with a bad token so the Person lookup call itself errors.
    await configureItop(baseUrl, "not-a-real-token");
    await syncUsers();

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.userId } });
    expect(row.itopPersonId).toBe(999);
    expect(row.itopUserId).toBe(999);
  });

  it("clears itopUserId (not just itopPersonId) once a previously-matched user's Person disappears from iTop", async () => {
    const state = seedFakeItop();
    const { baseUrl } = await startFake(state);
    await configureItop(baseUrl, FAKE_ITOP_TOKENS.app);

    const user = await createUserWithRole("TAM");
    await prisma.user.update({ where: { id: user.userId }, data: { email: "rina.s@example.co.id" } });

    await syncUsers();
    const mapped = await prisma.user.findUniqueOrThrow({ where: { id: user.userId } });
    expect(mapped.itopPersonId).toBe(1);
    expect(mapped.itopUserId).toBe(1);

    // The Person this user matched is gone from iTop — the lookup still
    // succeeds (unlike the "lookup itself fails" test above), it just no
    // longer returns this email. Regression: this used to leave the stale
    // itopUserId untouched because the second pass only revisits users who
    // still matched a Person this run.
    state.persons.delete(1);

    await syncUsers();

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.userId } });
    expect(row.itopPersonId).toBeNull();
    expect(row.itopUserId).toBeNull();
  });
});

describe("syncTimeEntries", () => {
  it("first pull sets userId/customerId/ticketId when mapped, and null for an org-less entry", async () => {
    const state = seedFakeItop();
    const { baseUrl } = await startFake(state);
    await configureItop(baseUrl, FAKE_ITOP_TOKENS.app);

    const customer1 = await createMappedCustomer(1, "Northwind Freight Sdn Bhd");
    await createMappedCustomer(2, "PT Sinar Logistik");

    const userA = await createUserWithRole("TAM");
    await prisma.user.update({ where: { id: userA.userId }, data: { email: "rina.s@example.co.id" } });
    await syncUsers();
    const mapped = await prisma.user.findUniqueOrThrow({ where: { id: userA.userId } });
    expect(mapped.itopUserId).toBe(1);

    // A snapshot ticket for the ref some of Rina's TimeSpent rows point at,
    // so the ref -> ItopTicket lookup has something to find — independent
    // of running a full ticket sync in this test.
    const ticket = await prisma.itopTicket.create({
      data: {
        id: 900001,
        class: "Incident",
        ref: "R-004512",
        title: "Branch 5 VPN tunnel flapping",
        status: "assigned",
        orgId: 1,
        customerId: customer1,
        lastUpdate: new Date(),
        syncedAt: new Date(),
      },
    });

    const summary = await syncTimeEntries({ full: true });
    expect(summary.ran).toBe(true);
    expect(summary.error).toBeUndefined();
    // Rina (itopUserId 1) has 7 seeded rows within the 8-week pull window;
    // Dedi and Budi are not mapped to any active Solvro user in this test.
    expect(summary.upserted).toBe(7);

    const rows = await prisma.itopTimeEntry.findMany({ where: { itopUserId: 1 } });
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.userId === userA.userId)).toBe(true);

    const withOrg = rows.filter((r) => r.orgId === 1);
    expect(withOrg.length).toBeGreaterThan(0);
    expect(withOrg.every((r) => r.customerId === customer1)).toBe(true);

    // The seeded org_id: 0 row ("no organization" in iTop) must land with
    // both orgId and customerId null — the Utilization "No customer" row.
    const orgless = rows.filter((r) => r.orgId === null);
    expect(orgless.length).toBeGreaterThan(0);
    expect(orgless.every((r) => r.customerId === null)).toBe(true);
    expect(orgless.every((r) => r.ticketId === null)).toBe(true);

    const withTicket = rows.find((r) => r.ticketRef === "R-004512");
    expect(withTicket?.ticketId).toBe(ticket.id);

    // Dedi and Budi are not mapped — their TimeSpent rows never land.
    const unmapped = await prisma.itopTimeEntry.findMany({ where: { itopUserId: { in: [2, 3] } } });
    expect(unmapped).toHaveLength(0);
  });

  it("converts iTop's TimeSpent.duration from seconds to whole minutes", async () => {
    const state = seedFakeItop();
    const { baseUrl } = await startFake(state);
    await configureItop(baseUrl, FAKE_ITOP_TOKENS.app);

    const userA = await createUserWithRole("TAM");
    await prisma.user.update({ where: { id: userA.userId }, data: { email: "rina.s@example.co.id" } });
    await syncUsers();

    await syncTimeEntries({ full: true });

    // The fixture's two Rina/R-004512 rows are seeded as 5400s and 3000s
    // (90 and 50 minutes) — asserting the stored values are minutes, not
    // the raw seconds iTop returns, is what actually exercises the
    // conversion (a no-op conversion would leave 5400/3000 here instead).
    const rows = await prisma.itopTimeEntry.findMany({
      where: { itopUserId: 1, ticketRef: "R-004512" },
      orderBy: { durationMinutes: "asc" },
    });
    expect(rows.map((r) => r.durationMinutes)).toEqual([50, 90]);
  });

  it("skips a TimeSpent row without a parseable start_date instead of inventing one, and the run still succeeds", async () => {
    const state = seedFakeItop();
    const { baseUrl } = await startFake(state);
    await configureItop(baseUrl, "app-token-readonly");

    const userA = await createUserWithRole("TAM");
    await prisma.user.update({ where: { id: userA.userId }, data: { email: "rina.s@example.co.id" } });
    await syncUsers();

    const badId = state.nextId++;
    state.timeSpent.set(badId, {
      id: badId,
      user_id: "1",
      org_id: "1",
      // Not empty: the fake applies the sync's `start_date >= cutoff` filter
      // as a string comparison, so an empty value would never be returned at
      // all. "z-..." sorts after any cutoff (the row IS returned) and still
      // fails parseItopDate's strict shape check.
      start_date: "z-not-a-date",
      end_date: "",
      duration: "3600",
      title: "no start date",
      ticketRef: "R-004512",
    });

    const result = await syncTimeEntries({ full: true });
    expect(result.error).toBeUndefined();
    expect(result.ran).toBe(true);
    expect(await prisma.itopTimeEntry.findUnique({ where: { id: badId } })).toBeNull();
    // A start-date skip counts in `skipped`, same as a row that throws.
    expect(result.skipped).toBe(1);
    // Rina's well-formed fixture rows still land.
    expect(await prisma.itopTimeEntry.count({ where: { itopUserId: 1 } })).toBeGreaterThan(0);
  });

  it("a TimeSpent row that throws on upsert (an out-of-range duration) is counted in skipped, and a previously stored copy survives the full-sync prune", async () => {
    const state = seedFakeItop();
    const { baseUrl } = await startFake(state);
    await configureItop(baseUrl, "app-token-readonly");

    const userA = await createUserWithRole("TAM");
    await prisma.user.update({ where: { id: userA.userId }, data: { email: "rina.s@example.co.id" } });
    await syncUsers();

    const first = await syncTimeEntries({ full: true });
    expect(first.error).toBeUndefined();
    expect(first.skipped).toBe(0);

    // The Rina/90-minute fixture row (unique duration among the seeds).
    const [targetId, target] = [...state.timeSpent.entries()].find(([, e]) => e.duration === String(90 * 60))!;
    const stored = await prisma.itopTimeEntry.findUniqueOrThrow({ where: { id: targetId } });

    // iTop now returns that same row with a duration whose minute count
    // overflows the integer column: the upsert itself throws (a garbage
    // user_id can't be used here — the fake's `user_id IN (...)` filter would
    // simply not return the row), the loop counts it in `skipped` and carries on.
    target.duration = "9999999999999";

    const second = await syncTimeEntries({ full: true });
    expect(second.ran).toBe(true);
    expect(second.error).toBeUndefined();
    expect(second.skipped).toBe(1);

    // The row is still in seenIds, so the full-sync prune must not delete the
    // copy stored from the earlier, valid response — and must not rewrite it.
    const after = await prisma.itopTimeEntry.findUnique({ where: { id: targetId } });
    expect(after).not.toBeNull();
    expect(after!.itopUserId).toBe(stored.itopUserId);
    expect(after!.durationMinutes).toBe(stored.durationMinutes);
    expect(second.removed).toBe(0);
  });

  it("a full sync drops an entry iTop no longer returns, within the pull window", async () => {
    const state = seedFakeItop();
    const { baseUrl } = await startFake(state);
    await configureItop(baseUrl, FAKE_ITOP_TOKENS.app);

    const userA = await createUserWithRole("TAM");
    await prisma.user.update({ where: { id: userA.userId }, data: { email: "rina.s@example.co.id" } });
    await syncUsers();

    await syncTimeEntries({ full: true });
    const before = await prisma.itopTimeEntry.count({ where: { itopUserId: 1 } });
    expect(before).toBeGreaterThan(0);

    // The Rina/R-004512/90-minute row, identified by its otherwise-unique
    // duration among this fixture's seeds.
    const [deletedId] = [...state.timeSpent.entries()].find(([, e]) => e.duration === String(90 * 60))!;
    state.timeSpent.delete(deletedId);

    const summary = await syncTimeEntries({ full: true });
    expect(summary.ran).toBe(true);
    expect(summary.error).toBeUndefined();
    expect(summary.removed).toBeGreaterThanOrEqual(1);

    const after = await prisma.itopTimeEntry.count({ where: { itopUserId: 1 } });
    expect(after).toBe(before - 1);
  });

  it("dropping a user's iTop mapping removes their in-window entries on the next full sync, but never touches history older than the pull window", async () => {
    const state = seedFakeItop();
    const { baseUrl } = await startFake(state);
    await configureItop(baseUrl, FAKE_ITOP_TOKENS.app);

    const userB = await createUserWithRole("TAM");
    await prisma.user.update({ where: { id: userB.userId }, data: { email: "dedi.p@example.co.id" } });
    await syncUsers();
    const mapped = await prisma.user.findUniqueOrThrow({ where: { id: userB.userId } });
    expect(mapped.itopUserId).toBe(2);

    await syncTimeEntries({ full: true });
    const before = await prisma.itopTimeEntry.count({ where: { itopUserId: 2 } });
    expect(before).toBeGreaterThan(0);

    // A leftover row from further back than the 8-week pull window — never
    // re-fetchable, so an unmap (or any other full-sync cleanup) must leave
    // it alone rather than deleting history that can't be restored.
    const outOfWindowStart = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    await prisma.itopTimeEntry.create({
      data: {
        id: 999999,
        itopUserId: 2,
        userId: userB.userId,
        startDate: outOfWindowStart,
        durationMinutes: 42,
        syncedAt: outOfWindowStart,
      },
    });

    // Simulates the mapping being dropped directly, independent of
    // syncUsers (whose own email-mismatch -> itopUserId transition is
    // exercised separately in the "syncUsers" describe block above) — this
    // test is only about syncTimeEntries's own cleanup once itopUserId is
    // no longer mapped.
    await prisma.user.update({ where: { id: userB.userId }, data: { itopUserId: null } });

    const summary = await syncTimeEntries({ full: true });
    expect(summary.removed).toBeGreaterThanOrEqual(before);

    const after = await prisma.itopTimeEntry.findMany({ where: { itopUserId: 2 } });
    expect(after).toHaveLength(1);
    expect(after[0]?.id).toBe(999999);
  });

  it("does NOT delete a boundary entry within the 14h grace margin of the fetch cutoff, even when iTop didn't return it this tick", async () => {
    const state = seedFakeItop();
    const { baseUrl } = await startFake(state);
    await configureItop(baseUrl, FAKE_ITOP_TOKENS.app);

    const userA = await createUserWithRole("TAM");
    await prisma.user.update({ where: { id: userA.userId }, data: { email: "rina.s@example.co.id" } });
    await syncUsers();
    await syncTimeEntries({ full: true });

    // Fabricated directly in Postgres (never in the fake's own TimeSpent
    // map, so it can never land in `seenIds`) at 1h past the fetch cutoff —
    // well inside the 14h grace margin meant to absorb a zone/DST-driven
    // boundary disagreement between our cutoff string and iTop's own
    // comparison, which is exactly what this row simulates: a real,
    // still-current row that iTop simply didn't hand back this particular
    // tick, not one it has actually deleted.
    const cutoff = new Date(Date.now() - TIME_ENTRY_WINDOW_MS);
    const boundaryStart = new Date(cutoff.getTime() + 60 * 60 * 1000);
    await prisma.itopTimeEntry.create({
      data: {
        id: 888888,
        itopUserId: 1,
        userId: userA.userId,
        startDate: boundaryStart,
        durationMinutes: 30,
        syncedAt: boundaryStart,
      },
    });

    await syncTimeEntries({ full: true });

    const row = await prisma.itopTimeEntry.findUnique({ where: { id: 888888 } });
    expect(row).not.toBeNull();
  });

  it("still deletes a genuinely-gone entry once its startDate is past the 14h grace margin", async () => {
    const state = seedFakeItop();
    const { baseUrl } = await startFake(state);
    await configureItop(baseUrl, FAKE_ITOP_TOKENS.app);

    const userA = await createUserWithRole("TAM");
    await prisma.user.update({ where: { id: userA.userId }, data: { email: "rina.s@example.co.id" } });
    await syncUsers();
    await syncTimeEntries({ full: true });

    // Same setup as the grace-margin test above, but 15h past the fetch
    // cutoff — outside the 14h margin, so the existing "iTop no longer
    // returns this" cleanup still applies.
    const cutoff = new Date(Date.now() - TIME_ENTRY_WINDOW_MS);
    const pastGraceStart = new Date(cutoff.getTime() + 15 * 60 * 60 * 1000);
    await prisma.itopTimeEntry.create({
      data: {
        id: 777777,
        itopUserId: 1,
        userId: userA.userId,
        startDate: pastGraceStart,
        durationMinutes: 30,
        syncedAt: pastGraceStart,
      },
    });

    await syncTimeEntries({ full: true });

    const row = await prisma.itopTimeEntry.findUnique({ where: { id: 777777 } });
    expect(row).toBeNull();
  });

  it("is a no-op when iTop is not configured", async () => {
    const summary = await syncTimeEntries({ full: true });
    expect(summary.ran).toBe(false);
    expect(summary.upserted).toBe(0);
    expect(summary.removed).toBe(0);
  });
});

describe("syncTickets + syncTimeEntries combined", () => {
  it("syncTickets's full pass also syncs time entries and reports their counts on SyncSummary", async () => {
    const state = seedFakeItop();
    const { baseUrl } = await startFake(state);
    await configureItop(baseUrl, FAKE_ITOP_TOKENS.app);
    await createMappedCustomer(1, "Northwind Freight Sdn Bhd");
    await createMappedCustomer(2, "PT Sinar Logistik");

    const userA = await createUserWithRole("TAM");
    await prisma.user.update({ where: { id: userA.userId }, data: { email: "rina.s@example.co.id" } });

    const summary = await syncTickets({ full: true });
    expect(summary.ran).toBe(true);
    expect(summary.error).toBeUndefined();
    // Tickets still sync as before this task (existing scenarios above cover
    // that in detail) — this asserts the combined tick's new half.
    expect(summary.upserted).toBeGreaterThan(0);
    expect(summary.timeEntriesUpserted).toBeGreaterThan(0);

    const rows = await prisma.itopTimeEntry.count({ where: { itopUserId: 1 } });
    expect(rows).toBe(summary.timeEntriesUpserted);
  });
});

describe("parseItopDate", () => {
  it("treats the empty-date sentinel and blank strings as null", () => {
    expect(parseItopDate("0000-00-00 00:00:00", "UTC")).toBeNull();
    expect(parseItopDate("", "UTC")).toBeNull();
    expect(parseItopDate(undefined, "UTC")).toBeNull();
    expect(parseItopDate(null, "UTC")).toBeNull();
  });

  it("parses a well-formed iTop datetime as UTC", () => {
    const parsed = parseItopDate("2026-03-14 09:30:00", "UTC");
    expect(parsed).not.toBeNull();
    expect(parsed!.toISOString()).toBe("2026-03-14T09:30:00.000Z");
  });

  it("returns null for a value that doesn't match the expected shape", () => {
    expect(parseItopDate("3600", "UTC")).toBeNull();
  });

  it("returns null for a JSON number instead of throwing — the exact shape that used to crash sync (`value.trim is not a function`)", () => {
    expect(parseItopDate(182 as unknown, "UTC")).toBeNull();
  });

  it("returns null for any other non-string garbage without throwing", () => {
    expect(parseItopDate({} as unknown, "UTC")).toBeNull();
    expect(parseItopDate([] as unknown, "UTC")).toBeNull();
    expect(parseItopDate(true as unknown, "UTC")).toBeNull();
  });
});

describe("parseItopBoolean", () => {
  it("accepts iTop's yes/no and 1/0 string shapes, case-insensitively", () => {
    expect(parseItopBoolean("yes")).toBe(true);
    expect(parseItopBoolean("YES")).toBe(true);
    expect(parseItopBoolean("1")).toBe(true);
    expect(parseItopBoolean("true")).toBe(true);
    expect(parseItopBoolean("no")).toBe(false);
    expect(parseItopBoolean("0")).toBe(false);
    expect(parseItopBoolean("")).toBe(false);
  });

  it("returns false for a number, an object, or a missing value, rather than throwing", () => {
    expect(parseItopBoolean(1 as unknown)).toBe(false);
    expect(parseItopBoolean(true as unknown)).toBe(false);
    expect(parseItopBoolean({} as unknown)).toBe(false);
    expect(parseItopBoolean(null)).toBe(false);
    expect(parseItopBoolean(undefined)).toBe(false);
  });
});

describe("parseItopInt", () => {
  it("accepts a JSON integer or a plain decimal integer string, including negative and surrounding whitespace", () => {
    expect(parseItopInt(42)).toBe(42);
    expect(parseItopInt("42")).toBe(42);
    expect(parseItopInt("-7")).toBe(-7);
    expect(parseItopInt("  42  ")).toBe(42);
  });

  it("rejects non-integer numbers and non-plain-integer numeric-looking strings", () => {
    expect(parseItopInt(1.5)).toBeNull();
    expect(parseItopInt("1.5")).toBeNull();
    expect(parseItopInt("0x10")).toBeNull(); // Number("0x10") === 16 — deliberately still rejected
    expect(parseItopInt("1e3")).toBeNull(); // Number("1e3") === 1000 — deliberately still rejected
  });

  it("returns null for a missing/garbage value without throwing", () => {
    expect(parseItopInt(undefined)).toBeNull();
    expect(parseItopInt(null)).toBeNull();
    expect(parseItopInt({})).toBeNull();
    expect(parseItopInt("")).toBeNull();
    expect(parseItopInt(Number.NaN)).toBeNull();
  });
});
