// Outline token safety under concurrency (docs/archive/plans/outline-integration.md,
// B3 fix round): the per-user lock + config re-check around every token write, the
// in-process single flight, OAuth error classification, decrypt-failure-safe
// disconnect, and cache invalidation on token changes. Against the in-process
// Outline stub (test/outlineStub.ts).
import "./env.js";
import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { open, seal } from "../src/lib/secretBox.js";
import { outlineCall } from "../src/lib/outline/client.js";
import { clearOutlineTreeCache } from "../src/lib/outline/docs.js";
import { onOutlineAuthChanged } from "../src/lib/outline/cacheHooks.js";
import { checkDocVisible, clearDocVisibilityCacheForTests } from "../src/lib/outline/mentionsAccess.js";
import { clearOutlineTokensIfAccessIs } from "../src/lib/outline/tokens.js";
import { outlineCallbackRateLimiter } from "../src/routes/outline.js";
import { createAdminAndToken, createUserWithRole, seedRoles } from "./testAuth.js";
import { startOutlineStub, type OutlineStub } from "./outlineStub.js";

const CLIENT_ID = "stub-client-id";
const CLIENT_SECRET = "stub-client-secret";
const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const SETTINGS = "http://localhost:5173/settings";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  stub.refreshDelayMs = 0;
  stub.exchangeDelayMs = 0;
  stub.token = () => undefined;
  stub.api = () => undefined;
  outlineCallbackRateLimiter.reset();
  clearOutlineTreeCache();
  clearDocVisibilityCacheForTests();
  await prisma.outlineOAuthState.deleteMany();
  await prisma.outlineConfig.deleteMany();
  await prisma.outlineConfig.create({
    data: { baseUrl: stub.url, oauthClientId: CLIENT_ID, oauthClientSecretEnc: seal(CLIENT_SECRET) },
  });
});

let seq = 0;
async function newUser() {
  const u = await createUserWithRole("TAM");
  const row = await prisma.user.findUniqueOrThrow({ where: { id: u.userId } });
  seq += 1;
  return { ...u, email: row.email, outlineId: `ou-${seq}-${Date.now()}` };
}
type U = Awaited<ReturnType<typeof newUser>>;

async function startFlow(u: U) {
  const res = await request(app).post("/outline/oauth/start").set(auth(u.token));
  return new URL(res.body.authorizeUrl as string).searchParams.get("state")!;
}
const callbackReq = (u: U, state: string, code: string) => {
  stub.issueCode(code, { id: u.outlineId, email: u.email });
  return request(app).get(`/outline/oauth/callback?code=${code}&state=${state}`).then((r) => r);
};
async function connect(u: U) {
  const res = await callbackReq(u, await startFlow(u), `code-${crypto.randomUUID()}`);
  expect(res.headers.location).toBe(`${SETTINGS}?outline=connected`);
  stub.apiCalls.length = 0;
}
const dbUser = (id: number) => prisma.user.findUniqueOrThrow({ where: { id } });
const isCleared = (u: Awaited<ReturnType<typeof dbUser>>) =>
  u.outlineAccessTokenEnc === null && u.outlineRefreshTokenEnc === null && u.outlineUserId === null && u.outlineEmail === null;
const expire = (id: number) =>
  prisma.user.update({ where: { id }, data: { outlineTokenExpiresAt: new Date(Date.now() - 1000) } });
const refreshes = () => stub.tokenRequests.filter((p) => p.get("grant_type") === "refresh_token");
const patchSettings = async (token: string, body: object) =>
  request(app).patch("/admin/settings/outline").set(auth(token)).send(body).then((r) => r);

describe("disconnect during refresh (a)", () => {
  it("waits for the refresh to commit, then clears; the revoke targets the pair the refresh stored", async () => {
    const u = await newUser();
    await connect(u);
    await expire(u.userId);
    stub.refreshDelayMs = 400;

    const call = outlineCall(u.userId, "documents.info").then(() => "ok", (e: { code?: string }) => e.code);
    await sleep(120);
    const del = request(app).delete("/outline/me").set(auth(u.token)).then((r) => r);
    expect(await call).toBe("ok");
    expect((await del).status).toBe(204);

    expect(isCleared(await dbUser(u.userId))).toBe(true); // the disconnect was not undone by the refresh
    expect(refreshes()).toHaveLength(1);
    expect(stub.revokeRequests).toHaveLength(1);
    expect(stub.revokeRequests[0].get("token")).toBe(stub.lastIssued()!.refreshToken); // the rotated one, not the stale one
  });
});

describe("admin re-pointing during a refresh or a callback (b)", () => {
  it("an address change during a refresh waits for it, then wipes: nothing survives", async () => {
    const admin = await createAdminAndToken();
    const u = await newUser();
    await connect(u);
    await expire(u.userId);
    stub.refreshDelayMs = 400;

    const call = outlineCall(u.userId, "documents.info").then(() => "ok", (e: { code?: string }) => e.code);
    await sleep(120);
    const patch = patchSettings(admin.token, { baseUrl: "http://127.0.0.1:9" });
    expect(await call).toBe("ok");
    expect((await patch).status).toBe(200);

    expect(isCleared(await dbUser(u.userId))).toBe(true);
    expect(refreshes()).toHaveLength(1); // the one refresh went to the OLD host; no call reached the new one
  });

  it("a client change during a refresh behaves the same", async () => {
    const admin = await createAdminAndToken();
    const u = await newUser();
    await connect(u);
    await expire(u.userId);
    stub.refreshDelayMs = 400;
    const call = outlineCall(u.userId, "documents.info").then(() => "ok", (e: { code?: string }) => e.code);
    await sleep(120);
    const patch = patchSettings(admin.token, { oauthClientId: "another-client" });
    await call;
    expect((await patch).status).toBe(200);
    expect(isCleared(await dbUser(u.userId))).toBe(true);
  });

  it("a refresh that starts after the change never sends the old token to the new address", async () => {
    const admin = await createAdminAndToken();
    const u = await newUser();
    await connect(u);
    await expire(u.userId);
    // The wipe commits first; a refresh arriving after it finds no tokens at all.
    expect((await patchSettings(admin.token, { baseUrl: "http://127.0.0.1:9" })).status).toBe(200);
    await expect(outlineCall(u.userId, "documents.info")).rejects.toMatchObject({ code: "outline_not_connected" });
    expect(refreshes()).toHaveLength(0);
    expect(stub.apiCalls).toHaveLength(0);
  });

  it("an address change during the OAuth callback stores nothing and revokes the new token", async () => {
    const admin = await createAdminAndToken();
    const u = await newUser();
    const state = await startFlow(u);
    stub.exchangeDelayMs = 400;
    const cb = callbackReq(u, state, "code-race");
    await sleep(150);
    expect((await patchSettings(admin.token, { baseUrl: "http://127.0.0.1:9" })).status).toBe(200);
    const res = await cb;

    expect(res.headers.location).toBe(`${SETTINGS}?outline=error&reason=not_configured`);
    expect(isCleared(await dbUser(u.userId))).toBe(true);
    expect(stub.revokeRequests).toHaveLength(1);
    expect(stub.revokeRequests[0].get("token")).toBe(stub.lastIssued()!.refreshToken);
  });
});

describe("a stale failure must not clear a newer pair (c)", () => {
  it("a refresh refused with invalid_grant finishes before a concurrent callback stores its pair, which then survives", async () => {
    const u = await newUser();
    await connect(u);
    stub.revokeRefresh(stub.lastIssued()!.refreshToken);
    await expire(u.userId);
    stub.refreshDelayMs = 400;

    const call = outlineCall(u.userId, "documents.info").then(() => "ok", (e: { code?: string }) => e.code);
    await sleep(120);
    const state = await startFlow(u);
    const cb = await callbackReq(u, state, "code-after");
    expect(await call).toBe("outline_reconnect_required");
    expect(cb.headers.location).toBe(`${SETTINGS}?outline=connected`);

    const row = await dbUser(u.userId);
    expect(open(row.outlineAccessTokenEnc!)).toBe(stub.lastIssued()!.accessToken); // the new connection, not cleared
  });

  it("clearOutlineTokensIfAccessIs only clears the pair it names", async () => {
    const u = await newUser();
    await connect(u);
    const stored = open((await dbUser(u.userId)).outlineAccessTokenEnc!);
    expect(await clearOutlineTokensIfAccessIs(u.userId, "ol_at_someone_elses")).toBe(false);
    expect((await dbUser(u.userId)).outlineAccessTokenEnc).not.toBeNull();
    expect(await clearOutlineTokensIfAccessIs(u.userId, stored)).toBe(true);
    expect(isCleared(await dbUser(u.userId))).toBe(true);
  });

  it("a repeated 401 does not wipe a pair a newer connection stored in the meantime", async () => {
    const u = await newUser();
    await connect(u);
    let n = 0;
    stub.api = async () => {
      n += 1;
      if (n === 2) {
        // The retry's 401 arrives after a fresh callback replaced the pair.
        await prisma.user.update({
          where: { id: u.userId },
          data: { outlineAccessTokenEnc: seal("ol_at_newer"), outlineRefreshTokenEnc: seal("ol_rt_newer") },
        });
      }
      return { status: 401, body: {} };
    };
    await expect(outlineCall(u.userId, "documents.info")).rejects.toMatchObject({ code: "outline_reconnect_required" });
    expect(open((await dbUser(u.userId)).outlineAccessTokenEnc!)).toBe("ol_at_newer");
  });
});

describe("in-process single flight (#3)", () => {
  it("10 concurrent stale calls refresh once and hold at most 2 DB connections in transaction", async () => {
    const u = await newUser();
    await connect(u);
    await expire(u.userId);
    stub.refreshDelayMs = 500;

    const calls = Array.from({ length: 10 }, (_, i) => outlineCall(u.userId, i % 2 ? "documents.info" : "documents.list"));
    await sleep(250);
    const [stats] = await prisma.$queryRaw<Array<{ idle_tx: bigint; lock_waiters: bigint }>>`
      SELECT count(*) FILTER (WHERE state = 'idle in transaction') AS idle_tx,
             count(*) FILTER (WHERE wait_event_type = 'Lock') AS lock_waiters
      FROM pg_stat_activity WHERE datname = current_database()`;
    await Promise.all(calls);

    expect(Number(stats.idle_tx)).toBeLessThanOrEqual(2);
    expect(Number(stats.lock_waiters)).toBe(0);
    expect(refreshes()).toHaveLength(1);
    const fresh = stub.lastIssued()!.accessToken;
    expect(stub.apiCalls).toHaveLength(10);
    expect(stub.apiCalls.every((c) => c.token === fresh)).toBe(true);
  });
});

describe("OAuth error classification (#4)", () => {
  async function stale() {
    const u = await newUser();
    await connect(u);
    await expire(u.userId);
    return u;
  }

  it("invalid_client keeps the tokens and answers 409 outline_not_configured", async () => {
    const u = await stale();
    stub.token = () => ({ status: 401, body: { error: "invalid_client" } });
    await expect(outlineCall(u.userId, "documents.info")).rejects.toMatchObject({ status: 409, code: "outline_not_configured" });
    const row = await dbUser(u.userId);
    expect(row.outlineAccessTokenEnc).not.toBeNull();
    expect(row.outlineRefreshTokenEnc).not.toBeNull();
  });

  it("unauthorized_client behaves the same", async () => {
    const u = await stale();
    stub.token = () => ({ status: 400, body: { error: "unauthorized_client" } });
    await expect(outlineCall(u.userId, "documents.info")).rejects.toMatchObject({ code: "outline_not_configured" });
    expect((await dbUser(u.userId)).outlineRefreshTokenEnc).not.toBeNull();
  });

  it("any other failure (other 4xx, 5xx, empty body) is outline_unavailable and keeps the tokens", async () => {
    const u = await stale();
    for (const forced of [
      { status: 400, body: { error: "invalid_request" } },
      { status: 400, body: {} },
      { status: 401, body: {} },
      { status: 403, body: { error: "access_denied" } },
      { status: 500, body: { error: "server_error" } },
    ]) {
      stub.token = () => forced;
      await expect(outlineCall(u.userId, "documents.info"), JSON.stringify(forced)).rejects.toMatchObject({
        status: 502,
        code: "outline_unavailable",
      });
      expect((await dbUser(u.userId)).outlineRefreshTokenEnc).not.toBeNull();
    }
  });

  it("only invalid_grant clears the tokens", async () => {
    const u = await stale();
    stub.token = () => ({ status: 400, body: { error: "invalid_grant" } });
    await expect(outlineCall(u.userId, "documents.info")).rejects.toMatchObject({ code: "outline_reconnect_required" });
    expect(isCleared(await dbUser(u.userId))).toBe(true);
  });

  it("in the callback: invalid_client -> not_configured, other failures -> unavailable, invalid_grant -> exchange", async () => {
    const u = await newUser();
    const run = async (forced: { status: number; body: unknown }) => {
      stub.token = () => forced;
      const res = await callbackReq(u, await startFlow(u), `code-${crypto.randomUUID()}`);
      return res.headers.location;
    };
    expect(await run({ status: 401, body: { error: "invalid_client" } })).toBe(`${SETTINGS}?outline=error&reason=not_configured`);
    expect(await run({ status: 400, body: { error: "invalid_request" } })).toBe(`${SETTINGS}?outline=error&reason=unavailable`);
    expect(await run({ status: 400, body: { error: "invalid_grant" } })).toBe(`${SETTINGS}?outline=error&reason=exchange`);
    expect(isCleared(await dbUser(u.userId))).toBe(true);
  });
});

describe("an undecryptable client secret (#9)", () => {
  it("GET /outline/me reports configured:false and DELETE /outline/me still disconnects cleanly", async () => {
    const u = await newUser();
    await connect(u);
    // A secret sealed under another key: the right shape, the wrong ciphertext.
    await prisma.outlineConfig.update({ where: { id: "default" }, data: { oauthClientSecretEnc: "v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==:AAAA" } });

    const me = await request(app).get("/outline/me").set(auth(u.token));
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ configured: false, connected: true });

    stub.revokeRequests.length = 0;
    const del = await request(app).delete("/outline/me").set(auth(u.token));
    expect(del.status).toBe(204);
    expect(isCleared(await dbUser(u.userId))).toBe(true);
    expect(stub.revokeRequests).toHaveLength(0); // nothing to revoke with
    expect((await request(app).get("/outline/me").set(auth(u.token))).body).toMatchObject({ connected: false });
  });

  it("starting a connection answers 409 outline_not_configured", async () => {
    const u = await newUser();
    await prisma.outlineConfig.update({ where: { id: "default" }, data: { oauthClientSecretEnc: "v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==:AAAA" } });
    const res = await request(app).post("/outline/oauth/start").set(auth(u.token));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("outline_not_configured");
  });
});

describe("cache invalidation on token changes (#12)", () => {
  async function projectWithLink(u: U) {
    return prisma.project.create({
      data: { name: `P ${Date.now()}-${Math.random()}`, tamId: u.userId, status: "ACTIVE", outlineUrl: `${stub.url}/collection/northwind-gtQE8nRes8` },
    });
  }
  const COL = "11111111-1111-4111-8111-111111111111";
  function canned() {
    stub.api = (method) => {
      if (method === "collections.info") return { status: 200, body: { ok: true, data: { id: COL, name: "N", url: "/collection/n-gtQE8nRes8" } } };
      if (method === "collections.documents") return { status: 200, body: { ok: true, data: [] } };
      return undefined;
    };
  }

  it("a disconnected user is never served a cached Docs tree", async () => {
    const u = await newUser();
    const project = await projectWithLink(u);
    await connect(u);
    canned();
    expect((await request(app).get(`/projects/${project.id}/outline/docs`).set(auth(u.token))).status).toBe(200);
    expect((await request(app).get(`/projects/${project.id}/outline/docs`).set(auth(u.token))).status).toBe(200); // cached
    expect(stub.apiCalls.filter((c) => c.method === "collections.info")).toHaveLength(1);

    await request(app).delete("/outline/me").set(auth(u.token)).expect(204);
    const after = await request(app).get(`/projects/${project.id}/outline/docs`).set(auth(u.token));
    expect(after.status).toBe(409);
    expect(after.body.code).toBe("outline_not_connected");

    // Even with the cache entry restored by a (hypothetical) race, no tokens means no tree.
    await connect(u);
    canned();
    await request(app).get(`/projects/${project.id}/outline/docs`).set(auth(u.token)).expect(200);
    expect(stub.apiCalls.filter((c) => c.method === "collections.info")).toHaveLength(1); // refetched under the NEW connection
  });

  it("mention-visibility verdicts are forgotten on disconnect and on reconnect", async () => {
    const u = await newUser();
    await connect(u);
    stub.api = (m) => (m === "documents.info" ? { status: 200, body: { ok: true, data: { deletedAt: null, archivedAt: null } } } : undefined);
    expect(await checkDocVisible(u.userId, "doc-1")).toBe("visible");
    await request(app).delete("/outline/me").set(auth(u.token)).expect(204);
    expect(await checkDocVisible(u.userId, "doc-1")).toBe("reconnect"); // not the remembered "visible"

    await connect(u);
    stub.api = (m) => (m === "documents.info" ? { status: 403, body: {} } : undefined);
    expect(await checkDocVisible(u.userId, "doc-1")).toBe("hidden"); // fresh answer, not a stale "visible"
  });

  it("notifies caches: disconnect and connect per user, an address/client change for everyone, nothing for a secret-only change", async () => {
    const events: Array<number | null> = [];
    onOutlineAuthChanged((id) => events.push(id));
    const admin = await createAdminAndToken();
    const u = await newUser();
    await connect(u);
    expect(events).toContain(u.userId);

    events.length = 0;
    await request(app).delete("/outline/me").set(auth(u.token)).expect(204);
    expect(events).toEqual([u.userId]);

    events.length = 0;
    await patchSettings(admin.token, { oauthClientSecret: CLIENT_SECRET });
    expect(events).toEqual([]);
    await patchSettings(admin.token, { oauthClientId: "changed" });
    expect(events).toEqual([null]);
  });
});
