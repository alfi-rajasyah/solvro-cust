// Sign-in throttling and the uniform rejection answer (routes/auth.ts,
// http/loginThrottle.ts). Before this existed, 120 wrong passwords in a row
// were all answered 401 at ~18 attempts/s from one client, the correct
// password still signed in afterwards, and a Google-only account answered a
// distinct `google_only` code that revealed which emails exist.
import "./env.js";
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcrypt";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { seedRoles } from "./testAuth.js";
import {
  LOGIN_FAILURES_PER_EMAIL,
  LOGIN_FAILURES_PER_IP,
  resetLoginThrottlesForTests,
} from "../src/routes/auth.js";
import { createFailureThrottle } from "../src/http/loginThrottle.js";
import { vi } from "vitest";

const app = createApp();
const PASSWORD = "Correct-Horse-Battery-1";

let counter = 0;
async function passwordUser(): Promise<string> {
  const role = await prisma.role.findUniqueOrThrow({ where: { roleName: "TAM" } });
  counter += 1;
  const email = `login-throttle-${counter}-${Date.now()}@example.com`;
  await prisma.user.create({
    data: {
      username: `login-throttle-${counter}-${Date.now()}`,
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      roleId: role.id,
      active: true,
    },
  });
  return email;
}

async function googleOnlyUser(): Promise<string> {
  const role = await prisma.role.findUniqueOrThrow({ where: { roleName: "TAM" } });
  counter += 1;
  const email = `login-google-${counter}-${Date.now()}@example.com`;
  await prisma.user.create({
    data: {
      username: `login-google-${counter}-${Date.now()}`,
      email,
      passwordHash: null,
      googleSub: `sub-${counter}-${Date.now()}`,
      roleId: role.id,
      active: true,
    },
  });
  return email;
}

function login(email: string, password: string, ip = "203.0.113.10") {
  // `trust proxy` is 1 in tests (env default), so the loopback peer's
  // X-Forwarded-For is the client address the throttle keys on.
  return request(app).post("/auth/login").set("X-Forwarded-For", ip).send({ email, password });
}

describe("POST /auth/login — one answer for every rejected password sign-in", () => {
  beforeEach(async () => {
    await seedRoles();
    resetLoginThrottlesForTests();
  });

  it("answers invalid_credentials for an unknown email, a Google-only account and a wrong password", async () => {
    const google = await googleOnlyUser();
    const pw = await passwordUser();
    const unknown = await login(`nobody-${Date.now()}@example.com`, "x");
    const googleOnly = await login(google, "x");
    const wrong = await login(pw, "not-the-password");
    for (const res of [unknown, googleOnly, wrong]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "Invalid email or password", code: "invalid_credentials" });
    }
  });
});

describe("POST /auth/login — same cost for every rejection", () => {
  it("runs bcrypt.compare for an unknown email and for a Google-only account, so timing does not reveal which emails exist", async () => {
    await seedRoles();
    resetLoginThrottlesForTests();
    const spy = vi.spyOn(bcrypt, "compare");
    try {
      await login(`nobody-${Date.now()}@example.com`, "x");
      expect(spy).toHaveBeenCalledTimes(1);
      const google = await googleOnlyUser();
      await login(google, "x");
      expect(spy).toHaveBeenCalledTimes(2);
      // The dummy compare can never grant access: a Google-only account with the
      // throw-away hash's own plaintext is still refused.
      const res = await login(google, "solvro-timing-equaliser-never-a-real-password");
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("invalid_credentials");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("POST /auth/login — failure throttle", () => {
  beforeEach(async () => {
    await seedRoles();
    resetLoginThrottlesForTests();
  });

  it("blocks an email after LOGIN_FAILURES_PER_EMAIL failures, even with the correct password", async () => {
    const email = await passwordUser();
    for (let i = 0; i < LOGIN_FAILURES_PER_EMAIL; i++) {
      expect((await login(email, `wrong-${i}`)).status).toBe(401);
    }
    const blocked = await login(email, PASSWORD);
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("rate_limited");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);

    // Another email from the same address is unaffected (below the IP limit).
    const other = await passwordUser();
    expect((await login(other, PASSWORD)).status).toBe(200);
  });

  it("a successful sign-in clears the email counter; successes never count", async () => {
    const email = await passwordUser();
    for (let i = 0; i < LOGIN_FAILURES_PER_EMAIL - 1; i++) {
      expect((await login(email, "wrong")).status).toBe(401);
    }
    expect((await login(email, PASSWORD)).status).toBe(200);
    // The counter restarted: the same number of failures is allowed again.
    for (let i = 0; i < LOGIN_FAILURES_PER_EMAIL - 1; i++) {
      expect((await login(email, "wrong")).status).toBe(401);
    }
    expect((await login(email, PASSWORD)).status).toBe(200);
    // Many successes in a row are never throttled.
    for (let i = 0; i < 25; i++) {
      expect((await login(email, PASSWORD)).status).toBe(200);
    }
  });

  it("blocks a client address after LOGIN_FAILURES_PER_IP failures spread over many emails", async () => {
    const ip = "198.51.100.77";
    for (let i = 0; i < LOGIN_FAILURES_PER_IP; i++) {
      const res = await login(`spray-${i}-${Date.now()}@example.com`, "x", ip);
      expect(res.status).toBe(401);
    }
    const email = await passwordUser();
    expect((await login(email, PASSWORD, ip)).status).toBe(429);
    // The same account from another address still signs in.
    expect((await login(email, PASSWORD, "198.51.100.78")).status).toBe(200);
    // The Google route shares the address block.
    const google = await request(app)
      .post("/auth/google")
      .set("X-Forwarded-For", ip)
      .send({ idToken: "anything" });
    expect(google.status).toBe(429);
  });

  it("the email key is case- and whitespace-insensitive", async () => {
    const email = await passwordUser();
    for (let i = 0; i < LOGIN_FAILURES_PER_EMAIL; i++) {
      // Exact email so the account is found; the counter key is normalised.
      expect((await login(email, "wrong")).status).toBe(401);
    }
    // Zod lower-cases nothing, so a differently cased email misses the row —
    // and is still blocked by the shared counter.
    expect((await login(email.toUpperCase(), PASSWORD)).status).toBe(429);
  });
});

describe("createFailureThrottle", () => {
  it("counts failures per key inside a window and forgets them after it", () => {
    const t = createFailureThrottle({ limit: 3, windowMs: 1000 });
    const now = 1_000_000;
    expect(t.blockedFor("a", now)).toBe(0);
    t.recordFailure("a", now);
    t.recordFailure("a", now + 10);
    expect(t.blockedFor("a", now + 20)).toBe(0);
    t.recordFailure("a", now + 30);
    expect(t.blockedFor("a", now + 40)).toBe(1); // ceil(960 ms)
    expect(t.blockedFor("b", now + 40)).toBe(0);
    expect(t.blockedFor("a", now + 1000)).toBe(0); // window over
    t.recordFailure("a", now + 1000); // a fresh window
    expect(t.blockedFor("a", now + 1001)).toBe(0);
    t.clear("a");
    expect(t.size()).toBe(0);
  });

  it("is memory-bounded: at maxKeys the oldest key is evicted", () => {
    const t = createFailureThrottle({ limit: 1, windowMs: 60_000, maxKeys: 3 });
    const now = 5_000_000;
    t.recordFailure("k1", now);
    t.recordFailure("k2", now);
    t.recordFailure("k3", now);
    t.recordFailure("k4", now);
    expect(t.size()).toBe(3);
    expect(t.blockedFor("k1", now)).toBe(0); // evicted
    expect(t.blockedFor("k4", now)).toBeGreaterThan(0);
  });
});
