// Session revocation (docs/archive/plans/internal-sync.md):
// a JWT must stop working when the account's password changes, an admin
// resets it, the role changes, the account is deactivated, or the account is
// deleted. http/auth.ts checks the account on every request and compares
// the token's `ver` claim with User.tokenVersion.
import "./env.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { env } from "../src/env.js";
import { createAdminAndToken, createUserWithRole, seedRoles } from "./testAuth.js";

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const PASSWORD = "old-password-123";

beforeAll(async () => {
  await seedRoles();
});

/** A password-login user (the test helpers create password-less users). */
async function passwordUser(roleName: string) {
  const role = await prisma.role.findUniqueOrThrow({ where: { roleName } });
  const stamp = `${Date.now()}-${Math.random()}`;
  const user = await prisma.user.create({
    data: {
      username: `rev-${stamp}`,
      email: `rev-${stamp}@example.com`,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      roleId: role.id,
    },
  });
  const login = await request(app).post("/auth/login").send({ email: user.email, password: PASSWORD });
  expect(login.status).toBe(200);
  return { userId: user.id, email: user.email, token: login.body.token as string };
}

const me = (token: string) => request(app).get("/auth/me").set(auth(token));

describe("session revocation", () => {
  it("a login token verifies and carries only sub and ver", async () => {
    const u = await passwordUser("TAM");
    const claims = jwt.verify(u.token, env.JWT_SECRET) as Record<string, unknown>;
    expect(claims.sub).toBe(u.userId);
    expect(claims.ver).toBe(0);
    expect(claims).not.toHaveProperty("role");
    expect(claims).not.toHaveProperty("permissions");
    expect((await me(u.token)).status).toBe(200);
  });

  it("changing the password ends every other session and hands the caller a fresh token", async () => {
    const u = await passwordUser("TAM");
    const otherDevice = await request(app).post("/auth/login").send({ email: u.email, password: PASSWORD });
    const change = await request(app)
      .post("/auth/change-password")
      .set(auth(u.token))
      .send({ currentPassword: PASSWORD, newPassword: "new-password-456" });
    expect(change.status).toBe(200);
    expect(typeof change.body.token).toBe("string");

    for (const stale of [u.token, otherDevice.body.token as string]) {
      const res = await me(stale);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("token_revoked");
    }
    const fresh = await me(change.body.token);
    expect(fresh.status).toBe(200);
    expect(fresh.body.id).toBe(u.userId);
    expect((jwt.verify(change.body.token, env.JWT_SECRET) as { ver: number }).ver).toBe(1);

    const relogin = await request(app).post("/auth/login").send({ email: u.email, password: "new-password-456" });
    expect(relogin.status).toBe(200);
    expect((await me(relogin.body.token)).status).toBe(200);
  });

  it("an admin password reset ends the account's sessions", async () => {
    const admin = await createAdminAndToken();
    const u = await passwordUser("TAM");
    const reset = await request(app).post(`/admin/users/${u.userId}/reset-password`).set(auth(admin.token)).send({});
    expect(reset.status).toBe(200);
    const stale = await me(u.token);
    expect(stale.status).toBe(401);
    expect(stale.body.code).toBe("token_revoked");
  });

  it("deactivating the account ends its sessions for good: reactivating does not resurrect old tokens", async () => {
    const admin = await createAdminAndToken();
    const u = await passwordUser("STAKEHOLDER");
    await request(app).patch(`/admin/users/${u.userId}/deactivate`).set(auth(admin.token)).send({ active: false });
    const stale = await me(u.token);
    expect(stale.status).toBe(401);
    expect(stale.body.code).toBe("account_disabled");
    await request(app).patch(`/admin/users/${u.userId}/deactivate`).set(auth(admin.token)).send({ active: true });
    const afterReactivation = await me(u.token);
    expect(afterReactivation.status).toBe(401);
    expect(afterReactivation.body.code).toBe("token_revoked");
    const relogin = await request(app).post("/auth/login").send({ email: u.email, password: PASSWORD });
    expect(relogin.status).toBe(200);
    expect((await me(relogin.body.token)).status).toBe(200);
  });

  it("an admin cannot reset their own password from the admin tree", async () => {
    const admin = await passwordUser("ADMIN");
    const res = await request(app).post(`/admin/users/${admin.userId}/reset-password`).set(auth(admin.token)).send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("self_reset");
    expect((await me(admin.token)).status).toBe(200);
  });

  it("a deactivated admin's token cannot reset anyone's password", async () => {
    const admin = await createAdminAndToken();
    const victim = await passwordUser("TAM");
    const rogue = await passwordUser("ADMIN");
    await request(app).patch(`/admin/users/${rogue.userId}/deactivate`).set(auth(admin.token)).send({ active: false });
    const res = await request(app).post(`/admin/users/${victim.userId}/reset-password`).set(auth(rogue.token)).send({});
    expect(res.status).toBe(401);
    expect((await me(victim.token)).status).toBe(200);
  });

  it("a role change applies to live sessions: the same token loses project:write", async () => {
    const admin = await createAdminAndToken();
    const u = await passwordUser("TAM");
    const customer = await prisma.customer.create({ data: { name: `rev-c-${Date.now()}`, description: "d", tamId: u.userId } });
    const project = await prisma.project.create({
      data: { name: `rev-p-${Date.now()}`, tamId: u.userId, customerId: customer.id, status: "ACTIVE" },
    });
    expect(
      (await request(app).patch(`/projects/${project.id}`).set(auth(u.token)).send({ description: "before" })).status,
    ).toBe(200);

    await request(app).patch(`/admin/users/${u.userId}/role`).set(auth(admin.token)).send({ role: "STAKEHOLDER" });

    const after = await request(app).patch(`/projects/${project.id}`).set(auth(u.token)).send({ description: "after" });
    expect(after.status).toBe(403);
    expect(after.body.code).toBe("forbidden");
    const profile = await me(u.token);
    expect(profile.status).toBe(200);
    expect(profile.body.role).toBe("STAKEHOLDER");
  });

  it("a deleted account's token is refused everywhere", async () => {
    const admin = await createAdminAndToken();
    const u = await passwordUser("TAM");
    const del = await request(app).delete(`/admin/users/${u.userId}`).set(auth(admin.token));
    expect(del.status).toBe(204);
    for (const path of ["/auth/me", "/customers", "/projects"]) {
      const res = await request(app).get(path).set(auth(u.token));
      expect(res.status, path).toBe(401);
      expect(res.body.code, path).toBe("unauthenticated");
    }
    const write = await request(app).post("/customers").set(auth(u.token)).send({ name: "ghost", description: "d" });
    expect(write.status).toBe(401);
  });

  it("one request through stacked routers resolves the account once", async () => {
    // /projects carries four routers (app.ts), each with its own requireAuth.
    const u = await createUserWithRole("TAM");
    const customer = await prisma.customer.create({ data: { name: `rev-s-${Date.now()}`, description: "d", tamId: u.userId } });
    const project = await prisma.project.create({
      data: { name: `rev-sp-${Date.now()}`, tamId: u.userId, customerId: customer.id, status: "ACTIVE" },
    });
    const original = prisma.user.findUnique.bind(prisma.user);
    let lookups = 0;
    const spy = ((args: Parameters<typeof original>[0]) => {
      if (args.select && "tokenVersion" in args.select) lookups += 1;
      return original(args);
    }) as typeof original;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.user as any).findUnique = spy;
    try {
      const res = await request(app).get(`/projects/${project.id}/activity`).set(auth(u.token));
      expect(res.status).toBe(200);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.user as any).findUnique = original;
    }
    expect(lookups).toBe(1);
  });

  it("a token minted before the version claim existed is refused", async () => {
    const u = await createUserWithRole("TAM");
    const legacy = jwt.sign({ sub: u.userId, role: "TAM", permissions: ["*"] }, env.JWT_SECRET, { expiresIn: "1h" });
    const res = await me(legacy);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("token_revoked");
  });

  it("a token with a stale version is refused even though the signature is valid", async () => {
    const u = await createUserWithRole("TAM");
    await prisma.user.update({ where: { id: u.userId }, data: { tokenVersion: { increment: 1 } } });
    const res = await me(u.token); // signed with ver 0
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("token_revoked");
  });
});
