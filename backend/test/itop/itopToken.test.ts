// Personal iTop token management (src/routes/itopUser.ts, mounted at
// /itop/me). Exercises the email-match rule that lets a TAM save their own
// personal token (never someone else's), the never-echo-the-token
// invariant, DELETE, and the best-effort expiry read. See
// docs/archive/plans/itop-integration.md Task 5.1 and
// docs/archive/plans/itop-integration-spec.md "What one action looks like".
import "../env.js";
import type { Server } from "node:http";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { env } from "../../src/env.js";
import { prisma } from "../../src/prisma.js";
import { signToken } from "../../src/http/auth.js";
import { bustItopConfigCache } from "../../src/lib/itop/config.js";
import { createUserWithRole, seedRoles } from "../testAuth.js";
import { createFakeItop, seedFakeItop, type FakeItopState, FAKE_ITOP_TOKENS } from "./fakeItop.js";

const app = createApp();

// Shared with test/itop/sync.test.ts and test/itopAdmin.test.ts — the fake
// iTop seed's fixed Person/User emails are the only User rows any of these
// files need to reclaim between tests (every other user any suite creates
// carries an auto-generated, timestamp-unique email).
const ITOP_FIXTURE_EMAILS = [
  "rina.s@example.co.id",
  "dedi.p@example.co.id",
  "budi.h@example.co.id",
  "orphan.contact@example.co.id",
];

async function resetItopTestState(): Promise<void> {
  await prisma.user.deleteMany({ where: { email: { in: ITOP_FIXTURE_EMAILS } } });
  await prisma.itopConfig.deleteMany({ where: { id: "default" } });
  bustItopConfigCache();
}

let fakeServer: Server | undefined;
let fakeState: FakeItopState;

async function startFake(state: FakeItopState): Promise<string> {
  const { listen } = createFakeItop(state);
  const { server, baseUrl } = await listen(0);
  fakeServer = server;
  fakeState = state;
  return baseUrl;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function configureItop(baseUrl: string): Promise<void> {
  await prisma.itopConfig.upsert({
    where: { id: "default" },
    create: { id: "default", baseUrl },
    update: { baseUrl },
  });
  bustItopConfigCache();
}

let userCounter = 0;

/** Creates a TAM user with a caller-chosen (fixed) email — testAuth's own
 * createUserWithRole always generates a unique email, which can't exercise
 * the email-match rule this file is testing. */
async function createUserWithEmail(email: string): Promise<{ userId: number; token: string }> {
  const role = await prisma.role.findUniqueOrThrow({ where: { roleName: "TAM" } });
  userCounter += 1;
  const user = await prisma.user.create({
    data: {
      username: `itop-token-test-${userCounter}-${Date.now()}`,
      email,
      passwordHash: null,
      roleId: role.id,
      active: true,
    },
  });
  const token = signToken({ sub: user.id, ver: 0 });
  return { userId: user.id, token };
}

function call(method: "get" | "put" | "delete", path: string, token?: string, body?: unknown) {
  let req = request(app)[method](path);
  if (token) req = req.set("Authorization", `Bearer ${token}`);
  if (body !== undefined) req = req.send(body as Record<string, unknown>);
  return req;
}

beforeAll(async () => {
  await seedRoles();
});

beforeEach(async () => {
  await resetItopTestState();
  const baseUrl = await startFake(seedFakeItop());
  await configureItop(baseUrl);
});

afterEach(async () => {
  if (fakeServer) {
    await closeServer(fakeServer);
    fakeServer = undefined;
  }
});

describe("access control", () => {
  it("401s every route without a token", async () => {
    expect((await call("get", "/itop/me/token")).status).toBe(401);
    expect((await call("put", "/itop/me/token", undefined, { token: "x".repeat(20) })).status).toBe(401);
    expect((await call("delete", "/itop/me/token")).status).toBe(401);
  });
});

describe("task:write gating", () => {
  // A personal token is only ever used for writes, so a user who can't write
  // (STAKEHOLDER, PENDING) must not store one: PUT is 403. GET stays open so
  // the Settings UI can render "not applicable" instead of erroring, and DELETE
  // is open so anyone can remove a token they already have stored.
  for (const roleName of ["STAKEHOLDER", "PENDING"]) {
    it(`${roleName}: PUT 403, GET 200 and nothing stored`, async () => {
      const { userId, token } = await createUserWithRole(roleName);

      const put = await call("put", "/itop/me/token", token, { token: FAKE_ITOP_TOKENS.rina });
      expect(put.status).toBe(403);
      expect(put.body.code).toBe("forbidden");

      const get = await call("get", "/itop/me/token", token);
      expect(get.status).toBe(200);
      expect(get.body.set).toBe(false);

      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(user.itopTokenEnc).toBeNull();
    });

    it(`${roleName}: DELETE removes a token that is still stored (e.g. after losing task:write)`, async () => {
      const { userId, token } = await createUserWithRole(roleName);
      await prisma.user.update({
        where: { id: userId },
        data: { itopTokenEnc: "v1:left-over", itopTokenPersonName: "Rina S." },
      });

      const del = await call("delete", "/itop/me/token", token);
      expect(del.status).toBe(204);

      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(user.itopTokenEnc).toBeNull();
      expect(user.itopTokenPersonName).toBeNull();
      expect((await call("get", "/itop/me/token", token)).body.set).toBe(false);
    });
  }
});

describe("PUT /itop/me/token", () => {
  it("accepts a token for a user whose email matches the iTop person, and stores it", async () => {
    const { userId, token } = await createUserWithEmail("rina.s@example.co.id");

    const res = await call("put", "/itop/me/token", token, { token: FAKE_ITOP_TOKENS.rina });

    expect(res.status).toBe(200);
    expect(res.body.set).toBe(true);
    expect(res.body.personName).toBe("Rina S.");
    expect(res.body.checkedAt).not.toBeNull();

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.itopPersonId).toBe(1);
    expect(user.itopTokenEnc).toBeTruthy();
    expect(user.itopTokenPersonName).toBe("Rina S.");
  });

  it("rejects the same token for a user whose email isn't an iTop person, and stores nothing", async () => {
    const { userId, token } = await createUserWithEmail("nobody-in-itop@example.com");

    const res = await call("put", "/itop/me/token", token, { token: FAKE_ITOP_TOKENS.rina });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("itop_token_not_yours");

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.itopTokenEnc).toBeNull();
    expect(user.itopPersonId).toBeNull();
  });

  it("rejects a token iTop itself doesn't recognize", async () => {
    const { userId, token } = await createUserWithEmail("rina.s@example.co.id");

    const res = await call("put", "/itop/me/token", token, { token: "not-a-real-itop-token-at-all" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("itop_token_invalid");

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.itopTokenEnc).toBeNull();
  });

  it("rejects a valid token that belongs to a different iTop person than already linked", async () => {
    const { userId, token } = await createUserWithEmail("rina.s@example.co.id");
    const first = await call("put", "/itop/me/token", token, { token: FAKE_ITOP_TOKENS.rina });
    expect(first.status).toBe(200);

    // Simulate the Solvro account's email having moved on since — the
    // itopPersonId recorded from the first save stays put.
    await prisma.user.update({ where: { id: userId }, data: { email: "dedi.p@example.co.id" } });

    const second = await call("put", "/itop/me/token", token, { token: FAKE_ITOP_TOKENS.dedi });
    expect(second.status).toBe(400);
    expect(second.body.code).toBe("itop_token_not_yours");
  });

  it("reads the personal token's expiry when iTop reports one", async () => {
    const { token } = await createUserWithEmail("rina.s@example.co.id");

    const res = await call("put", "/itop/me/token", token, { token: FAKE_ITOP_TOKENS.rina });

    expect(res.status).toBe(200);
    expect(res.body.expiresAt).not.toBeNull();
    const daysAhead = (new Date(res.body.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysAhead).toBeGreaterThan(30);
  });

  it("min-length-validates the token body", async () => {
    const { token } = await createUserWithEmail("rina.s@example.co.id");
    const res = await call("put", "/itop/me/token", token, { token: "short" });
    expect(res.status).toBe(400);
  });

  it("refuses a token that can read the person by email but isn't that person's OWN personal token", async () => {
    // FAKE_ITOP_TOKENS.imposter nominally belongs to person 2 (Dedi) in the
    // fake, same as FAKE_ITOP_TOKENS.dedi — but a Solvro account whose email
    // matches Rina (person 1) still resolves Person-by-email to Rina
    // (that lookup ignores which token asked). The ownership corroboration
    // step then queries PersonalToken WHERE user_id=<Rina's iTop user> WITH
    // THIS token, which — per the fake's per-token scoping — can only see
    // its own user's row (Dedi's), so it comes back empty and the save is
    // refused, even though the earlier Person lookup "worked".
    const { userId, token } = await createUserWithEmail("rina.s@example.co.id");

    const res = await call("put", "/itop/me/token", token, { token: FAKE_ITOP_TOKENS.imposter });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("itop_token_not_yours");

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.itopTokenEnc).toBeNull();
  });

  // The Person lookup matches on email only, so it does not prove whose token
  // this is; the iTop User and its PersonalToken do. When the token cannot
  // read either, ownership is unproven: refused by default, accepted only
  // with ITOP_ALLOW_UNVERIFIED_PERSONAL_TOKENS.
  describe("a token whose ownership cannot be proven", () => {
    async function withUnverifiedAllowed<T>(allow: boolean, fn: () => Promise<T>): Promise<T> {
      const previous = env.ITOP_ALLOW_UNVERIFIED_PERSONAL_TOKENS;
      env.ITOP_ALLOW_UNVERIFIED_PERSONAL_TOKENS = allow;
      try {
        return await fn();
      } finally {
        env.ITOP_ALLOW_UNVERIFIED_PERSONAL_TOKENS = previous;
      }
    }

    for (const cls of ["PersonalToken", "User"]) {
      it(`is refused by default when the ${cls} class isn't readable`, async () => {
        fakeState.disabledClasses.add(cls);
        const { userId, token } = await createUserWithEmail("rina.s@example.co.id");

        const res = await call("put", "/itop/me/token", token, { token: FAKE_ITOP_TOKENS.rina });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe("itop_token_unverified");
        const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
        expect(user.itopTokenEnc).toBeNull();
      });

      it(`is accepted when the deployment allows it and the ${cls} class isn't readable`, async () => {
        fakeState.disabledClasses.add(cls);
        const { token } = await createUserWithEmail("rina.s@example.co.id");

        const res = await withUnverifiedAllowed(true, () =>
          call("put", "/itop/me/token", token, { token: FAKE_ITOP_TOKENS.rina }),
        );

        expect(res.status).toBe(200);
        expect(res.body.set).toBe(true);
        expect(res.body.expiresAt).toBeNull();
      });
    }

    it("treats a readable User class with no row for this Person as unverified", async () => {
      // Real iTop can answer a class the profile may not see with an empty set.
      fakeState.users.delete(1);
      const { token } = await createUserWithEmail("rina.s@example.co.id");

      const refused = await call("put", "/itop/me/token", token, { token: FAKE_ITOP_TOKENS.rina });
      expect(refused.status).toBe(400);
      expect(refused.body.code).toBe("itop_token_unverified");

      const accepted = await withUnverifiedAllowed(true, () =>
        call("put", "/itop/me/token", token, { token: FAKE_ITOP_TOKENS.rina }),
      );
      expect(accepted.status).toBe(200);
    });

    it("is still refused when the PersonalToken read shows the token is someone else's, even if allowed", async () => {
      // The allowance covers an unreadable class only, never a disproof.
      const { token } = await createUserWithEmail("rina.s@example.co.id");
      const res = await withUnverifiedAllowed(true, () =>
        call("put", "/itop/me/token", token, { token: FAKE_ITOP_TOKENS.app }),
      );
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("itop_token_not_yours");
    });
  });

  it("rate-limits repeated PUT calls to 10 per 10 minutes for the same user", async () => {
    const { token } = await createUserWithEmail("rina.s@example.co.id");

    for (let i = 0; i < 10; i++) {
      const res = await call("put", "/itop/me/token", token, { token: FAKE_ITOP_TOKENS.rina });
      expect(res.status, `attempt ${i + 1}`).toBe(200);
    }

    const eleventh = await call("put", "/itop/me/token", token, { token: FAKE_ITOP_TOKENS.rina });
    expect(eleventh.status).toBe(429);
    expect(eleventh.body.code).toBe("rate_limited");
  });
});

describe("GET /itop/me/token", () => {
  it("never returns the token or its ciphertext", async () => {
    const { token } = await createUserWithEmail("rina.s@example.co.id");
    await call("put", "/itop/me/token", token, { token: FAKE_ITOP_TOKENS.rina });

    const res = await call("get", "/itop/me/token", token);
    expect(res.status).toBe(200);
    expect(res.body.set).toBe(true);

    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(FAKE_ITOP_TOKENS.rina);
    expect(raw).not.toContain("v1:"); // secretBox's sealed-format prefix
  });

  it("reports unset with no token saved", async () => {
    const { token } = await createUserWithEmail("rina.s@example.co.id");
    const res = await call("get", "/itop/me/token", token);
    expect(res.status).toBe(200);
    expect(res.body.set).toBe(false);
    expect(res.body.personName).toBeNull();
  });

  it("reports unreadable:true when the stored ciphertext can no longer be decrypted", async () => {
    const { userId, token } = await createUserWithEmail("rina.s@example.co.id");
    await call("put", "/itop/me/token", token, { token: FAKE_ITOP_TOKENS.rina });

    // Simulate a SECRETS_KEY rotation / corrupted ciphertext — same shape
    // secretBox's seal() produces, but not decryptable with any key.
    await prisma.user.update({ where: { id: userId }, data: { itopTokenEnc: "v1:not-a-real-iv:bad-tag:bad-ciphertext" } });

    const res = await call("get", "/itop/me/token", token);
    expect(res.status).toBe(200);
    expect(res.body.set).toBe(false);
    expect(res.body.unreadable).toBe(true);
  });
});

describe("DELETE /itop/me/token", () => {
  it("clears the stored token", async () => {
    const { userId, token } = await createUserWithEmail("rina.s@example.co.id");
    await call("put", "/itop/me/token", token, { token: FAKE_ITOP_TOKENS.rina });

    const del = await call("delete", "/itop/me/token", token);
    expect(del.status).toBe(204);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.itopTokenEnc).toBeNull();
    expect(user.itopTokenPersonName).toBeNull();
    expect(user.itopTokenCheckedAt).toBeNull();
    expect(user.itopTokenExpiresAt).toBeNull();

    const res = await call("get", "/itop/me/token", token);
    expect(res.body.set).toBe(false);
  });
});
