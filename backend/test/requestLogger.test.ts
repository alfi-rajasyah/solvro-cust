// The request logger must never write a guest-link token or a bearer JWT
// (http/requestLogger.ts, wired in src/app.ts).
import "./env.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { pino } from "pino";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { redactShareTokens } from "../src/http/requestLogger.js";
import { createUserWithRole, seedRoles } from "./testAuth.js";

beforeAll(async () => {
  await seedRoles();
});

function capturingApp() {
  const lines: string[] = [];
  const logger = pino({ level: "info" }, { write: (chunk: string) => void lines.push(chunk) });
  return { app: createApp({ logger }), lines };
}

describe("redactShareTokens", () => {
  it("replaces the token segment of page and API paths", () => {
    expect(redactShareTokens("/public/share/abc_DEF-123?x=1")).toBe("/public/share/[redacted]?x=1");
    expect(redactShareTokens("https://solvro.example/share/abc_DEF-123")).toBe(
      "https://solvro.example/share/[redacted]",
    );
    expect(redactShareTokens("/projects/4/share-links/9")).toBe("/projects/4/share-links/9");
  });
});

describe("request logging", () => {
  it("a public guest GET logs neither the token (url or referer) nor anything else secret", async () => {
    const { app, lines } = capturingApp();
    const tam = await createUserWithRole("TAM");
    const project = await prisma.project.create({
      data: { name: `Logged ${Date.now()}`, tamId: tam.userId, status: "ACTIVE" },
    });
    const created = await request(app)
      .post(`/projects/${project.id}/share-links`)
      .set("Authorization", `Bearer ${tam.token}`)
      .send({});
    const token = (created.body as { url: string }).url.replace("/share/", "");
    lines.length = 0;

    const res = await request(app)
      .get(`/public/share/${token}`)
      .set("Referer", `https://solvro.example/share/${token}`);
    expect(res.status).toBe(200);
    // Also an unknown-route request that would echo the path.
    await request(app).get(`/public/share/${token}/extra`);

    const logged = lines.join("");
    expect(logged).toContain("/public/share/[redacted]");
    expect(logged).toContain("https://solvro.example/share/[redacted]");
    expect(logged).not.toContain(token);
  });

  it("keeps remoteAddress/remotePort and adds the trusted clientIp to every line", async () => {
    const { app, lines } = capturingApp();
    await request(app).get("/health").set("X-Forwarded-For", "198.51.100.9, 203.0.113.5");
    const entry = JSON.parse(lines.at(-1)!) as {
      req: { remoteAddress?: string; remotePort?: number; method: string; url: string };
      clientIp?: string;
    };
    expect(entry.req.method).toBe("GET");
    expect(entry.req.url).toBe("/health");
    expect(entry.req.remoteAddress).toMatch(/127\.0\.0\.1|::1/);
    expect(typeof entry.req.remotePort).toBe("number");
    // TRUST_PROXY defaults to 1 hop: the rightmost X-Forwarded-For entry.
    expect(entry.clientIp).toBe("203.0.113.5");
  });

  it("an authed request does not log its bearer token, but still logs the request", async () => {
    const { app, lines } = capturingApp();
    const tam = await createUserWithRole("TAM");
    const res = await request(app).get("/projects").set("Authorization", `Bearer ${tam.token}`);
    expect(res.status).toBe(200);

    const logged = lines.join("");
    expect(logged).not.toContain(tam.token);
    expect(logged).not.toContain("Bearer ");
    const entry = JSON.parse(lines.at(-1)!) as {
      req: { url: string; method: string; headers: Record<string, string> };
      res: { statusCode: number };
    };
    expect(entry.req.method).toBe("GET");
    expect(entry.req.url).toBe("/projects");
    expect(entry.req.headers.authorization).toBe("[redacted]");
    expect(entry.res.statusCode).toBe(200);
  });
});
