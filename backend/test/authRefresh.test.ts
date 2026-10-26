// POST /auth/refresh — extends a live session by issuing a fresh token.
import "./env.js";
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { env } from "../src/env.js";
import { signToken } from "../src/http/auth.js";
import { refreshRateLimiter } from "../src/routes/auth.js";
import { createUserWithRole, seedRoles } from "./testAuth.js";

const app = createApp();

function decode(token: string) {
  return jwt.decode(token, { complete: true }) as {
    header: { alg: string };
    payload: { sub: number; ver: number; exp: number; iat: number; auth_time?: number };
  };
}

describe("POST /auth/refresh", () => {
  beforeEach(async () => {
    await seedRoles();
    refreshRateLimiter.reset();
  });

  it("answers a fresh HS256 token with the same claims and a later expiry", async () => {
    const { userId } = await createUserWithRole("TAM");
    // A token issued 2 hours ago (exp 6 hours out).
    const aged = jwt.sign(
      { sub: userId, ver: 0, iat: Math.floor(Date.now() / 1000) - 7200 },
      env.JWT_SECRET,
      { expiresIn: "8h" },
    );

    const res = await request(app).post("/auth/refresh").set("Authorization", `Bearer ${aged}`);
    expect(res.status).toBe(200);
    const fresh = decode(res.body.token as string);
    expect(fresh.header.alg).toBe("HS256");
    expect(fresh.payload.sub).toBe(userId);
    expect(fresh.payload.ver).toBe(0);
    expect(fresh.payload.exp).toBeGreaterThan(decode(aged).payload.exp);
    // Lifetime equals a fresh sign-in's (8h in tests), never longer.
    expect(fresh.payload.exp - fresh.payload.iat).toBe(8 * 3600);
    // The new token works.
    const me = await request(app).get("/auth/me").set("Authorization", `Bearer ${res.body.token}`);
    expect(me.status).toBe(200);
  });

  it("rejects a missing, expired, tampered or alg=none token with 401", async () => {
    const { userId } = await createUserWithRole("TAM");
    const expired = jwt.sign({ sub: userId, ver: 0 }, env.JWT_SECRET, { expiresIn: -10 });
    const wrongKey = jwt.sign({ sub: userId, ver: 0 }, "another-secret-another-secret-123456");
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url")}.${Buffer.from(
      JSON.stringify({ sub: userId, ver: 0, exp: Math.floor(Date.now() / 1000) + 600 }),
    ).toString("base64url")}.`;
    const hs512 = jwt.sign({ sub: userId, ver: 0 }, env.JWT_SECRET, { algorithm: "HS512" });
    for (const header of [undefined, `Bearer ${expired}`, `Bearer ${wrongKey}`, `Bearer ${none}`, `Bearer ${hs512}`, "Bearer junk"]) {
      const req = request(app).post("/auth/refresh");
      const res = header ? await req.set("Authorization", header) : await req;
      expect(res.status, String(header)).toBe(401);
      expect(res.body.token).toBeUndefined();
    }
  });

  it("rejects an inactive account, a revoked token version and a deleted user", async () => {
    const inactive = await createUserWithRole("TAM");
    await prisma.user.update({ where: { id: inactive.userId }, data: { active: false } });
    const r1 = await request(app).post("/auth/refresh").set("Authorization", `Bearer ${inactive.token}`);
    expect(r1.status).toBe(401);
    expect(r1.body.code).toBe("account_disabled");

    const revoked = await createUserWithRole("TAM");
    await prisma.user.update({ where: { id: revoked.userId }, data: { tokenVersion: { increment: 1 } } });
    const r2 = await request(app).post("/auth/refresh").set("Authorization", `Bearer ${revoked.token}`);
    expect(r2.status).toBe(401);
    expect(r2.body.code).toBe("token_revoked");

    const gone = await createUserWithRole("TAM");
    await prisma.user.delete({ where: { id: gone.userId } });
    const r3 = await request(app).post("/auth/refresh").set("Authorization", `Bearer ${signToken({ sub: gone.userId, ver: 0 })}`);
    expect(r3.status).toBe(401);
  });

  it("is throttled per client address", async () => {
    const { token } = await createUserWithRole("TAM");
    let last = 200;
    for (let i = 0; i < 61; i++) {
      const res = await request(app).post("/auth/refresh").set("X-Forwarded-For", "198.51.100.9").set("Authorization", `Bearer ${token}`);
      last = res.status;
    }
    expect(last).toBe(429);
  });

  it("sign-in tokens carry auth_time", async () => {
    const bcrypt = (await import("bcrypt")).default;
    const role = await prisma.role.findUniqueOrThrow({ where: { roleName: "TAM" } });
    const email = `refresh-login-${Date.now()}@example.com`;
    await prisma.user.create({
      data: { username: `refresh-login-${Date.now()}`, email, passwordHash: await bcrypt.hash("Correct-Horse-1", 4), roleId: role.id, active: true },
    });
    const res = await request(app).post("/auth/login").send({ email, password: "Correct-Horse-1" });
    expect(res.status).toBe(200);
    const p = decode(res.body.token as string).payload;
    expect(Math.abs((p.auth_time ?? 0) - p.iat)).toBeLessThanOrEqual(1);
  });

  it("preserves auth_time and caps exp at auth_time + 24h", async () => {
    const { userId } = await createUserWithRole("TAM");
    const now = Math.floor(Date.now() / 1000);
    const authTime = now - 20 * 3600; // cap is 4h away, less than the 8h lifetime
    const t = jwt.sign({ sub: userId, ver: 0, auth_time: authTime, exp: now + 600 }, env.JWT_SECRET);
    const r1 = await request(app).post("/auth/refresh").set("Authorization", `Bearer ${t}`);
    expect(r1.status).toBe(200);
    const p1 = decode(r1.body.token as string).payload;
    expect(p1.auth_time).toBe(authTime);
    expect(p1.exp).toBe(authTime + 24 * 3600);
    // The token now expires exactly at the cap: nothing left to extend.
    const r3 = await request(app).post("/auth/refresh").set("Authorization", `Bearer ${r1.body.token}`);
    expect(r3.status).toBe(409);
    expect(r3.body.code).toBe("session_max_age");
  });

  it("keeps auth_time across successive refreshes", async () => {
    const { userId } = await createUserWithRole("TAM");
    const authTime = Math.floor(Date.now() / 1000) - 2 * 3600;
    const t = jwt.sign({ sub: userId, ver: 0, auth_time: authTime, exp: authTime + 3600 + 3600 * 1.9 }, env.JWT_SECRET);
    const r1 = await request(app).post("/auth/refresh").set("Authorization", `Bearer ${t}`);
    expect(r1.status).toBe(200);
    const r2 = await request(app).post("/auth/refresh").set("Authorization", `Bearer ${r1.body.token}`);
    expect(r2.status).toBe(200);
    expect(decode(r2.body.token as string).payload.auth_time).toBe(authTime);
  });

  it("refuses with session_max_age once 24h have passed since sign-in", async () => {
    const { userId } = await createUserWithRole("TAM");
    const now = Math.floor(Date.now() / 1000);
    // Unexpired token (exp in the future) whose original sign-in is over 24h old.
    const t = jwt.sign({ sub: userId, ver: 0, auth_time: now - 25 * 3600, exp: now + 600 }, env.JWT_SECRET);
    const res = await request(app).post("/auth/refresh").set("Authorization", `Bearer ${t}`);
    // Past the cap the token is unexpired but its sign-in is over 24h old.
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("session_max_age");
  });

  it("a token without auth_time (pre-cap) is refreshable, measured from its iat", async () => {
    const { userId } = await createUserWithRole("TAM");
    const now = Math.floor(Date.now() / 1000);
    const legacy = jwt.sign({ sub: userId, ver: 0, iat: now - 2 * 3600 }, env.JWT_SECRET, { expiresIn: "8h" });
    const res = await request(app).post("/auth/refresh").set("Authorization", `Bearer ${legacy}`);
    expect(res.status).toBe(200);
    expect(decode(res.body.token as string).payload.auth_time).toBe(now - 2 * 3600);
  });
});
