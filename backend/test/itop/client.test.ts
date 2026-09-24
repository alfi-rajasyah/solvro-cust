// Exercises backend/src/lib/itop/client.ts against the in-memory fake iTop
// (fakeItop.ts) for protocol-level behaviour (paging, iTop error mapping,
// probe()), and against a mocked fetchImpl for pure-transport failures
// (HTTP status, timeout) and outgoing request shape. No database needed;
// the suite's global DB setup still runs (backend/CLAUDE.md), which is fine.
import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createItopClient } from "../../src/lib/itop/client.js";
import type { ItopTicketFields } from "../../src/lib/itop/types.js";
import { createEmptyState, createFakeItop, seedFakeItop, type FakeItopState, type TicketRecord, FAKE_ITOP_TOKENS } from "./fakeItop.js";

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

function makeTicket(id: number): TicketRecord {
  return {
    id,
    class: "UserRequest",
    ref: `R-${String(id).padStart(6, "0")}`,
    title: `Ticket ${id}`,
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

describe("createItopClient against the fake iTop", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await closeServer(server);
      server = undefined;
    }
  });

  it("getAll pages through 250 seeded tickets", async () => {
    const state = createEmptyState();
    state.tokens.set("token", { valid: true, canWrite: false });
    for (let i = 1; i <= 250; i++) {
      state.tickets.set(i, makeTicket(i));
    }
    const started = await startFake(state);
    server = started.server;

    const client = createItopClient({ baseUrl: started.baseUrl, token: "token" });

    // Sanity: an unpaged get (no limit) returns every row too.
    const all = await client.get<ItopTicketFields>("UserRequest", "SELECT UserRequest", "ref");
    expect(all.objects).toHaveLength(250);

    const paged = await client.getAll<ItopTicketFields>("UserRequest", "SELECT UserRequest", "ref", {
      pageSize: 40,
    });
    expect(paged.objects).toHaveLength(250);
    const refs = new Set(paged.objects.map((row) => row.fields.ref));
    expect(refs.size).toBe(250);
  });

  it("getAll pages exactly when the row count is a multiple of pageSize (100 rows, pageSize 50)", async () => {
    const state = createEmptyState();
    state.tokens.set("token", { valid: true, canWrite: false });
    for (let i = 1; i <= 100; i++) {
      state.tickets.set(i, makeTicket(i));
    }
    const started = await startFake(state);
    server = started.server;

    const client = createItopClient({ baseUrl: started.baseUrl, token: "token" });
    const paged = await client.getAll<ItopTicketFields>("UserRequest", "SELECT UserRequest", "ref", {
      pageSize: 50,
    });

    expect(paged.objects).toHaveLength(100);
    expect(new Set(paged.objects.map((row) => row.fields.ref)).size).toBe(100);
  });

  it("returns an empty result (not a crash) for an OQL condition that matches nothing", async () => {
    const state = createEmptyState();
    state.tokens.set("token", { valid: true, canWrite: false });
    state.tickets.set(1, makeTicket(1));
    const started = await startFake(state);
    server = started.server;

    const client = createItopClient({ baseUrl: started.baseUrl, token: "token" });

    const direct = await client.get<ItopTicketFields>(
      "UserRequest",
      "SELECT UserRequest WHERE ref = 'DOES-NOT-EXIST'",
      "ref",
    );
    expect(direct.objects).toEqual([]);

    const all = await client.getAll<ItopTicketFields>(
      "UserRequest",
      "SELECT UserRequest WHERE ref = 'DOES-NOT-EXIST'",
      "ref",
      { pageSize: 40 },
    );
    expect(all.objects).toEqual([]);
  });

  it("maps a bad token to ItopError with iTop's message preserved verbatim", async () => {
    const state = createEmptyState();
    const started = await startFake(state);
    server = started.server;

    const client = createItopClient({ baseUrl: started.baseUrl, token: "not-a-real-token" });
    await expect(client.get("Organization", 1, "id")).rejects.toMatchObject({
      code: 1,
      message: "Error: Invalid login",
    });
  });

  it("probe() never throws, returns 6 entries, and reports a disabled class as failing", async () => {
    const state = seedFakeItop();
    state.disabledClasses.add("TimeSpent");
    const started = await startFake(state);
    server = started.server;

    const client = createItopClient({ baseUrl: started.baseUrl, token: FAKE_ITOP_TOKENS.app });
    const results = await client.probe();

    expect(results).toHaveLength(6);
    expect(results.map((r) => r.name)).toEqual([
      "list_operations",
      "Organization",
      "UserRequest",
      "Incident",
      "Person",
      "TimeSpent",
    ]);

    const timeSpent = results.find((r) => r.name === "TimeSpent");
    expect(timeSpent?.ok).toBe(false);
    expect(timeSpent?.message).toContain("TimeSpent");

    expect(results.filter((r) => r.name !== "TimeSpent").every((r) => r.ok)).toBe(true);
  });
});

describe("createItopClient transport errors and request shape (mocked fetchImpl)", () => {
  it("maps a non-2xx HTTP response to ItopError code 'http'", async () => {
    const fetchImpl = (async () =>
      new Response("Internal Server Error", { status: 500 })) as unknown as typeof fetch;

    const client = createItopClient({ baseUrl: "http://example.invalid", token: "x", fetchImpl });
    await expect(client.get("Organization", 1, "id")).rejects.toMatchObject({
      code: "http",
      status: 500,
    });
  });

  it("times out (code 'timeout') when fetchImpl never resolves", async () => {
    const fetchImpl = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;

    const client = createItopClient({
      baseUrl: "http://example.invalid",
      token: "x",
      fetchImpl,
      timeoutMs: 25,
    });
    await expect(client.get("Organization", 1, "id")).rejects.toMatchObject({ code: "timeout" });
  });

  it("throws code 'parse' when the response body is not valid JSON", async () => {
    const fetchImpl = (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch;

    const client = createItopClient({ baseUrl: "http://example.invalid", token: "x", fetchImpl });
    await expect(client.get("Organization", 1, "id")).rejects.toMatchObject({ code: "parse" });
  });

  it("stops re-fetching instead of looping forever when a server always returns the same page", async () => {
    let callCount = 0;
    const pageSize = 10;
    const fetchImpl = (async () => {
      callCount += 1;
      const objects: Record<string, unknown> = {};
      // Every call returns the exact same keys — as if the server ignores
      // the `page` parameter entirely.
      for (let i = 1; i <= pageSize; i++) {
        objects[`UserRequest::${i}`] = {
          code: 0,
          message: "",
          class: "UserRequest",
          key: String(i),
          fields: { ref: `R-${i}` },
        };
      }
      return new Response(JSON.stringify({ code: 0, message: "", objects }), { status: 200 });
    }) as unknown as typeof fetch;

    const client = createItopClient({ baseUrl: "http://example.invalid", token: "x", fetchImpl });
    const result = await client.getAll("UserRequest", "SELECT UserRequest", "ref", { pageSize });

    // Only the unique rows from the first page — the second page contributed
    // nothing new, so the loop stopped there instead of spinning toward the
    // 500-page ceiling.
    expect(result.objects).toHaveLength(pageSize);
    expect(callCount).toBe(2);
  });

  it("sends applyStimulus as a single urlencoded json_data field with the exact payload, defaulting comment when the caller doesn't pass one", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({ code: 0, message: "", objects: null }), { status: 200 });
    }) as unknown as typeof fetch;

    const client = createItopClient({ baseUrl: "http://example.invalid/", token: "tam-token", fetchImpl });
    await client.applyStimulus("UserRequest", 4530, "ev_resolve", {
      resolution_code: "assistance",
      solution: "Both users created in the Acronis console.",
    });

    expect(capturedUrl).toBe("http://example.invalid/webservices/rest.php?version=1.3");
    expect(capturedInit?.method).toBe("POST");

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["Auth-Token"]).toBe("tam-token");
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");

    const body = capturedInit?.body as string;
    const params = new URLSearchParams(body);
    const jsonData = params.get("json_data");
    expect(jsonData).toBeTruthy();
    // A real iTop 3.2.2 install refuses core/apply_stimulus outright with no
    // comment at all — the client must never omit it, even when the caller
    // doesn't pass one explicitly.
    expect(JSON.parse(jsonData as string)).toEqual({
      operation: "core/apply_stimulus",
      class: "UserRequest",
      key: 4530,
      stimulus: "ev_resolve",
      fields: {
        resolution_code: "assistance",
        solution: "Both users created in the Acronis console.",
      },
      comment: "Updated from Solvro",
    });
  });

  it("defaults update()'s comment the same way when the caller doesn't pass one", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return new Response(JSON.stringify({ code: 0, message: "", objects: null }), { status: 200 });
    }) as unknown as typeof fetch;

    const client = createItopClient({ baseUrl: "http://example.invalid/", token: "tam-token", fetchImpl });
    await client.update("UserRequest", 4530, { public_log: "hi" });

    const body = capturedInit?.body as string;
    const jsonData = new URLSearchParams(body).get("json_data");
    expect(JSON.parse(jsonData as string)).toMatchObject({ comment: "Updated from Solvro" });
  });
});

describe("fake iTop: comment enforcement on core/update and core/apply_stimulus", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await closeServer(server);
      server = undefined;
    }
  });

  /** Bypasses createItopClient (which now always attaches a comment) to exercise the fake's own protocol-level refusal directly, the way a caller sending a raw request with no `comment` field at all would hit it. */
  async function postRaw(baseUrl: string, token: string, payload: Record<string, unknown>) {
    const body = new URLSearchParams({ json_data: JSON.stringify(payload) }).toString();
    const response = await fetch(`${baseUrl}/webservices/rest.php?version=1.3`, {
      method: "POST",
      headers: { "Auth-Token": token, "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    return (await response.json()) as { code: number; message: string };
  }

  it("refuses core/apply_stimulus with the exact real message when comment is missing", async () => {
    const state = seedFakeItop();
    const started = await startFake(state);
    server = started.server;

    const result = await postRaw(started.baseUrl, FAKE_ITOP_TOKENS.rina, {
      operation: "core/apply_stimulus",
      class: "Incident",
      key: 1,
      stimulus: "ev_pending",
      fields: { pending_reason: "waiting" },
    });

    expect(result).toMatchObject({ code: 100, message: "Error: Missing parameter 'comment'" });
  });

  it("refuses core/update with the exact real message when comment is an empty string", async () => {
    const state = seedFakeItop();
    const started = await startFake(state);
    server = started.server;

    const result = await postRaw(started.baseUrl, FAKE_ITOP_TOKENS.rina, {
      operation: "core/update",
      class: "Incident",
      key: 1,
      fields: { public_log: "hello" },
      comment: "",
    });

    expect(result).toMatchObject({ code: 100, message: "Error: Missing parameter 'comment'" });
  });

  it("resolves an assigned ticket with only `solution` — resolution_code is optional at the iTop level", async () => {
    const state = seedFakeItop();
    const started = await startFake(state);
    server = started.server;

    const client = createItopClient({ baseUrl: started.baseUrl, token: FAKE_ITOP_TOKENS.rina });
    // R-004512 (ticket id 1 in the seed) is "assigned" to Rina.
    const result = await client.applyStimulus("Incident", 1, "ev_resolve", { solution: "Rebooted the tunnel." });

    expect(result?.fields).toMatchObject({ status: "resolved" });
  });
});
