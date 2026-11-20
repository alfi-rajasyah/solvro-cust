// Guest links are built from the operator's APP_URL when it is set (ISS-132).
import "./env.js";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";

const base = vi.hoisted(() => ({ value: null as string | null }));
vi.mock("../src/lib/publicBaseUrl.js", () => ({ configuredPublicBaseUrl: () => base.value }));

import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { createUserWithRole, seedRoles } from "./testAuth.js";

const app = createApp();

async function create() {
  await seedRoles();
  const tam = await createUserWithRole("TAM");
  const project = await prisma.project.create({
    data: { name: `Share ${Date.now()}-${Math.random()}`, tamId: tam.userId, status: "ACTIVE" },
  });
  return request(app)
    .post(`/projects/${project.id}/share-links`)
    .set({ Authorization: `Bearer ${tam.token}` })
    .send({});
}

describe("POST /projects/:id/share-links baseUrl", () => {
  it("carries the configured public address next to the relative url", async () => {
    base.value = "https://solvro.acme.com";
    const res = await create();
    expect(res.status).toBe(201);
    expect(res.body.baseUrl).toBe("https://solvro.acme.com");
    expect(res.body.url).toMatch(/^\/share\/[A-Za-z0-9_-]{43}$/);
  });

  it("is null when no public address is configured", async () => {
    base.value = null;
    const res = await create();
    expect(res.body.baseUrl).toBeNull();
  });
});
