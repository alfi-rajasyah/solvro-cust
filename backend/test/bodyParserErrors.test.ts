// Malformed / oversized request bodies must answer 4xx and must never reach the
// logger with the raw body: body-parser errors carry the offending text in
// `err.body`, and the settings PATCH bodies hold secrets (Outline client secret,
// iTop token). docs/archive/plans/outline-integration.md (B2 review).
import "./env.js";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { logger } from "../src/logger.js";
import { createAdminAndToken, seedRoles } from "./testAuth.js";

const app = createApp();
const SECRET = "super-secret-client-secret-do-not-log";

beforeAll(async () => {
  await seedRoles();
});
afterEach(() => vi.restoreAllMocks());

function loggedText(spies: Array<ReturnType<typeof vi.spyOn>>): string {
  return JSON.stringify(spies.flatMap((s) => s.mock.calls), (_k, v) =>
    v instanceof Error ? { ...v, message: v.message, stack: v.stack } : v,
  );
}

describe("body-parser errors", () => {
  it("answers malformed JSON with 400 invalid_json and never logs the raw body", async () => {
    const admin = await createAdminAndToken();
    const spies = [
      vi.spyOn(logger, "error"),
      vi.spyOn(logger, "warn"),
      vi.spyOn(logger, "info"),
    ];
    const res = await request(app)
      .patch("/admin/settings/outline")
      .set("Authorization", `Bearer ${admin.token}`)
      .set("Content-Type", "application/json")
      .send(`{"oauthClientSecret": "${SECRET}",`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_json");
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(loggedText(spies)).not.toContain(SECRET);
  });

  it("answers an oversized body with 413 payload_too_large and never logs it", async () => {
    const admin = await createAdminAndToken();
    const spies = [vi.spyOn(logger, "error"), vi.spyOn(logger, "warn")];
    const res = await request(app)
      .patch("/admin/settings/outline")
      .set("Authorization", `Bearer ${admin.token}`)
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ oauthClientSecret: SECRET + "x".repeat(2 * 1024 * 1024) }));
    expect(res.status).toBe(413);
    expect(res.body.code).toBe("payload_too_large");
    expect(loggedText(spies)).not.toContain(SECRET);
  });
});
