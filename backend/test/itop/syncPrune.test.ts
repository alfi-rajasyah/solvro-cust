// The full-sync prune compares `syncedAt` against the run's start instead of
// binding one parameter per returned id, and skips the "not returned" arm when
// the pull was partial (a server that ignores `page`).
import "../env.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import http, { type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { prisma } from "../../src/prisma.js";
import { seal } from "../../src/lib/secretBox.js";
import { bustItopConfigCache } from "../../src/lib/itop/config.js";
import { formatItopDate, syncTickets, syncTimeEntries, syncUsers } from "../../src/lib/itop/sync.js";
import { seedRoles, createUserWithRole } from "../testAuth.js";
import { createFakeItop, seedFakeItop, type FakeItopState, type TicketRecord, FAKE_ITOP_TOKENS } from "./fakeItop.js";

const servers: Server[] = [];

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

async function startFake(state: FakeItopState): Promise<string> {
  const { listen } = createFakeItop(state);
  const { server, baseUrl } = await listen(0);
  servers.push(server);
  return baseUrl;
}

/** Forwards to the fake but drops `page` from every request, like an iTop that ignores paging. */
async function startPageIgnoringProxy(targetBaseUrl: string): Promise<string> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      void (async () => {
        const form = new URLSearchParams(Buffer.concat(chunks).toString());
        const payload = JSON.parse(form.get("json_data") ?? "{}") as Record<string, unknown>;
        delete payload.page;
        const upstream = await fetch(`${targetBaseUrl}/webservices/rest.php?version=1.3`, {
          method: "POST",
          headers: { "Auth-Token": String(req.headers["auth-token"] ?? ""), "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ json_data: JSON.stringify(payload) }).toString(),
        });
        res.statusCode = upstream.status;
        res.setHeader("Content-Type", "application/json");
        res.end(await upstream.text());
      })();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function configureItop(baseUrl: string): Promise<void> {
  await prisma.itopConfig.upsert({
    where: { id: "default" },
    create: { id: "default", baseUrl, appTokenEnc: seal(FAKE_ITOP_TOKENS.app) },
    update: { baseUrl, appTokenEnc: seal(FAKE_ITOP_TOKENS.app), lastSyncAt: null, lastFullSyncAt: null },
  });
  bustItopConfigCache();
}

function ticket(id: number): TicketRecord {
  return {
    id,
    class: "UserRequest",
    ref: `R-PRUNE-${id}`,
    title: `Prune ${id}`,
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
  };
}

beforeAll(async () => {
  await seedRoles();
});

beforeEach(async () => {
  await prisma.itopTimeEntry.deleteMany();
  await prisma.itopTicket.deleteMany();
  await prisma.customer.deleteMany({ where: { itopOrgId: { not: null } } });
  await prisma.user.deleteMany({ where: { email: { in: ["rina.s@example.co.id"] } } });
  await prisma.itopConfig.deleteMany({ where: { id: "default" } });
  bustItopConfigCache();
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const s of servers.splice(0)) await closeServer(s);
});

async function mapCustomer(): Promise<void> {
  await prisma.customer.create({
    data: { name: `Prune customer ${Date.now()}-${Math.random()}`, description: "", itopOrgId: 1, itopOrgName: "Northwind Freight Sdn Bhd" },
  });
}

describe("full-sync prune", () => {
  it("prunes tickets by syncedAt, never by an id list", async () => {
    const state = seedFakeItop();
    await configureItop(await startFake(state));
    await mapCustomer();
    await syncTickets({ full: true });

    const [goneId] = [...state.tickets.entries()].find(([, t]) => t.ref === "R-004512")!;
    state.tickets.delete(goneId);

    const spy = vi.spyOn(prisma.itopTicket, "deleteMany");
    const summary = await syncTickets({ full: true });
    expect(summary.removed).toBeGreaterThanOrEqual(1);
    expect(await prisma.itopTicket.findUnique({ where: { ref: "R-004512" } })).toBeNull();

    // No clause lists ticket ids, so the bind-parameter count cannot grow with the pull.
    const where = JSON.stringify(spy.mock.calls[0][0]?.where);
    expect(where).not.toMatch(/"id":\{"notIn"/);
    expect(where).toContain("syncedAt");
  });

  it("prunes time entries by syncedAt, never by an id list", async () => {
    const state = seedFakeItop();
    await configureItop(await startFake(state));
    const user = await createUserWithRole("TAM");
    await prisma.user.update({ where: { id: user.userId }, data: { email: "rina.s@example.co.id" } });
    await syncUsers();
    await syncTimeEntries({ full: true });

    const [goneId] = [...state.timeSpent.entries()].find(([, e]) => e.duration === String(90 * 60))!;
    state.timeSpent.delete(goneId);

    const spy = vi.spyOn(prisma.itopTimeEntry, "deleteMany");
    const summary = await syncTimeEntries({ full: true });
    expect(summary.removed).toBeGreaterThanOrEqual(1);
    expect(await prisma.itopTimeEntry.findUnique({ where: { id: goneId } })).toBeNull();

    const where = JSON.stringify(spy.mock.calls[0][0]?.where);
    expect(where).not.toMatch(/"id":\{"notIn"/);
    expect(where).toContain("syncedAt");
  });

  it("keeps stored tickets when the server ignores paging and the pull is partial", async () => {
    const state = seedFakeItop();
    for (let i = 0; i < 150; i += 1) {
      const id = state.nextId++;
      state.tickets.set(id, ticket(id));
    }
    const directUrl = await startFake(state);
    await configureItop(directUrl);
    await mapCustomer();
    const first = await syncTickets({ full: true });
    expect(first.error).toBeUndefined();
    const stored = await prisma.itopTicket.count();
    expect(stored).toBeGreaterThan(150);

    await configureItop(await startPageIgnoringProxy(directUrl));
    const second = await syncTickets({ full: true });
    expect(second.error).toBeUndefined();
    expect(second.removed).toBe(0);
    expect(await prisma.itopTicket.count()).toBe(stored);
  });

  it("keeps stored time entries when the server ignores paging and the pull is partial", async () => {
    const state = seedFakeItop();
    const recent = formatItopDate(new Date(Date.now() - 3600_000), "UTC");
    for (let i = 0; i < 150; i += 1) {
      const id = state.nextId++;
      state.timeSpent.set(id, {
        id,
        user_id: "1",
        org_id: "1",
        start_date: recent,
        end_date: recent,
        duration: "600",
        title: `Prune ${id}`,
        ticketRef: "",
      });
    }
    const directUrl = await startFake(state);
    await configureItop(directUrl);
    const user = await createUserWithRole("TAM");
    await prisma.user.update({ where: { id: user.userId }, data: { email: "rina.s@example.co.id" } });
    await syncUsers();
    await syncTimeEntries({ full: true });
    const stored = await prisma.itopTimeEntry.count();
    expect(stored).toBeGreaterThan(150);

    await configureItop(await startPageIgnoringProxy(directUrl));
    const second = await syncTimeEntries({ full: true });
    expect(second.error).toBeUndefined();
    expect(second.removed).toBe(0);
    expect(await prisma.itopTimeEntry.count()).toBe(stored);
  });
});
