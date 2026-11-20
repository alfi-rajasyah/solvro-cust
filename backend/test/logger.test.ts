// The shared logger masks secret-shaped fields (src/logger.ts#LOG_REDACT_OPTIONS).
import "./env.js";
import { describe, expect, it } from "vitest";
import { pino } from "pino";
import { LOG_REDACT_OPTIONS } from "../src/logger.js";

function logOnce(obj: Record<string, unknown>): string {
  let line = "";
  const log = pino({ redact: LOG_REDACT_OPTIONS }, { write: (c: string) => void (line += c) });
  log.info(obj, "x");
  return line;
}

describe("logger redaction", () => {
  it("masks token-shaped fields at the top level and one or two levels down", () => {
    const line = logOnce({
      appToken: "SECRET-A",
      cfg: { appToken: "SECRET-B", auth_token: "SECRET-C" },
      deep: { a: { token: "SECRET-D", password: "SECRET-E" } },
      authorization: "Bearer SECRET-F",
      req: { headers: { "auth-token": "SECRET-G" } },
      keep: "visible",
    });
    expect(line).not.toMatch(/SECRET-/);
    expect(line).toContain("[Redacted]");
    expect(line).toContain("visible");
  });

  it("masks OAuth and webhook fields at the top level and one or two levels down", () => {
    const names = ["accessToken", "refreshToken", "access_token", "refresh_token", "clientSecret", "client_secret", "authorization", "webhookSecret", "passwordHash"];
    for (const name of names) {
      const flat = logOnce({ [name]: "SECRET-X" });
      const one = logOnce({ a: { [name]: "SECRET-X" } });
      const two = logOnce({ a: { b: { [name]: "SECRET-X" } } });
      for (const line of [flat, one, two]) expect(line, name).not.toMatch(/SECRET-X/);
    }
  });

  it("masks capitalised Authorization and Auth-Token header names", () => {
    const line = logOnce({
      Authorization: "Bearer SECRET-H",
      "Auth-Token": "SECRET-I",
      req: { headers: { Authorization: "Bearer SECRET-J", "Auth-Token": "SECRET-K" } },
      res: { headers: { Authorization: "Bearer SECRET-L" } },
      keep: "visible",
    });
    expect(line).not.toMatch(/SECRET-/);
    expect(line).toContain("visible");
  });
});
