import "./env.js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { seedRoles, createAdminAndToken, createUserWithRole } from "./testAuth.js";

// Daily Review v2 §5.2 — POST/DELETE /projects/:id/reviews. POST upserts on
// (projectId, userId, reviewDate): 201 on first mark, 200 (same id, no
// duplicate row) on repeat. DELETE removes only the caller's own row.

const app = createApp();

let adminToken: string;

beforeAll(async () => {
  await seedRoles();
});

beforeEach(async () => {
  const admin = await createAdminAndToken();
  adminToken = admin.token;
});

async function createCustomer(token: string): Promise<number> {
  const res = await request(app)
    .post("/customers")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: `Customer ${Date.now()}-${Math.random()}`, description: "d" });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

async function createProject(
  token: string,
  customerId: number,
  extra: Record<string, unknown> = {},
): Promise<number> {
  const res = await request(app)
    .post("/projects")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: `Project ${Date.now()}-${Math.random()}`, customerId, ...extra });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

describe("POST /projects/:id/reviews", () => {
  it("creates on first mark (201) and repeats idempotently (200, same id)", async () => {
    const customerId = await createCustomer(adminToken);
    const projectId = await createProject(adminToken, customerId);

    const first = await request(app)
      .post(`/projects/${projectId}/reviews`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reviewDate: "2026-08-15" });
    expect(first.status).toBe(201);
    expect(first.body.reviewDate).toBe("2026-08-15T00:00:00.000Z");
    expect(first.body.projectId).toBe(projectId);

    const second = await request(app)
      .post(`/projects/${projectId}/reviews`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reviewDate: "2026-08-15" });
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
  });

  it("does not collide with another user's review of the same project and day", async () => {
    const customerId = await createCustomer(adminToken);
    const tam = await createUserWithRole("TAM");
    const projectId = await createProject(adminToken, customerId, { tamId: tam.userId });

    const adminReview = await request(app)
      .post(`/projects/${projectId}/reviews`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reviewDate: "2026-08-15" });
    expect(adminReview.status).toBe(201);

    const tamReview = await request(app)
      .post(`/projects/${projectId}/reviews`)
      .set("Authorization", `Bearer ${tam.token}`)
      .send({ reviewDate: "2026-08-15" });
    expect(tamReview.status).toBe(201);
    expect(tamReview.body.id).not.toBe(adminReview.body.id);
    expect(tamReview.body.userId).toBe(tam.userId);
  });

  it("400s an invalid reviewDate", async () => {
    const customerId = await createCustomer(adminToken);
    const projectId = await createProject(adminToken, customerId);

    const res = await request(app)
      .post(`/projects/${projectId}/reviews`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reviewDate: "2026-13-01" });
    expect(res.status).toBe(400);
  });

  it("403s a STAKEHOLDER (no project:write)", async () => {
    const customerId = await createCustomer(adminToken);
    const projectId = await createProject(adminToken, customerId);
    const stakeholder = await createUserWithRole("STAKEHOLDER");

    const res = await request(app)
      .post(`/projects/${projectId}/reviews`)
      .set("Authorization", `Bearer ${stakeholder.token}`)
      .send({ reviewDate: "2026-08-15" });
    expect(res.status).toBe(403);
  });
});

describe("DELETE /projects/:id/reviews/:reviewDate", () => {
  it("deletes the caller's own review (204), then repeating is idempotent (204)", async () => {
    // The UI unmarks optimistically, so a double-click or a stale card
    // re-sending the same delete must not surface an error.
    const customerId = await createCustomer(adminToken);
    const projectId = await createProject(adminToken, customerId);

    const created = await request(app)
      .post(`/projects/${projectId}/reviews`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reviewDate: "2026-08-15" });
    expect(created.status).toBe(201);

    const first = await request(app)
      .delete(`/projects/${projectId}/reviews/2026-08-15`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(first.status).toBe(204);

    const second = await request(app)
      .delete(`/projects/${projectId}/reviews/2026-08-15`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(second.status).toBe(204);
  });

  it("204s idempotently deleting a date with no own row, even if another user reviewed it", async () => {
    const customerId = await createCustomer(adminToken);
    const tam = await createUserWithRole("TAM");
    const projectId = await createProject(adminToken, customerId, { tamId: tam.userId });

    const tamReview = await request(app)
      .post(`/projects/${projectId}/reviews`)
      .set("Authorization", `Bearer ${tam.token}`)
      .send({ reviewDate: "2026-08-15" });
    expect(tamReview.status).toBe(201);

    const res = await request(app)
      .delete(`/projects/${projectId}/reviews/2026-08-15`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(204);

    // The other user's review must survive — this delete only ever scopes
    // to the caller's own row.
    const stillThere = await request(app)
      .post(`/projects/${projectId}/reviews`)
      .set("Authorization", `Bearer ${tam.token}`)
      .send({ reviewDate: "2026-08-15" });
    expect(stillThere.status).toBe(200);
    expect(stillThere.body.id).toBe(tamReview.body.id);
  });
});
