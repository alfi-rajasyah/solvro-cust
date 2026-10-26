// Sign-in identity edge cases: email case, username case races, the
// P2002 response body, hidden-customer name conflicts and the JWT algorithm.
import "./env.js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { env } from "../src/env.js";
import { createAdminAndToken, createUserWithRole, seedRoles } from "./testAuth.js";

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const stamp = Date.now();

beforeAll(async () => {
  await seedRoles();
});

async function signInWithGoogle(email: string, sub: string) {
  const { OAuth2Client } = await import("google-auth-library");
  const { bustAuthConfigCache } = await import("../src/authConfig.js");
  const domains = ["example.com"];
  await prisma.authConfig.upsert({
    where: { id: "default" },
    update: { googleClientId: "test-client.apps.googleusercontent.com", googleAllowedDomains: domains },
    create: { id: "default", googleClientId: "test-client.apps.googleusercontent.com", googleAllowedDomains: domains },
  });
  bustAuthConfigCache();
  vi.spyOn(OAuth2Client.prototype, "verifyIdToken").mockResolvedValue({
    getPayload: () => ({ email, email_verified: true, sub }),
  } as never);
  try {
    return await request(app).post("/auth/google").send({ idToken: "fake" });
  } finally {
    vi.restoreAllMocks();
    bustAuthConfigCache();
  }
}

describe("email case", () => {
  it("stores admin-created emails lowercase so Google sign-in lands on the same account", async () => {
    const admin = await createAdminAndToken();
    const mixed = `  Foo.Case${stamp}@Example.com `;
    const lower = `foo.case${stamp}@example.com`;
    const created = await request(app)
      .post("/admin/users")
      .set(auth(admin.token))
      .send({ email: mixed, username: `foocase${stamp}`, password: "Correct-Horse-1", role: "TAM" });
    expect(created.status).toBe(201);
    expect(created.body.email).toBe(lower);

    const g = await signInWithGoogle(lower, `sub-case-${stamp}`);
    expect(g.status).toBe(200);
    expect(await prisma.user.count({ where: { email: { equals: lower, mode: "insensitive" } } })).toBe(1);

    const pw = await request(app)
      .post("/auth/login")
      .send({ email: `FOO.CASE${stamp}@EXAMPLE.COM`, password: "Correct-Horse-1" });
    expect(pw.status).toBe(200);
  });
});

describe("username case race", () => {
  it("lets exactly one of two concurrent case-variant creates win", async () => {
    const admin = await createAdminAndToken();
    const make = (username: string, n: number) =>
      request(app)
        .post("/admin/users")
        .set(auth(admin.token))
        .send({ email: `race${n}-${stamp}@example.com`, username, password: "Correct-Horse-1", role: "TAM" });
    const [a, b] = await Promise.all([make(`RaceUser${stamp}`, 1), make(`raceuser${stamp}`, 2)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.code).toBe("username_in_use");
  });
});

describe("P2002 responses", () => {
  it("answers a hidden and a visible customer name conflict with identical bodies and no meta", async () => {
    const owner = await createUserWithRole("TAM");
    const other = await createUserWithRole("TAM");
    const hiddenName = `Hidden Co ${stamp}`;
    const visibleName = `Visible Co ${stamp}`;
    await prisma.customer.create({ data: { name: hiddenName, description: "d", tamId: owner.userId } });
    await prisma.customer.create({ data: { name: visibleName, description: "d", tamId: other.userId } });

    const post = (name: string) =>
      request(app).post("/customers").set(auth(other.token)).send({ name, description: "d" });
    const hidden = await post(hiddenName);
    const visible = await post(visibleName);
    expect(hidden.status).toBe(409);
    expect(visible.status).toBe(409);
    expect(JSON.stringify(hidden.body)).toBe(JSON.stringify(visible.body));
    expect(hidden.body.details).toBeUndefined();
  });
});

describe("JWT algorithm", () => {
  it("rejects a token signed with HS512 and accepts a normal one", async () => {
    const { userId, token } = await createUserWithRole("TAM");
    const good = await request(app).get("/auth/me").set(auth(token));
    expect(good.status).toBe(200);
    const forged = jwt.sign({ sub: userId, ver: 0 }, env.JWT_SECRET, { algorithm: "HS512" });
    const bad = await request(app).get("/auth/me").set(auth(forged));
    expect(bad.status).toBe(401);
  });
});
