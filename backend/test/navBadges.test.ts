// GET /overview/badges — `dailyReviewPending` shares its scope with
// GET /daily-review (lib/dailyReviewScope.ts). Fixtures write via `prisma`.
import "./env.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { createAdminAndToken, createUserWithRole, seedRoles } from "./testAuth.js";

const app = createApp();

beforeAll(async () => {
  await seedRoles();
});

const TODAY = "2026-08-28";
const uniq = (label: string) => `${label} ${Date.now()}-${Math.random()}`;

function badges(token: string, query: Record<string, string> = { today: TODAY }) {
  return request(app)
    .get("/overview/badges")
    .query(query)
    .set("Authorization", `Bearer ${token}`);
}

async function customerFor(tamId: number) {
  return prisma.customer.create({ data: { name: uniq("Customer"), description: "d", tamId } });
}

async function projectFor(tamId: number, customerId: number | null, status: "ACTIVE" | "COMPLETED" = "ACTIVE") {
  return prisma.project.create({
    data: { name: uniq("Project"), tamId, customerId, status },
  });
}

function review(projectId: number, userId: number, day = TODAY) {
  return prisma.projectReview.create({
    data: { projectId, userId, reviewDate: new Date(`${day}T00:00:00.000Z`) },
  });
}

describe("GET /overview/badges", () => {
  it("counts customers with an unreviewed ACTIVE project and drops when the last one is reviewed", async () => {
    const tam = await createUserWithRole("TAM");
    const c1 = await customerFor(tam.userId);
    const c2 = await customerFor(tam.userId);
    const p1a = await projectFor(tam.userId, c1.id);
    const p1b = await projectFor(tam.userId, c1.id);
    const p2 = await projectFor(tam.userId, c2.id);

    const before = await badges(tam.token);
    expect(before.status).toBe(200);
    expect(before.body).toEqual({ dailyReviewPending: 2 });

    // c1 still has p1b pending — count unchanged after only one of its projects.
    await review(p1a.id, tam.userId);
    expect((await badges(tam.token)).body.dailyReviewPending).toBe(2);

    // Marking c1's last project reviewed drops the count by one.
    await review(p1b.id, tam.userId);
    expect((await badges(tam.token)).body.dailyReviewPending).toBe(1);

    await review(p2.id, tam.userId);
    expect((await badges(tam.token)).body.dailyReviewPending).toBe(0);
  });

  it("ignores another user's review, a review on another day, and non-ACTIVE projects", async () => {
    const tam = await createUserWithRole("TAM");
    const other = await createUserWithRole("TAM");
    const c = await customerFor(tam.userId);
    const p = await projectFor(tam.userId, c.id);
    await projectFor(tam.userId, c.id, "COMPLETED");

    await review(p.id, other.userId);
    await review(p.id, tam.userId, "2026-08-27");
    expect((await badges(tam.token)).body.dailyReviewPending).toBe(1);

    await review(p.id, tam.userId);
    expect((await badges(tam.token)).body.dailyReviewPending).toBe(0);
  });

  it("scopes a TAM to their own customers, and view-all sees every owned customer", async () => {
    const tamA = await createUserWithRole("TAM");
    const tamB = await createUserWithRole("TAM");
    const admin = await createAdminAndToken();
    const before = (await badges(admin.token)).body.dailyReviewPending as number;

    const cA = await customerFor(tamA.userId);
    await projectFor(tamA.userId, cA.id);
    const cB = await customerFor(tamB.userId);
    await projectFor(tamB.userId, cB.id);

    expect((await badges(tamA.token)).body.dailyReviewPending).toBe(1);
    expect((await badges(tamB.token)).body.dailyReviewPending).toBe(1);
    expect((await badges(admin.token)).body.dailyReviewPending).toBe(before + 2);
  });

  it("does not count projects without a customer, and is 0 for a caller with no scope", async () => {
    const tam = await createUserWithRole("TAM");
    await projectFor(tam.userId, null);
    expect((await badges(tam.token)).body).toEqual({ dailyReviewPending: 0 });
  });

  it("validates `today`", async () => {
    const tam = await createUserWithRole("TAM");
    expect((await badges(tam.token, {})).status).toBe(400);
    expect((await badges(tam.token, { today: "2026-13-40" })).status).toBe(400);
    expect((await request(app).get("/overview/badges").query({ today: TODAY })).status).toBe(401);
  });
});
