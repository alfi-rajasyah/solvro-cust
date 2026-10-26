// Hardening of the Outline surface: response byte budget, userinfo in stored links,
// webhook replay, and the OAuth callback without APP_URL.
import "./env.js";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { env } from "../src/env.js";
import { prisma } from "../src/prisma.js";
import { seal } from "../src/lib/secretBox.js";
import { OUTLINE_MAX_RESPONSE_BYTES, rawOutlineCall } from "../src/lib/outline/client.js";
import { OutlineApiError } from "../src/lib/outline/errors.js";
import { outlineUrlSchema, outlineBaseUrlWarning } from "../src/lib/outlineUrl.js";
import {
  resetSeenSignaturesForTests,
  rememberOutlineSignature,
  seenSignatureCountForTests,
  verifyOutlineSignature,
  WEBHOOK_TOLERANCE_MS,
} from "../src/lib/outline/webhookSignature.js";
import { resetOutlineWebhookStateForTests } from "../src/routes/webhook.js";
import { createAdminAndToken, createUserWithRole, seedRoles } from "./testAuth.js";

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("Outline response byte budget", () => {
  let server: http.Server;
  let base = "";
  let mode: "normal" | "huge-declared" | "huge-streamed" = "normal";

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      if (mode === "normal") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true }));
      } else if (mode === "huge-declared") {
        res.setHeader("Content-Length", String(OUTLINE_MAX_RESPONSE_BYTES + 1));
        res.write("{");
        res.end();
      } else {
        // No Content-Length (chunked): the budget must still stop the read.
        const chunk = Buffer.alloc(1024 * 1024, "a");
        let sent = 0;
        const pump = () => {
          while (sent <= OUTLINE_MAX_RESPONSE_BYTES + chunk.length) {
            sent += chunk.length;
            if (!res.write(chunk)) return void res.once("drain", pump);
          }
          res.end();
        };
        pump();
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });

  it("parses a normal body", async () => {
    mode = "normal";
    const r = await rawOutlineCall(base, "tok", "auth.info");
    expect(r.json).toEqual({ ok: true });
  });

  it("refuses a body that declares more than the budget", async () => {
    mode = "huge-declared";
    await expect(rawOutlineCall(base, "tok", "auth.info")).rejects.toBeInstanceOf(OutlineApiError);
  });

  it("refuses a chunked body that streams past the budget", async () => {
    mode = "huge-streamed";
    await expect(rawOutlineCall(base, "tok", "auth.info")).rejects.toBeInstanceOf(OutlineApiError);
  });
});

describe("stored Outline links", () => {
  it("refuses a user name or password, keeps plain http allowed", () => {
    expect(outlineUrlSchema.safeParse("https://user@docs.example.com/x").success).toBe(false);
    expect(outlineUrlSchema.safeParse("https://user:pw@docs.example.com/x").success).toBe(false);
    expect(outlineUrlSchema.safeParse("http://:pw@docs.example.com/x").success).toBe(false);
    expect(outlineUrlSchema.parse("http://docs.lan/x")).toBe("http://docs.lan/x");
  });

  it("answers 400 on a customer PATCH and the admin base URL", async () => {
    await seedRoles();
    const admin = await createAdminAndToken();
    const customer = await prisma.customer.create({ data: { name: `C ${Date.now()}-${Math.random()}`, description: "" } });
    const bad = await request(app)
      .patch(`/customers/${customer.id}`)
      .set(auth(admin.token))
      .send({ outlineUrl: "https://u:p@docs.example.com/c" });
    expect(bad.status).toBe(400);
    const badBase = await request(app)
      .patch("/admin/settings/outline")
      .set(auth(admin.token))
      .send({ baseUrl: "https://u:p@docs.example.com" });
    expect(badBase.status).toBe(400);
  });

  it("warns the admin when the Outline address is http", async () => {
    expect(outlineBaseUrlWarning("https://docs.example.com")).toBeNull();
    expect(outlineBaseUrlWarning(null)).toBeNull();
    expect(outlineBaseUrlWarning("http://docs.lan")).toMatch(/http/);
    const admin = await createAdminAndToken();
    await prisma.outlineConfig.deleteMany();
    const res = await request(app)
      .patch("/admin/settings/outline")
      .set(auth(admin.token))
      .send({ baseUrl: "http://docs.lan" });
    expect(res.status).toBe(200);
    expect(res.body.baseUrlWarning).toMatch(/http/);
  });
});

describe("webhook replay", () => {
  const SECRET = "whsec-hardening";
  const body = JSON.stringify({ event: "documents.update", payload: {} });
  const sign = (t: number) =>
    `t=${t},s=${crypto.createHmac("sha256", SECRET).update(`${t}.${body}`).digest("hex")}`;

  beforeEach(async () => {
    resetSeenSignaturesForTests();
    resetOutlineWebhookStateForTests();
    await prisma.outlineConfig.deleteMany();
    await prisma.outlineConfig.create({
      data: { id: "default", baseUrl: "https://docs.example.com", webhookSecretEnc: seal(SECRET) },
    });
  });

  const post = (sig: string) =>
    request(app).post("/webhook/outline").set("Content-Type", "application/json").set("Outline-Signature", sig).send(body);

  it("refuses the same signed delivery the second time, accepts a fresh one", async () => {
    const t = Date.now();
    expect((await post(sign(t))).status).not.toBe(401);
    expect((await post(sign(t))).status).toBe(401);
    expect((await post(sign(t + 1))).status).not.toBe(401);
  });

  it("checks the timestamp before the HMAC and expires remembered entries", () => {
    resetSeenSignaturesForTests();
    const now = 10_000_000;
    expect(verifyOutlineSignature(`t=${now},s=${"0".repeat(64)}`, Buffer.from(body), SECRET, now)).toBe("mismatch");
    expect(
      verifyOutlineSignature(`t=${now - WEBHOOK_TOLERANCE_MS - 1},s=${"0".repeat(64)}`, Buffer.from(body), SECRET, now),
    ).toBe("stale");
    const sig = (t: number) => sign(t);
    expect(verifyOutlineSignature(sig(now), Buffer.from(body), SECRET, now)).toBe("ok");
    // Verifying alone records nothing: a delivery refused later (429 cap)
    // stays retryable with the same signature.
    expect(verifyOutlineSignature(sig(now), Buffer.from(body), SECRET, now)).toBe("ok");
    expect(seenSignatureCountForTests()).toBe(0);
    rememberOutlineSignature(sig(now));
    expect(verifyOutlineSignature(sig(now), Buffer.from(body), SECRET, now)).toBe("replay");
    expect(seenSignatureCountForTests()).toBe(1);
    // Past the window the entry is pruned on the next verification.
    const later = now + WEBHOOK_TOLERANCE_MS + 1;
    expect(verifyOutlineSignature(sig(later), Buffer.from(body), SECRET, later)).toBe("ok");
    expect(seenSignatureCountForTests()).toBe(0);
  });
});

describe("OAuth callback without APP_URL", () => {
  it("answers a plain 404, not JSON", async () => {
    const mutable = env as { APP_URL: string | null };
    const saved = mutable.APP_URL;
    try {
      mutable.APP_URL = null;
      const res = await request(app).get("/outline/oauth/callback?error=access_denied");
      expect(res.status).toBe(404);
      expect(res.headers["content-type"]).not.toMatch(/json/);
      const noParams = await request(app).get("/outline/oauth/callback");
      expect(noParams.status).toBe(404);
      expect(noParams.headers["content-type"]).not.toMatch(/json/);
    } finally {
      mutable.APP_URL = saved;
    }
  });
});
