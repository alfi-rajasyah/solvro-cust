// Outline Phase B, task B3 (docs/archive/plans/outline-integration.md): OAuth
// connect/callback/disconnect, the per-user client, rotating-refresh handling,
// error mapping, and log redaction - against an in-process Outline stub
// (test/outlineStub.ts) shaped by the real-instance spike (F1-F5, F11, F12).
import "./env.js";
import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { pino } from "pino";
import { createApp } from "../src/app.js";
import { env } from "../src/env.js";
import { prisma } from "../src/prisma.js";
import { open, seal } from "../src/lib/secretBox.js";
import { outlineCall } from "../src/lib/outline/client.js";
import { isOutlineHidden, OutlineApiError } from "../src/lib/outline/errors.js";
import { outlineCallbackRateLimiter } from "../src/routes/outline.js";
import { redactOutlineOAuthParams } from "../src/http/requestLogger.js";
import { createUserWithRole, seedRoles } from "./testAuth.js";
import { startOutlineStub, type OutlineStub } from "./outlineStub.js";

const CLIENT_ID = "stub-client-id";
const CLIENT_SECRET = "stub-client-secret";
const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const SETTINGS = "http://localhost:5173/settings";

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

async function start(token: string) {
  const res = await request(app).post("/outline/oauth/start").set(auth(token));
  expect(res.status).toBe(200);
  const url = new URL(res.body.authorizeUrl as string);
  return { url, state: url.searchParams.get("state")! };
}

const callback = (query: string) => request(app).get(`/outline/oauth/callback?${query}`);

/** Full happy path: start, grant a code for `outlineEmail`, hit the callback. */
async function connect(u: { token: string; outlineId: string; email: string }, outlineEmail = u.email) {
  const { state } = await start(u.token);
  const code = `code-${crypto.randomUUID()}`;
  stub.issueCode(code, { id: u.outlineId, email: outlineEmail });
  return callback(`code=${code}&state=${state}`);
}

const dbUser = (id: number) => prisma.user.findUniqueOrThrow({ where: { id } });
const isCleared = (u: Awaited<ReturnType<typeof dbUser>>) =>
  u.outlineAccessTokenEnc === null &&
  u.outlineRefreshTokenEnc === null &&
  u.outlineTokenExpiresAt === null &&
  u.outlineUserId === null &&
  u.outlineEmail === null;

describe("POST /outline/oauth/start", () => {
  it("returns the authorize URL with PKCE S256, scope, redirect URI and a stored single-use state", async () => {
    const u = await newUser();
    const { url, state } = await start(u.token);
    expect(url.origin + url.pathname).toBe(`${stub.url}/oauth/authorize`);
    const p = url.searchParams;
    expect(p.get("client_id")).toBe(CLIENT_ID);
    expect(p.get("redirect_uri")).toBe(`${env.APP_URL}/api/outline/oauth/callback`);
    expect(p.get("response_type")).toBe("code");
    expect(p.get("scope")).toBe("read create");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(state.length).toBeGreaterThanOrEqual(43); // 256 random bits, base64url

    const row = await prisma.outlineOAuthState.findUniqueOrThrow({ where: { id: state } });
    expect(row.userId).toBe(u.userId);
    const ttl = row.expiresAt.getTime() - row.createdAt.getTime();
    expect(ttl).toBeGreaterThan(9 * 60_000);
    expect(ttl).toBeLessThanOrEqual(10 * 60_000 + 1000);
    expect(row.codeVerifierEnc).not.toContain(open(row.codeVerifierEnc)); // sealed
    const verifier = open(row.codeVerifierEnc);
    expect(crypto.createHash("sha256").update(verifier).digest("base64url")).toBe(p.get("code_challenge"));
  });

  it("needs authentication", async () => {
    expect((await request(app).post("/outline/oauth/start")).status).toBe(401);
  });

  it("answers 409 outline_not_configured while the client id/secret/base URL is missing", async () => {
    const u = await newUser();
    await prisma.outlineConfig.update({ where: { id: "default" }, data: { oauthClientSecretEnc: null } });
    const res = await request(app).post("/outline/oauth/start").set(auth(u.token));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("outline_not_configured");
    expect(await prisma.outlineOAuthState.count()).toBe(0);
  });

  it("answers 409 outline_app_url_unset when APP_URL is unset", async () => {
    const u = await newUser();
    const mutable = env as { APP_URL: string | null };
    const saved = mutable.APP_URL;
    try {
      mutable.APP_URL = null;
      const res = await request(app).post("/outline/oauth/start").set(auth(u.token));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("outline_app_url_unset");
    } finally {
      mutable.APP_URL = saved;
    }
  });

  it("purges expired states and keeps at most 5 pending per user (oldest dropped)", async () => {
    const u = await newUser();
    const other = await newUser();
    await prisma.outlineOAuthState.create({
      data: { id: "expired-" + crypto.randomUUID(), userId: other.userId, codeVerifierEnc: "v1:a:b:c", expiresAt: new Date(Date.now() - 1000) },
    });
    const first = await start(u.token);
    for (let i = 0; i < 6; i++) await start(u.token);
    expect(await prisma.outlineOAuthState.count({ where: { userId: u.userId } })).toBe(5);
    expect(await prisma.outlineOAuthState.findUnique({ where: { id: first.state } })).toBeNull();
    expect(await prisma.outlineOAuthState.count({ where: { userId: other.userId } })).toBe(0);
  });
});

describe("GET /outline/oauth/callback", () => {
  it("stores the sealed pair, expiry and identity, consumes the state, and redirects to Settings", async () => {
    const u = await newUser();
    const { url, state } = await start(u.token);
    const code = "code-ok";
    stub.issueCode(code, { id: u.outlineId, email: u.email });
    const res = await callback(`code=${code}&state=${state}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${SETTINGS}?outline=connected`);
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(res.headers["x-robots-tag"]).toContain("noindex");

    // Form-encoded exchange (F1) with client credentials and the PKCE verifier.
    const ex = stub.tokenRequests[0];
    expect(ex.get("grant_type")).toBe("authorization_code");
    expect(ex.get("code")).toBe(code);
    expect(ex.get("client_id")).toBe(CLIENT_ID);
    expect(ex.get("client_secret")).toBe(CLIENT_SECRET);
    expect(ex.get("redirect_uri")).toBe(`${env.APP_URL}/api/outline/oauth/callback`);
    expect(crypto.createHash("sha256").update(ex.get("code_verifier")!).digest("base64url")).toBe(
      url.searchParams.get("code_challenge"),
    );

    const row = await dbUser(u.userId);
    const issued = stub.lastIssued()!;
    expect(row.outlineAccessTokenEnc).not.toContain(issued.accessToken);
    expect(open(row.outlineAccessTokenEnc!)).toBe(issued.accessToken);
    expect(open(row.outlineRefreshTokenEnc!)).toBe(issued.refreshToken);
    expect(row.outlineUserId).toBe(u.outlineId);
    expect(row.outlineEmail).toBe(u.email);
    expect(row.outlineTokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 50 * 60_000);
    expect(await prisma.outlineOAuthState.findUnique({ where: { id: state } })).toBeNull();
    // auth.info ran with the NEW user token, nothing else.
    expect(stub.apiCalls.map((c) => [c.method, c.token])).toEqual([["auth.info", issued.accessToken]]);
  });

  it("compares the email case-insensitively", async () => {
    const u = await newUser();
    const res = await connect(u, u.email.toUpperCase());
    expect(res.headers.location).toBe(`${SETTINGS}?outline=connected`);
  });

  it("a cancelled consent (error=access_denied, no state) stores nothing", async () => {
    const u = await newUser();
    await start(u.token);
    const res = await callback("error=access_denied");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${SETTINGS}?outline=cancelled`);
    expect(isCleared(await dbUser(u.userId))).toBe(true);
    expect(stub.tokenRequests).toHaveLength(0);
  });

  it("an unknown, missing, malformed, expired or reused state is refused with reason=state", async () => {
    const u = await newUser();
    const refused = `${SETTINGS}?outline=error&reason=state`;
    expect((await callback("code=x&state=" + "A".repeat(43))).headers.location).toBe(refused);
    expect((await callback("code=x")).headers.location).toBe(refused);
    expect((await callback("state=" + "A".repeat(43))).headers.location).toBe(refused);
    expect((await callback("code=x&state=%00bad")).headers.location).toBe(refused);

    const expired = "e".repeat(43);
    await prisma.outlineOAuthState.create({
      data: { id: expired, userId: u.userId, codeVerifierEnc: seal("v"), expiresAt: new Date(Date.now() - 1000) },
    });
    stub.issueCode("code-exp", { id: u.outlineId, email: u.email });
    expect((await callback(`code=code-exp&state=${expired}`)).headers.location).toBe(refused);
    expect(await prisma.outlineOAuthState.findUnique({ where: { id: expired } })).toBeNull();

    // Reuse: the first callback consumes the state, the replay is refused.
    const { state } = await start(u.token);
    stub.issueCode("code-1", { id: u.outlineId, email: u.email });
    expect((await callback(`code=code-1&state=${state}`)).headers.location).toBe(`${SETTINGS}?outline=connected`);
    stub.issueCode("code-2", { id: u.outlineId, email: u.email });
    expect((await callback(`code=code-2&state=${state}`)).headers.location).toBe(refused);
    expect(stub.tokenRequests).toHaveLength(1);
  });

  it("a different Outline email stores nothing and revokes the freshly issued token", async () => {
    const u = await newUser();
    const res = await connect(u, "other@example.com");
    expect(res.headers.location).toBe(`${SETTINGS}?outline=error&reason=identity_mismatch`);
    expect(isCleared(await dbUser(u.userId))).toBe(true);
    const issued = stub.lastIssued()!;
    expect(stub.revokeRequests).toHaveLength(1);
    expect(stub.revokeRequests[0].get("token")).toBe(issued.refreshToken);
    // The revoked token is dead at Outline.
    const probe = await fetch(`${stub.url}/api/auth.info`, {
      method: "POST",
      headers: { Authorization: `Bearer ${issued.accessToken}`, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(probe.status).toBe(401);
  });

  it("refuses an Outline identity already linked to another Solvro account (already_linked)", async () => {
    const a = await newUser();
    const b = await newUser();
    await prisma.user.update({ where: { id: a.userId }, data: { outlineUserId: b.outlineId } });
    const res = await connect(b);
    expect(res.headers.location).toBe(`${SETTINGS}?outline=error&reason=already_linked`);
    expect(isCleared(await dbUser(b.userId))).toBe(true);
    expect(stub.revokeRequests).toHaveLength(1);
  });

  it("a rejected code exchange redirects with reason=exchange and echoes nothing from Outline", async () => {
    const u = await newUser();
    const { state } = await start(u.token);
    const res = await callback(`code=never-issued&state=${state}`);
    expect(res.headers.location).toBe(`${SETTINGS}?outline=error&reason=exchange`);
    expect(res.text).not.toContain("invalid_grant");
  });

  it("is rate limited per IP", async () => {
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await callback("error=access_denied")).status;
    expect(last).toBe(429);
  });
});

describe("GET /outline/me and DELETE /outline/me", () => {
  it("reports configuration and connection without ever returning a token", async () => {
    const u = await newUser();
    const before = await request(app).get("/outline/me").set(auth(u.token));
    expect(before.body).toEqual({ configured: true, connected: false, outlineEmail: null, expiresAt: null });

    await connect(u);
    const after = await request(app).get("/outline/me").set(auth(u.token));
    expect(after.body).toMatchObject({ configured: true, connected: true, outlineEmail: u.email });
    expect(typeof after.body.expiresAt).toBe("string");
    expect(JSON.stringify(after.body)).not.toMatch(/ol_at_|ol_rt_|v1:/);

    await prisma.outlineConfig.update({ where: { id: "default" }, data: { oauthClientId: null } });
    expect((await request(app).get("/outline/me").set(auth(u.token))).body.configured).toBe(false);
    expect((await request(app).get("/outline/me")).status).toBe(401);
  });

  it("disconnect revokes at Outline (form-encoded) and clears every field", async () => {
    const u = await newUser();
    await connect(u);
    const issued = stub.lastIssued()!;
    const res = await request(app).delete("/outline/me").set(auth(u.token));
    expect(res.status).toBe(204);
    expect(isCleared(await dbUser(u.userId))).toBe(true);
    expect(stub.revokeRequests).toHaveLength(1);
    expect(stub.revokeRequests[0].get("token")).toBe(issued.refreshToken);
    expect(stub.revokeRequests[0].get("client_id")).toBe(CLIENT_ID);
    // Disconnecting again is a harmless no-op.
    expect((await request(app).delete("/outline/me").set(auth(u.token))).status).toBe(204);
    expect(stub.revokeRequests).toHaveLength(1);
  });
});

describe("outlineCall", () => {
  it("uses the user's own bearer token and returns Outline's JSON", async () => {
    const u = await newUser();
    await connect(u);
    stub.apiCalls.length = 0;
    const out = await outlineCall<{ data: { echoed: string } }>(u.userId, "documents.info", { id: "x" });
    expect(out.data.echoed).toBe("documents.info");
    expect(stub.apiCalls).toEqual([{ method: "documents.info", token: stub.lastIssued()!.accessToken, body: { id: "x" } }]);
  });

  it("throws 409 outline_not_connected for a user without tokens, and rejects malformed method names", async () => {
    const u = await newUser();
    await expect(outlineCall(u.userId, "auth.info")).rejects.toMatchObject({ status: 409, code: "outline_not_connected" });
    await connect(u);
    await expect(outlineCall(u.userId, "../oauth/token")).rejects.toThrow(/Invalid Outline method/);
  });

  it("refreshes proactively inside the 60 s window and stores the rotated pair", async () => {
    const u = await newUser();
    await connect(u);
    const first = stub.lastIssued()!;
    await prisma.user.update({ where: { id: u.userId }, data: { outlineTokenExpiresAt: new Date(Date.now() + 30_000) } });
    stub.apiCalls.length = 0;
    await outlineCall(u.userId, "documents.info");
    const refreshes = stub.tokenRequests.filter((p) => p.get("grant_type") === "refresh_token");
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0].get("refresh_token")).toBe(first.refreshToken);
    expect(refreshes[0].get("client_secret")).toBe(CLIENT_SECRET);
    const second = stub.lastIssued()!;
    expect(second.accessToken).not.toBe(first.accessToken);
    const row = await dbUser(u.userId);
    expect(open(row.outlineAccessTokenEnc!)).toBe(second.accessToken);
    expect(open(row.outlineRefreshTokenEnc!)).toBe(second.refreshToken);
    expect(row.outlineTokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 50 * 60_000);
    expect(stub.apiCalls[0].token).toBe(second.accessToken);
  });

  it("does not refresh while the token has more than 60 s left", async () => {
    const u = await newUser();
    await connect(u);
    await outlineCall(u.userId, "documents.info");
    expect(stub.tokenRequests.filter((p) => p.get("grant_type") === "refresh_token")).toHaveLength(0);
  });

  it("is single-flight per user: two concurrent calls on an expired token refresh exactly once", async () => {
    const u = await newUser();
    await connect(u);
    await prisma.user.update({ where: { id: u.userId }, data: { outlineTokenExpiresAt: new Date(Date.now() - 1000) } });
    stub.refreshDelayMs = 200;
    stub.apiCalls.length = 0;
    const results = await Promise.all([
      outlineCall(u.userId, "documents.info"),
      outlineCall(u.userId, "documents.list"),
      outlineCall(u.userId, "templates.list"),
    ]);
    expect(results).toHaveLength(3);
    expect(stub.tokenRequests.filter((p) => p.get("grant_type") === "refresh_token")).toHaveLength(1);
    const fresh = stub.lastIssued()!.accessToken;
    expect(stub.apiCalls.every((c) => c.token === fresh)).toBe(true);
    expect(stub.apiCalls).toHaveLength(3);
  });

  it("on a 401 forces one refresh and retries once", async () => {
    const u = await newUser();
    await connect(u);
    const first = stub.lastIssued()!;
    stub.invalidateAccess(first.accessToken); // Outline killed it early; our expiry still says fresh
    stub.apiCalls.length = 0;
    await outlineCall(u.userId, "documents.info");
    expect(stub.tokenRequests.filter((p) => p.get("grant_type") === "refresh_token")).toHaveLength(1);
    expect(stub.apiCalls.map((c) => c.token)).toEqual([first.accessToken, stub.lastIssued()!.accessToken]);
  });

  it("a second 401 after the refresh clears the tokens and demands a reconnect", async () => {
    const u = await newUser();
    await connect(u);
    stub.api = () => ({ status: 401, body: { ok: false } });
    await expect(outlineCall(u.userId, "documents.info")).rejects.toMatchObject({
      status: 409,
      code: "outline_reconnect_required",
    });
    expect(isCleared(await dbUser(u.userId))).toBe(true);
  });

  it("invalid_grant on refresh (revoked grant) clears the tokens and demands a reconnect", async () => {
    const u = await newUser();
    await connect(u);
    stub.revokeRefresh(stub.lastIssued()!.refreshToken);
    await prisma.user.update({ where: { id: u.userId }, data: { outlineTokenExpiresAt: new Date(Date.now() - 1000) } });
    await expect(outlineCall(u.userId, "documents.info")).rejects.toMatchObject({
      status: 409,
      code: "outline_reconnect_required",
    });
    expect(isCleared(await dbUser(u.userId))).toBe(true);
    await expect(outlineCall(u.userId, "documents.info")).rejects.toMatchObject({ code: "outline_not_connected" });
  });

  it("maps 429 to outline_rate_limited with retryAfter and never retries (F11)", async () => {
    const u = await newUser();
    await connect(u);
    stub.apiCalls.length = 0;
    stub.api = () => ({ status: 429, body: {}, headers: { "Retry-After": "7" } });
    const err = (await outlineCall(u.userId, "documents.search").catch((e: unknown) => e)) as OutlineApiError;
    expect(err).toBeInstanceOf(OutlineApiError);
    expect(err.status).toBe(429);
    expect(err.code).toBe("outline_rate_limited");
    expect(err.details).toEqual({ retryAfter: 7 });
    expect(stub.apiCalls).toHaveLength(1);
  });

  it("maps 403/404 to typed 'hidden' errors (F7) and 5xx / redirects to outline_unavailable, without echoing Outline", async () => {
    const u = await newUser();
    await connect(u);
    stub.api = () => ({ status: 403, body: { error: "authorization_error", message: "SECRET PAGE TITLE" } });
    const forbidden = await outlineCall(u.userId, "documents.info").catch((e: unknown) => e);
    expect(isOutlineHidden(forbidden)).toBe(true);
    expect((forbidden as OutlineApiError).code).toBe("outline_forbidden");
    expect((forbidden as OutlineApiError).status).toBe(404); // never 401/403 to the browser
    expect(JSON.stringify(forbidden, Object.getOwnPropertyNames(forbidden))).not.toContain("SECRET PAGE TITLE");

    stub.api = () => ({ status: 404, body: {} });
    const missing = await outlineCall(u.userId, "documents.info").catch((e: unknown) => e);
    expect(isOutlineHidden(missing)).toBe(true);
    expect((missing as OutlineApiError).code).toBe("outline_not_found");

    stub.api = () => ({ status: 503, body: {} });
    await expect(outlineCall(u.userId, "documents.info")).rejects.toMatchObject({ code: "outline_unavailable", status: 502 });
    stub.api = () => ({ status: 302, body: {}, headers: { Location: "http://evil.example/" } });
    await expect(outlineCall(u.userId, "documents.info")).rejects.toMatchObject({ code: "outline_unavailable" });
    stub.api = () => ({ status: 400, body: {} });
    await expect(outlineCall(u.userId, "documents.info")).rejects.toMatchObject({ code: "outline_rejected" });
    expect(isOutlineHidden(new Error("x"))).toBe(false);
  });

  it("never sends any token but the acting user's (two users, two tokens)", async () => {
    const a = await newUser();
    const b = await newUser();
    await connect(a);
    const aTok = stub.lastIssued()!.accessToken;
    await connect(b);
    const bTok = stub.lastIssued()!.accessToken;
    stub.apiCalls.length = 0;
    await outlineCall(a.userId, "documents.info");
    await outlineCall(b.userId, "documents.info");
    expect(stub.apiCalls.map((c) => c.token)).toEqual([aTok, bTok]);
  });
});

describe("log redaction of the OAuth callback", () => {
  it("masks code and state in the URL and the query object, and only on the callback path", async () => {
    expect(redactOutlineOAuthParams("/outline/oauth/callback?code=abc&state=xyz&error=e")).toBe(
      "/outline/oauth/callback?code=[redacted]&state=[redacted]&error=e",
    );
    expect(redactOutlineOAuthParams("/projects?code=abc")).toBe("/projects?code=abc");
    // A trailing slash (or several) must not dodge the redaction.
    expect(redactOutlineOAuthParams("/outline/oauth/callback/?code=abc&state=xyz")).toBe(
      "/outline/oauth/callback/?code=[redacted]&state=[redacted]",
    );
    expect(redactOutlineOAuthParams("/outline/oauth/callback//?code=abc")).toBe("/outline/oauth/callback//?code=[redacted]");

    const lines: string[] = [];
    const logger = pino({ level: "info" }, { write: (chunk: string) => void lines.push(chunk) });
    const logged = createApp({ logger });
    await request(logged).get("/outline/oauth/callback?code=SECRETCODE123&state=SECRETSTATE456AAAAAAAA");
    const text = lines.join("\n");
    expect(text).toContain("/outline/oauth/callback");
    expect(text).not.toContain("SECRETCODE123");
    expect(text).not.toContain("SECRETSTATE456AAAAAAAA");
  });
});
