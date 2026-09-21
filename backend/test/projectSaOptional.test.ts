import "./env.js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { seedRoles, createAdminAndToken } from "./testAuth.js";

const app = createApp();

let token: string;
let userId: number;

beforeAll(async () => {
  await seedRoles();
});

beforeEach(async () => {
  const admin = await createAdminAndToken();
  token = admin.token;
  userId = admin.userId;
});

async function createCustomer(): Promise<number> {
  const res = await request(app)
    .post("/customers")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: `Customer ${Date.now()}-${Math.random()}`, description: "d" });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

describe("optional project SA", () => {
  it("creates a project without saId and returns sa: null on GET /projects/:id", async () => {
    const customerId = await createCustomer();
    const createRes = await request(app)
      .post("/projects")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "No-SA project", customerId });
    expect(createRes.status).toBe(201);
    expect(createRes.body.saId).toBeNull();

    const getRes = await request(app)
      .get(`/projects/${createRes.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.sa).toBeNull();
  });

  it("still accepts an saId on create", async () => {
    const customerId = await createCustomer();
    const res = await request(app)
      .post("/projects")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "With-SA project", saId: userId, customerId });
    expect(res.status).toBe(201);
    expect(res.body.saId).toBe(userId);
  });

  it("clears an assigned SA via PATCH saId: null", async () => {
    const customerId = await createCustomer();
    const createRes = await request(app)
      .post("/projects")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Clearable SA", saId: userId, customerId });
    expect(createRes.status).toBe(201);

    const patchRes = await request(app)
      .patch(`/projects/${createRes.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ saId: null });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.saId).toBeNull();
  });

  it("assigns an SA via PATCH on a project created without one", async () => {
    const customerId = await createCustomer();
    const createRes = await request(app)
      .post("/projects")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Late SA", customerId });
    expect(createRes.status).toBe(201);
    expect(createRes.body.saId).toBeNull();

    const patchRes = await request(app)
      .patch(`/projects/${createRes.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ saId: userId });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.saId).toBe(userId);
  });
});
