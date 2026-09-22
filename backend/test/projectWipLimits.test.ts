import "./env.js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { seedRoles, createAdminAndToken } from "./testAuth.js";

const app = createApp();

let token: string;

beforeAll(async () => {
  await seedRoles();
});

beforeEach(async () => {
  const admin = await createAdminAndToken();
  token = admin.token;
});

async function createCustomer(): Promise<number> {
  const res = await request(app)
    .post("/customers")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: `Customer ${Date.now()}-${Math.random()}`, description: "d" });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

describe("project wipLimits", () => {
  it("accepts wipLimits on create and returns them on GET /projects/:id", async () => {
    const customerId = await createCustomer();
    const createRes = await request(app)
      .post("/projects")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Proj A",
        customerId,
        wipLimits: { TODO: 3, IN_PROGRESS: 2, DONE: null },
      });
    expect(createRes.status).toBe(201);
    expect(createRes.body.wipLimits).toEqual({ TODO: 3, IN_PROGRESS: 2, DONE: null });

    const getRes = await request(app)
      .get(`/projects/${createRes.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.wipLimits).toEqual({ TODO: 3, IN_PROGRESS: 2, DONE: null });
  });

  it("defaults wipLimits to null when omitted on create", async () => {
    const customerId = await createCustomer();
    const createRes = await request(app)
      .post("/projects")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Proj B", customerId });
    expect(createRes.status).toBe(201);
    expect(createRes.body.wipLimits).toBeNull();
  });

  it("updates wipLimits via PATCH and can clear them back to null", async () => {
    const customerId = await createCustomer();
    const createRes = await request(app)
      .post("/projects")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Proj C", customerId });
    const projectId = createRes.body.id as number;

    const patchRes = await request(app)
      .patch(`/projects/${projectId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ wipLimits: { TODO: 5, IN_PROGRESS: null, DONE: null } });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.wipLimits).toEqual({ TODO: 5, IN_PROGRESS: null, DONE: null });

    const clearRes = await request(app)
      .patch(`/projects/${projectId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ wipLimits: null });
    expect(clearRes.status).toBe(200);
    expect(clearRes.body.wipLimits).toBeNull();
  });

  it("rejects a non-positive wipLimits value", async () => {
    const customerId = await createCustomer();
    const res = await request(app)
      .post("/projects")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Proj D", customerId, wipLimits: { TODO: 0 } });
    expect(res.status).toBe(400);
  });
});
