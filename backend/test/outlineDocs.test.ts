// Outline Phase B, task B4 (docs/archive/plans/outline-integration.md): anchor
// parsing, the Docs-tab tree, templates, create-a-page and search - against the
// in-process Outline stub (test/outlineStub.ts). F6-F9, F11.
import "./env.js";
import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { seal } from "../src/lib/secretBox.js";
import { parseOutlineAnchor } from "../src/lib/outline/anchor.js";
import { parseSearchContext } from "../src/lib/outline/snippet.js";
import { clearOutlineTreeCache } from "../src/lib/outline/docs.js";
import { outlineCallbackRateLimiter } from "../src/routes/outline.js";
import { createUserWithRole, seedRoles } from "./testAuth.js";
import { startOutlineStub, type OutlineStub } from "./outlineStub.js";

const CLIENT_ID = "stub-client-id";
const CLIENT_SECRET = "stub-client-secret";
const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const uniq = (label: string) => `${label} ${Date.now()}-${Math.random()}`;

const COL_UUID = "11111111-1111-4111-8111-111111111111";
const DOC_UUID = "22222222-2222-4222-8222-222222222222";
const D1 = "33333333-3333-4333-8333-333333333331";
const D2 = "33333333-3333-4333-8333-333333333332";
const D3 = "33333333-3333-4333-8333-333333333333";
const OUTSIDE_PARENT = "44444444-4444-4444-8444-444444444444";
const TEMPLATE = "55555555-5555-4555-8555-555555555555";
const BODY = "CONFIDENTIAL PAGE BODY";

let stub: OutlineStub;

beforeAll(async () => {
  await seedRoles();
  stub = await startOutlineStub({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
});
afterAll(async () => {
  await stub.close();
});

beforeEach(async () => {
  stub.tokenRequests.length = 0;
  stub.revokeRequests.length = 0;
  stub.apiCalls.length = 0;
  stub.api = () => undefined;
  clearOutlineTreeCache();
  outlineCallbackRateLimiter.reset();
  await prisma.outlineOAuthState.deleteMany();
  await prisma.outlineConfig.deleteMany();
  await prisma.outlineConfig.create({
    data: { baseUrl: stub.url, oauthClientId: CLIENT_ID, oauthClientSecretEnc: seal(CLIENT_SECRET) },
  });
});

async function newUser(role = "TAM") {
  const u = await createUserWithRole(role);
  const row = await prisma.user.findUniqueOrThrow({ where: { id: u.userId } });
  return { ...u, email: row.email };
}

/** Connects a user through the real OAuth flow against the stub. */
async function connect(u: { token: string; userId: number; email: string }) {
  const start = await request(app).post("/outline/oauth/start").set(auth(u.token));
  const state = new URL(start.body.authorizeUrl as string).searchParams.get("state")!;
  const code = `code-${crypto.randomUUID()}`;
  stub.issueCode(code, { id: `ou-${u.userId}`, email: u.email });
  const res = await request(app).get(`/outline/oauth/callback?code=${code}&state=${state}`);
  expect(res.headers.location).toContain("outline=connected");
  stub.apiCalls.length = 0;
}

const collectionUrl = () => `${stub.url}/collection/northwind-freight-gtQE8nRes8`;
const docUrl = () => `${stub.url}/doc/core-banking-migration-LJlvGccdNz`;

/** A canned Outline: a collection/doc with a small tree, every page carrying secret `text`. */
function cannedOutline(overrides: Partial<Record<string, { status: number; body?: unknown }>> = {}) {
  stub.api = (method) => {
    const o = overrides[method];
    if (o) return o;
    switch (method) {
      case "collections.info":
        return { status: 200, body: { ok: true, data: { id: COL_UUID, name: "Northwind Freight", url: "/collection/northwind-freight-gtQE8nRes8", deletedAt: null, archivedAt: null, description: BODY } } };
      case "documents.info":
        return { status: 200, body: { ok: true, data: { id: DOC_UUID, title: "Core Banking Migration", url: "/doc/core-banking-migration-LJlvGccdNz", text: BODY, deletedAt: null, archivedAt: null } } };
      case "collections.documents":
        return { status: 200, body: { ok: true, data: [
          { id: D1, title: "Core Banking Migration", url: "/doc/core-banking-migration-LJlvGccdNz", text: BODY, children: [
            { id: D2, title: "Cut-over Runbook", url: "/doc/cut-over-runbook-PwbGa3vHJa", text: BODY, children: [] },
          ] },
          { id: D3, title: "Standalone", url: "/doc/standalone-aaaaaaaaaa", text: BODY, children: [] },
        ] } };
      case "documents.documents":
        // The real shape (Outline 1.10.1): the document itself as one node with children.
        return { status: 200, body: { ok: true, data:
          { id: DOC_UUID, title: "Core Banking Migration", url: "/doc/core-banking-migration-LJlvGccdNz", text: BODY, children: [
            { id: D2, title: "Cut-over Runbook", url: "/doc/cut-over-runbook-PwbGa3vHJa", text: BODY, children: [] },
          ] } } };
      case "documents.create":
        return { status: 200, body: { ok: true, data: { id: D3, title: "Meeting 1", url: "/doc/meeting-1-bbbbbbbbbb", text: BODY } } };
      case "templates.list":
        return { status: 200, body: { ok: true, data: [{ id: TEMPLATE, title: "Meeting notes", text: BODY, collectionId: null }, { bogus: true }] } };
      default:
        return undefined;
    }
  };
}

async function fixture(opts: { projectUrl?: string | null; customerUrl?: string | null } = {}) {
  const tam = await newUser("TAM");
  const customer = await prisma.customer.create({
    data: { name: uniq("Cust"), description: "d", tamId: tam.userId, outlineUrl: opts.customerUrl ?? null },
  });
  const project = await prisma.project.create({
    data: { name: uniq("Proj"), tamId: tam.userId, customerId: customer.id, status: "ACTIVE", outlineUrl: opts.projectUrl ?? null },
  });
  return { tam, customer, project };
}
const docsOf = (token: string, path: string) => request(app).get(path).set(auth(token));
const callsOf = (method: string) => stub.apiCalls.filter((c) => c.method === method);

describe("parseOutlineAnchor", () => {
  const base = "https://docs.example.com";
  it("reads doc and collection urlIds, with or without slug, sub-paths, query and fragment", () => {
    const ok = (url: string, kind: string, urlId: string) =>
      expect(parseOutlineAnchor(url, base)).toEqual({ ok: true, anchor: { kind, urlId } });
    ok(`${base}/doc/cut-over-runbook-PwbGa3vHJa`, "doc", "PwbGa3vHJa");
    ok(`${base}/doc/PwbGa3vHJa`, "doc", "PwbGa3vHJa");
    ok(`${base}/doc/cut-over-runbook-PwbGa3vHJa/edit?x=1#h`, "doc", "PwbGa3vHJa");
    ok(`${base}/collection/northwind-freight-gtQE8nRes8`, "collection", "gtQE8nRes8");
    ok(`${base}/collection/northwind-freight-gtQE8nRes8/recent`, "collection", "gtQE8nRes8");
    ok(`${base}/doc/9f1c1a52-7b3a-4c6f-8d1e-0123456789ab`, "doc", "9f1c1a52-7b3a-4c6f-8d1e-0123456789ab");
    ok(`${base}:443/doc/x-PwbGa3vHJa`, "doc", "PwbGa3vHJa"); // default port normalises
  });

  it("honours a path prefix on the Outline base URL", () => {
    expect(parseOutlineAnchor("https://acme.com/wiki/doc/a-PwbGa3vHJa", "https://acme.com/wiki")).toMatchObject({ ok: true });
    expect(parseOutlineAnchor("https://acme.com/other/doc/a-PwbGa3vHJa", "https://acme.com/wiki")).toEqual({ ok: false, reason: "outside" });
  });

  it("flags a foreign origin as outside, and unrecognised same-origin paths as unsupported", () => {
    expect(parseOutlineAnchor("https://evil.example/doc/a-PwbGa3vHJa", base)).toEqual({ ok: false, reason: "outside" });
    expect(parseOutlineAnchor("http://docs.example.com/doc/a-PwbGa3vHJa", base)).toEqual({ ok: false, reason: "outside" });
    expect(parseOutlineAnchor("https://docs.example.com.evil.example/doc/a-PwbGa3vHJa", base)).toEqual({ ok: false, reason: "outside" });
    for (const path of ["/", "/home", "/s/shareid123", "/doc", "/doc/short", "/search/x", "/collection/%E0%A4%A"]) {
      expect(parseOutlineAnchor(`${base}${path}`, base), path).toEqual({ ok: false, reason: "unsupported" });
    }
    expect(parseOutlineAnchor("not a url", base)).toEqual({ ok: false, reason: "outside" });
  });
});

describe("parseSearchContext", () => {
  it("splits on <b> only, merges runs, and decodes entities", () => {
    expect(parseSearchContext("Plan the <b>cut-over</b> &amp; <b>go</b>-live")).toEqual([
      { text: "Plan the ", highlight: false },
      { text: "cut-over", highlight: true },
      { text: " & ", highlight: false },
      { text: "go", highlight: true },
      { text: "-live", highlight: false },
    ]);
  });

  it("never lets other tags through: nested, injected, script/style, attributes", () => {
    const segs = parseSearchContext('<b><script>alert(1)</script>hit</b> <img src=x onerror=alert(2)> a<i>b</i> <style>p{}</style><B class="x">up</B>');
    expect(segs).toEqual([
      { text: "hit", highlight: true },
      { text: "  ab ", highlight: false },
      { text: "up", highlight: true },
    ]);
    expect(JSON.stringify(segs)).not.toMatch(/<|script|onerror/i);
    // Entity-encoded markup stays inert TEXT (decoded once, never re-parsed).
    expect(parseSearchContext("&lt;script&gt;x&lt;/script&gt; &#60;b&#62;")).toEqual([
      { text: "<script>x</script> <b>", highlight: false },
    ]);
    // Nested bold stays one highlight; unbalanced close does not go negative.
    expect(parseSearchContext("</b>a<b>b<b>c</b>d</b>e")).toEqual([
      { text: "a", highlight: false },
      { text: "bcd", highlight: true },
      { text: "e", highlight: false },
    ]);
    expect(parseSearchContext(null)).toEqual([]);
    expect(parseSearchContext(42)).toEqual([]);
  });

  it("caps the snippet length", () => {
    const segs = parseSearchContext("x".repeat(5000));
    expect(segs.reduce((n, s) => n + s.text.length, 0)).toBe(600);
  });
});

describe("GET /projects/:id/outline/docs", () => {
  it("answers { anchor: null } without a link - even for a user who is not connected", async () => {
    const { tam, project } = await fixture();
    const res = await docsOf(tam.token, `/projects/${project.id}/outline/docs`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ anchor: null });
    expect(stub.apiCalls).toHaveLength(0);
  });

  it("answers { outside } for a foreign origin and { unsupported } for a same-origin non-page path, without calling Outline", async () => {
    const outside = await fixture({ projectUrl: "https://evil.example/collection/x-gtQE8nRes8" });
    await connect(outside.tam);
    expect((await docsOf(outside.tam.token, `/projects/${outside.project.id}/outline/docs`)).body).toEqual({ anchor: { outside: true } });
    const unsupported = await fixture({ projectUrl: `${stub.url}/home` });
    await connect(unsupported.tam);
    expect((await docsOf(unsupported.tam.token, `/projects/${unsupported.project.id}/outline/docs`)).body).toEqual({ anchor: { unsupported: true } });
    expect(stub.apiCalls).toHaveLength(0);
  });

  it("answers 409 outline_not_connected for a user without an Outline connection", async () => {
    const { tam, project } = await fixture({ projectUrl: collectionUrl() });
    const res = await docsOf(tam.token, `/projects/${project.id}/outline/docs`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("outline_not_connected");
  });

  it("returns a collection's tree with absolute urls, resolved with the viewer's token, and never any page text", async () => {
    const { tam, project } = await fixture({ projectUrl: collectionUrl() });
    await connect(tam);
    cannedOutline();
    const res = await docsOf(tam.token, `/projects/${project.id}/outline/docs`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      anchor: { kind: "collection", title: "Northwind Freight", url: `${stub.url}/collection/northwind-freight-gtQE8nRes8` },
      tree: [
        {
          id: D1, title: "Core Banking Migration", url: `${stub.url}/doc/core-banking-migration-LJlvGccdNz`,
          children: [{ id: D2, title: "Cut-over Runbook", url: `${stub.url}/doc/cut-over-runbook-PwbGa3vHJa`, children: [] }],
        },
        { id: D3, title: "Standalone", url: `${stub.url}/doc/standalone-aaaaaaaaaa`, children: [] },
      ],
    });
    expect(JSON.stringify(res.body)).not.toContain(BODY);
    // urlId -> info (F6), then the tree by UUID; both under the user's own token.
    expect(stub.apiCalls.map((c) => [c.method, c.body])).toEqual([
      ["collections.info", { id: "gtQE8nRes8" }],
      ["collections.documents", { id: COL_UUID }],
    ]);
    expect(new Set(stub.apiCalls.map((c) => c.token)).size).toBe(1);
  });

  it("returns a document anchor as the root of its own subtree", async () => {
    const { tam, project } = await fixture({ projectUrl: docUrl() });
    await connect(tam);
    cannedOutline();
    const res = await docsOf(tam.token, `/projects/${project.id}/outline/docs`);
    expect(res.body).toEqual({
      anchor: { kind: "doc", title: "Core Banking Migration", url: `${stub.url}/doc/core-banking-migration-LJlvGccdNz` },
      tree: [
        {
          id: DOC_UUID, title: "Core Banking Migration", url: `${stub.url}/doc/core-banking-migration-LJlvGccdNz`,
          children: [{ id: D2, title: "Cut-over Runbook", url: `${stub.url}/doc/cut-over-runbook-PwbGa3vHJa`, children: [] }],
        },
      ],
    });
    expect(JSON.stringify(res.body)).not.toContain(BODY);
    expect(stub.apiCalls.map((c) => c.method)).toEqual(["documents.info", "documents.documents"]);
  });

  it("treats a forbidden, unknown, trashed or archived anchor as hidden (F7)", async () => {
    const { tam, project } = await fixture({ projectUrl: docUrl() });
    await connect(tam);
    const hidden = { anchor: { hidden: true } };
    for (const info of [
      { status: 403, body: { ok: false, error: "authorization_error" } },
      { status: 404, body: { ok: false, error: "not_found" } },
      { status: 200, body: { ok: true, data: { id: DOC_UUID, title: "T", url: "/doc/t-aaaaaaaaaa", deletedAt: "2026-01-01T00:00:00Z", archivedAt: null } } },
      { status: 200, body: { ok: true, data: { id: DOC_UUID, title: "T", url: "/doc/t-aaaaaaaaaa", deletedAt: null, archivedAt: "2026-01-01T00:00:00Z" } } },
    ]) {
      clearOutlineTreeCache();
      cannedOutline({ "documents.info": info });
      const res = await docsOf(tam.token, `/projects/${project.id}/outline/docs`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(hidden);
    }
    // A collection that turns hidden between info and tree is hidden too.
    clearOutlineTreeCache();
    cannedOutline({ "documents.documents": { status: 403, body: {} } });
    expect((await docsOf(tam.token, `/projects/${project.id}/outline/docs`)).body).toEqual(hidden);
  });

  it("caches per user for 60 s: a second read makes no Outline call; another user fetches under their own token", async () => {
    const { tam, project } = await fixture({ projectUrl: collectionUrl() });
    const member = await newUser("TAM");
    await prisma.projectMember.create({ data: { projectId: project.id, userId: member.userId } });
    await connect(tam);
    await connect(member);
    cannedOutline();
    await docsOf(tam.token, `/projects/${project.id}/outline/docs`).expect(200);
    expect(stub.apiCalls).toHaveLength(2);
    await docsOf(tam.token, `/projects/${project.id}/outline/docs`).expect(200);
    expect(stub.apiCalls).toHaveLength(2);
    await docsOf(member.token, `/projects/${project.id}/outline/docs`).expect(200);
    expect(stub.apiCalls).toHaveLength(4);
    expect(stub.apiCalls[2].token).not.toBe(stub.apiCalls[0].token);
  });

  it("maps Outline's 429 to outline_rate_limited with retryAfter, once, and does not cache it", async () => {
    const { tam, project } = await fixture({ projectUrl: collectionUrl() });
    await connect(tam);
    cannedOutline({ "collections.info": { status: 429, body: {} } });
    stub.api = ((prev) => (m: string, t: string, b: unknown) =>
      m === "collections.info" ? { status: 429, body: {}, headers: { "Retry-After": "12" } } : prev(m, t, b))(stub.api);
    const res = await docsOf(tam.token, `/projects/${project.id}/outline/docs`);
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("outline_rate_limited");
    expect(res.body.details).toEqual({ retryAfter: 12 });
    expect(stub.apiCalls).toHaveLength(1);
  });

  it("keeps visibility and permission checks: stranger 404 (no Outline call), PENDING 403", async () => {
    const { project } = await fixture({ projectUrl: collectionUrl() });
    const stranger = await newUser("TAM");
    const pending = await newUser("PENDING");
    await connect(stranger);
    expect((await docsOf(stranger.token, `/projects/${project.id}/outline/docs`)).status).toBe(404);
    expect((await docsOf(pending.token, `/projects/${project.id}/outline/docs`)).status).toBe(403);
    expect((await request(app).get(`/projects/${project.id}/outline/docs`)).status).toBe(401);
    expect(stub.apiCalls).toHaveLength(0);
  });
});

describe("GET /customers/:id/outline/docs", () => {
  it("uses Customer.outlineUrl and never the project's", async () => {
    const { tam, customer } = await fixture({ customerUrl: collectionUrl(), projectUrl: docUrl() });
    await connect(tam);
    cannedOutline();
    const res = await docsOf(tam.token, `/customers/${customer.id}/outline/docs`);
    expect(res.status).toBe(200);
    expect(res.body.anchor.kind).toBe("collection");
    expect(JSON.stringify(res.body)).not.toContain(BODY);
  });

  it("no link -> null; stranger -> 404", async () => {
    const { tam, customer } = await fixture();
    expect((await docsOf(tam.token, `/customers/${customer.id}/outline/docs`)).body).toEqual({ anchor: null });
    const stranger = await newUser("TAM");
    expect((await docsOf(stranger.token, `/customers/${customer.id}/outline/docs`)).status).toBe(404);
  });
});

describe("GET /outline/templates", () => {
  it("lists workspace templates (id and title only, no collection filter)", async () => {
    const u = await newUser();
    await connect(u);
    cannedOutline();
    const res = await request(app).get("/outline/templates").set(auth(u.token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: TEMPLATE, title: "Meeting notes" }]);
    expect(JSON.stringify(res.body)).not.toContain(BODY);
    expect(callsOf("templates.list")).toHaveLength(1);
    expect(callsOf("templates.list")[0].body).not.toHaveProperty("collectionId");
  });

  it("needs a connection and a session", async () => {
    const u = await newUser();
    expect((await request(app).get("/outline/templates").set(auth(u.token))).body.code).toBe("outline_not_connected");
    expect((await request(app).get("/outline/templates")).status).toBe(401);
  });
});

describe("POST /projects/:id/outline/docs", () => {
  const post = (token: string, id: number, body: unknown) =>
    request(app).post(`/projects/${id}/outline/docs`).set(auth(token)).send(body as object);

  it("creates under a collection anchor (collectionId), with a template, and returns an absolute url only", async () => {
    const { tam, project } = await fixture({ projectUrl: collectionUrl() });
    await connect(tam);
    cannedOutline();
    const res = await post(tam.token, project.id, { title: " Meeting 1 ", templateId: TEMPLATE, publish: true });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: D3, title: "Meeting 1", url: `${stub.url}/doc/meeting-1-bbbbbbbbbb` });
    expect(JSON.stringify(res.body)).not.toContain(BODY);
    expect(callsOf("documents.create")[0].body).toEqual({ title: "Meeting 1", publish: true, templateId: TEMPLATE, collectionId: COL_UUID });
    expect(callsOf("documents.create")[0].token).toBe(callsOf("collections.info")[0].token);
  });

  it("creates under a doc anchor: default parent is the anchor; a parent inside the tree is allowed", async () => {
    const { tam, project } = await fixture({ projectUrl: docUrl() });
    await connect(tam);
    cannedOutline();
    await post(tam.token, project.id, { title: "A", publish: false }).expect(201);
    expect(callsOf("documents.create")[0].body).toEqual({ title: "A", publish: false, parentDocumentId: DOC_UUID });
    await post(tam.token, project.id, { title: "B", publish: true, parentDocumentId: D2 }).expect(201);
    expect(callsOf("documents.create")[1].body).toEqual({ title: "B", publish: true, parentDocumentId: D2 });
  });

  it("refuses a parent outside the anchor's tree with 400 and creates nothing", async () => {
    const { tam, project } = await fixture({ projectUrl: collectionUrl() });
    await connect(tam);
    cannedOutline();
    const res = await post(tam.token, project.id, { title: "X", publish: true, parentDocumentId: OUTSIDE_PARENT });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("outline_parent_outside_anchor");
    expect(callsOf("documents.create")).toHaveLength(0);
  });

  it("validates the body", async () => {
    const { tam, project } = await fixture({ projectUrl: collectionUrl() });
    await connect(tam);
    cannedOutline();
    for (const body of [
      {}, { title: "x" }, { title: "", publish: true }, { title: "   ", publish: true },
      { title: "x".repeat(256), publish: true }, { title: "x", publish: "yes" },
      { title: "x", publish: true, templateId: "nope" }, { title: "x", publish: true, parentDocumentId: "nope" },
    ]) {
      expect((await post(tam.token, project.id, body)).status, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
    expect(callsOf("documents.create")).toHaveLength(0);
  });

  it("is write-gated: a read-only user gets 403 and nothing is created", async () => {
    const { project } = await fixture({ projectUrl: collectionUrl() });
    const reader = await newUser("AUDITOR"); // project:read + project:view-all
    await connect(reader);
    cannedOutline();
    expect((await docsOf(reader.token, `/projects/${project.id}/outline/docs`)).status).toBe(200);
    expect((await post(reader.token, project.id, { title: "x", publish: true })).status).toBe(403);
    expect(callsOf("documents.create")).toHaveLength(0);
    const stranger = await newUser("TAM");
    expect((await post(stranger.token, project.id, { title: "x", publish: true })).status).toBe(404);
  });

  it("invalidates the cached tree so the next read refetches", async () => {
    const { tam, project } = await fixture({ projectUrl: collectionUrl() });
    await connect(tam);
    cannedOutline();
    await docsOf(tam.token, `/projects/${project.id}/outline/docs`).expect(200);
    await docsOf(tam.token, `/projects/${project.id}/outline/docs`).expect(200);
    expect(callsOf("collections.documents")).toHaveLength(1);
    await post(tam.token, project.id, { title: "New", publish: true }).expect(201);
    await docsOf(tam.token, `/projects/${project.id}/outline/docs`).expect(200);
    expect(callsOf("collections.documents")).toHaveLength(2);
  });

  it("answers 400 without a usable link, 404 when the anchor is hidden, 409 when not connected", async () => {
    const none = await fixture();
    await connect(none.tam);
    expect((await post(none.tam.token, none.project.id, { title: "x", publish: true })).body.code).toBe("outline_no_anchor");
    const outside = await fixture({ projectUrl: "https://evil.example/doc/x-PwbGa3vHJa" });
    await connect(outside.tam);
    expect((await post(outside.tam.token, outside.project.id, { title: "x", publish: true })).body.code).toBe("outline_anchor_invalid");
    const hidden = await fixture({ projectUrl: collectionUrl() });
    await connect(hidden.tam);
    cannedOutline({ "collections.info": { status: 403, body: {} } });
    const h = await post(hidden.tam.token, hidden.project.id, { title: "x", publish: true });
    expect(h.status).toBe(404);
    const notConnected = await fixture({ projectUrl: collectionUrl() });
    expect((await post(notConnected.tam.token, notConnected.project.id, { title: "x", publish: true })).status).toBe(409);
    expect(callsOf("documents.create")).toHaveLength(0);
  });
});

describe("POST /customers/:id/outline/docs", () => {
  it("creates under the customer's link with the customer write rule", async () => {
    const { tam, customer } = await fixture({ customerUrl: collectionUrl() });
    await connect(tam);
    cannedOutline();
    const ok = await request(app).post(`/customers/${customer.id}/outline/docs`).set(auth(tam.token)).send({ title: "Kickoff", publish: true });
    expect(ok.status).toBe(201);
    expect(callsOf("documents.create")[0].body).toMatchObject({ collectionId: COL_UUID });
    const reader = await newUser("AUDITOR");
    await connect(reader);
    const denied = await request(app).post(`/customers/${customer.id}/outline/docs`).set(auth(reader.token)).send({ title: "x", publish: true });
    expect(denied.status).toBe(403);
    expect(callsOf("documents.create")).toHaveLength(0); // (connect() cleared the earlier call log)
  });
});

describe("GET /outline/search", () => {
  const searchData = [
    {
      ranking: 1.2,
      context: 'Plan the <b>cut-over</b> <script>alert(1)</script>&amp; go-live',
      document: { id: D2, title: "Cut-over Runbook", url: "/doc/cut-over-runbook-PwbGa3vHJa", text: BODY },
    },
    { ranking: 0.1, context: "x", document: { title: "no id" } },
  ];

  it("returns id, title, absolute url and text-only snippet segments - never HTML or page text", async () => {
    const u = await newUser();
    await connect(u);
    stub.api = (m) => (m === "documents.search" ? { status: 200, body: { ok: true, data: searchData } } : undefined);
    const res = await request(app).get("/outline/search").query({ q: "  cut-over  ", limit: "5" }).set(auth(u.token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: D2,
        title: "Cut-over Runbook",
        url: `${stub.url}/doc/cut-over-runbook-PwbGa3vHJa`,
        snippet: [
          { text: "Plan the ", highlight: false },
          { text: "cut-over", highlight: true },
          { text: " & go-live", highlight: false },
        ],
      },
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/<|alert|CONFIDENTIAL/);
    expect(callsOf("documents.search")[0].body).toEqual({ query: "cut-over", limit: 5 });
  });

  it("validates q (2-200 chars) and limit (1-25, default 10)", async () => {
    const u = await newUser();
    await connect(u);
    stub.api = (m) => (m === "documents.search" ? { status: 200, body: { ok: true, data: [] } } : undefined);
    const get = (query: Record<string, string>) => request(app).get("/outline/search").query(query).set(auth(u.token));
    expect((await get({})).status).toBe(400);
    expect((await get({ q: "a" })).status).toBe(400);
    expect((await get({ q: " a " })).status).toBe(400);
    expect((await get({ q: "x".repeat(201) })).status).toBe(400);
    expect((await get({ q: "ab", limit: "0" })).status).toBe(400);
    expect((await get({ q: "ab", limit: "26" })).status).toBe(400);
    expect(callsOf("documents.search")).toHaveLength(0);
    expect((await get({ q: "ab" })).status).toBe(200);
    expect((await get({ q: "x".repeat(200), limit: "25" })).status).toBe(200);
    expect(callsOf("documents.search").map((c) => (c.body as { limit: number }).limit)).toEqual([10, 25]);
  });

  it("needs a connection, maps 429 with retryAfter (no retry), and needs a session", async () => {
    const u = await newUser();
    expect((await request(app).get("/outline/search").query({ q: "ab" }).set(auth(u.token))).body.code).toBe("outline_not_connected");
    await connect(u);
    stub.api = (m) => (m === "documents.search" ? { status: 429, body: {}, headers: { "Retry-After": "3" } } : undefined);
    const res = await request(app).get("/outline/search").query({ q: "ab" }).set(auth(u.token));
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ code: "outline_rate_limited", details: { retryAfter: 3 } });
    expect(callsOf("documents.search")).toHaveLength(1);
    expect((await request(app).get("/outline/search").query({ q: "ab" })).status).toBe(401);
  });
});
