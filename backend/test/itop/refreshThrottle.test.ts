// POST /itop/refresh requests a full pull, so it is limited per user and by a
// global floor, answering 429 with Retry-After.
import "../env.js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/prisma.js";
import { seal } from "../../src/lib/secretBox.js";
import { bustItopConfigCache } from "../../src/lib/itop/config.js";
import { resetRefreshThrottle } from "../../src/routes/itop.js";
import { seedRoles, createUserWithRole } from "../testAuth.js";

const app = createApp();

function refresh(token: string) {
  return request(app).post("/itop/refresh").set("Authorization", `Bearer ${token}`).send({});
}

beforeAll(async () => {
  await seedRoles();
});

beforeEach(async () => {
  resetRefreshThrottle();
  await prisma.itopConfig.upsert({
    where: { id: "default" },
    create: { id: "default", baseUrl: "https://itop.example.com", appTokenEnc: seal("app-token") },
    update: { baseUrl: "https://itop.example.com", appTokenEnc: seal("app-token") },
  });
  bustItopConfigCache();
});

describe("POST /itop/refresh throttling", () => {
  it("accepts a first refresh, then answers 429 with Retry-After to the same user", async () => {
    const { token } = await createUserWithRole("TAM");
    const first = await refresh(token);
    expect(first.status).toBe(202);
    expect(first.body.requested).toBe(true);

    const second = await refresh(token);
    expect(second.status).toBe(429);
    expect(second.body.code).toBe("rate_limited");
    // The global minute floor outlasts the 30 s per-user cooldown.
    expect(Number(second.headers["retry-after"])).toBeGreaterThan(30);
  });

  it("holds a global floor: a different user is refused right after someone else's accepted refresh", async () => {
    const a = await createUserWithRole("TAM");
    const b = await createUserWithRole("TAM");
    expect((await refresh(a.token)).status).toBe(202);

    const other = await refresh(b.token);
    expect(other.status).toBe(429);
    const retryAfter = Number(other.headers["retry-after"]);
    expect(retryAfter).toBeGreaterThan(30);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it("a refused call does not extend the window or start a pull", async () => {
    const a = await createUserWithRole("TAM");
    expect((await refresh(a.token)).status).toBe(202);
    const r1 = Number((await refresh(a.token)).headers["retry-after"]);
    const r2 = Number((await refresh(a.token)).headers["retry-after"]);
    expect(r2).toBeLessThanOrEqual(r1);
  });
});
