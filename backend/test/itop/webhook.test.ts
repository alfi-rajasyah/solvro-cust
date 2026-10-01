// The iTop webhook nudge (src/routes/webhook.ts, mounted at /webhook, no
// requireAuth). Exercises the "not configured" 404 (never reveals the route
// exists), the shared-secret check (crypto.timingSafeEqual, wrong length vs
// wrong value both 401), the accepted-call rate limit (max 6/60s), the wider
// all-calls throttle that caps the cost of a flood before the config read
// and decrypt even run (max 60/60s, regardless of secret validity), the
// rejection-warn coalescing (at most one warn log per window for a burst of
// bad-secret calls), that the request body is never parsed or trusted, and
// that rotating the secret invalidates the old one. requestSync() itself is
// mocked — this suite only asserts it was called, not what syncTickets()
// then does (that's sync.test.ts's job). See
// docs/archive/plans/itop-integration.md Task 4.1.
import "../env.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

// vi.mock factories are hoisted above top-level const declarations, so the
// mock fn itself must be created inside vi.hoisted() to be visible here.
const { requestSyncMock } = vi.hoisted(() => ({ requestSyncMock: vi.fn() }));

vi.mock("../../src/lib/itop/scheduler.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/itop/scheduler.js")>();
  return { ...actual, requestSync: requestSyncMock };
});

import { createApp } from "../../src/app.js";
import { prisma } from "../../src/prisma.js";
import { seal } from "../../src/lib/secretBox.js";
import { bustItopConfigCache } from "../../src/lib/itop/config.js";
import {
  resetItopWebhookRateLimitForTests,
  getItopWebhookRejectionWarnCallsForTests,
} from "../../src/routes/webhook.js";
import { seedRoles } from "../testAuth.js";

const app = createApp();
const HEADER = "X-Solvro-Webhook-Secret";

async function clearItopConfig(): Promise<void> {
  await prisma.itopConfig.deleteMany({ where: { id: "default" } });
  bustItopConfigCache();
}

async function setWebhookSecret(secret: string): Promise<void> {
  await prisma.itopConfig.upsert({
    where: { id: "default" },
    create: { id: "default", webhookSecretEnc: seal(secret) },
    update: { webhookSecretEnc: seal(secret) },
  });
  bustItopConfigCache();
}

function post(secretHeader?: string) {
  const req = request(app).post("/webhook/itop");
  return secretHeader === undefined ? req : req.set(HEADER, secretHeader);
}

beforeAll(async () => {
  await seedRoles();
});

beforeEach(async () => {
  requestSyncMock.mockClear();
  resetItopWebhookRateLimitForTests();
  await clearItopConfig();
});

afterEach(async () => {
  await clearItopConfig();
});

describe("POST /webhook/itop — no auth required, but secret-gated", () => {
  it("404s not_found when no webhook secret is configured (doesn't reveal the route exists)", async () => {
    const res = await post("anything-at-all");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("not_found");
    expect(requestSyncMock).not.toHaveBeenCalled();
  });

  it("401s unauthorized for a wrong secret of the same length", async () => {
    const correct = "correct-secret-value";
    await setWebhookSecret(correct);
    // Same length as `correct`, differs only in the last character — proves
    // the 401 comes from timingSafeEqual's byte comparison, not a length check.
    const wrongSameLength = `${correct.slice(0, -1)}X`;
    expect(wrongSameLength.length).toBe(correct.length);
    const res = await post(wrongSameLength);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("unauthorized");
    expect(requestSyncMock).not.toHaveBeenCalled();
  });

  it("401s unauthorized for a wrong-length secret", async () => {
    await setWebhookSecret("correct-secret-value");
    const res = await post("short");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("unauthorized");
    expect(requestSyncMock).not.toHaveBeenCalled();
  });

  it("401s unauthorized when the header is missing entirely", async () => {
    await setWebhookSecret("correct-secret-value");
    const res = await post();
    expect(res.status).toBe(401);
    expect(requestSyncMock).not.toHaveBeenCalled();
  });

  it("202s accepted:true for the right secret and requests a non-full sync", async () => {
    await setWebhookSecret("correct-secret-value");
    const res = await post("correct-secret-value");
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true });
    expect(requestSyncMock).toHaveBeenCalledTimes(1);
    expect(requestSyncMock).toHaveBeenCalledWith({ full: false });
  });

  it("ignores the body entirely — a malformed JSON payload still 202s", async () => {
    await setWebhookSecret("correct-secret-value");
    const res = await request(app)
      .post("/webhook/itop")
      .set(HEADER, "correct-secret-value")
      .set("Content-Type", "application/json")
      .send("{ this is not valid json");
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true });
  });

  it("429s rate_limited on the 7th accepted call within 60s", async () => {
    await setWebhookSecret("correct-secret-value");
    for (let i = 0; i < 6; i++) {
      const res = await post("correct-secret-value");
      expect(res.status, `call ${i + 1}`).toBe(202);
    }
    const seventh = await post("correct-secret-value");
    expect(seventh.status).toBe(429);
    expect(seventh.body.code).toBe("rate_limited");
    expect(requestSyncMock).toHaveBeenCalledTimes(6);
  });

  it("rejected (bad-secret) calls never count against the accepted-call rate limit", async () => {
    await setWebhookSecret("correct-secret-value");
    for (let i = 0; i < 20; i++) {
      await post("nope");
    }
    const res = await post("correct-secret-value");
    expect(res.status).toBe(202);
  });

  it("429s rate_limited on the 61st call within 60s, regardless of secret validity", async () => {
    // No webhook secret configured at all — every one of the first 60 calls
    // 404s on its own, but the wider all-calls window (checked before the
    // config read / secret compare) trips independently of that, proving
    // it's not merely counting accepted or even secret-checked calls.
    for (let i = 0; i < 60; i++) {
      const res = await post("whatever");
      expect(res.status, `call ${i + 1}`).toBe(404);
    }
    const res61 = await post("whatever");
    expect(res61.status).toBe(429);
    expect(res61.body.code).toBe("rate_limited");
  });

  it("logs at most one rejection warning per window for a burst of bad-secret calls", async () => {
    await setWebhookSecret("correct-secret-value");
    for (let i = 0; i < 5; i++) {
      const res = await post("nope");
      expect(res.status, `call ${i + 1}`).toBe(401);
    }
    // 5 rejections, but only the first should have logged — the other 4 are
    // folded into the (would-be) next warn instead of each logging their own.
    expect(getItopWebhookRejectionWarnCallsForTests()).toBe(1);
  });

  it("secret rotation invalidates the old one", async () => {
    await setWebhookSecret("first-secret-value");
    const firstOk = await post("first-secret-value");
    expect(firstOk.status).toBe(202);

    await setWebhookSecret("second-secret-value");

    const oldNowRejected = await post("first-secret-value");
    expect(oldNowRejected.status).toBe(401);

    const newAccepted = await post("second-secret-value");
    expect(newAccepted.status).toBe(202);
  });
});
