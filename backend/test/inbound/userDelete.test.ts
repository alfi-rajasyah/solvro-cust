// Deleting an account that created an incoming URL removes the URL
// (docs/archive/plans/webhooks.md): the user foreign key cascades, so
// DELETE /admin/users/:id does not fail on it.
import "../env.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/prisma.js";
import { generateInboundToken } from "../../src/lib/inbound/token.js";
import { createAdminAndToken, createUserWithRole, seedRoles } from "../testAuth.js";

const app = createApp();

beforeAll(async () => {
  await seedRoles();
});

describe("deleting a user who created an incoming URL", () => {
  it("succeeds and removes the URL, its links and its comments' marker", async () => {
    const admin = await createAdminAndToken();
    const creator = await createUserWithRole("TAM");
    const owner = await createUserWithRole("TAM");
    const project = await prisma.project.create({ data: { name: `P ${Date.now()}`, tamId: owner.userId, status: "ACTIVE" } });
    const t = generateInboundToken();
    const hook = await prisma.inboundHook.create({
      data: { projectId: project.id, createdById: creator.userId, name: "CI", tokenHash: t.hash, tokenPreview: t.preview },
    });
    await prisma.inboundHookMessage.create({ data: { hookId: hook.id, messageId: "m1" } });

    const res = await request(app).delete(`/admin/users/${creator.userId}`).set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(204);
    expect(await prisma.inboundHook.count({ where: { id: hook.id } })).toBe(0);
    expect(await prisma.inboundHookMessage.count({ where: { hookId: hook.id } })).toBe(0);
  });
});
