import "./env.js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { SID } from "./statusFixtures.js";
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
        wipLimits: { [SID.TODO]: 3, [SID.IN_PROGRESS]: 2, [SID.DONE]: null },
      });
    expect(createRes.status).toBe(201);
    expect(createRes.body.wipLimits).toEqual({ [SID.TODO]: 3, [SID.IN_PROGRESS]: 2, [SID.DONE]: null });

    const getRes = await request(app)
      .get(`/projects/${createRes.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.wipLimits).toEqual({ [SID.TODO]: 3, [SID.IN_PROGRESS]: 2, [SID.DONE]: null });
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
      .send({ wipLimits: { [SID.TODO]: 5, [SID.IN_PROGRESS]: null, [SID.DONE]: null } });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.wipLimits).toEqual({ [SID.TODO]: 5, [SID.IN_PROGRESS]: null, [SID.DONE]: null });

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
      .send({ name: "Proj D", customerId, wipLimits: { [SID.TODO]: 0 } });
    expect(res.status).toBe(400);
  });

  it("rejects a key that is not a known status id (including legacy category keys)", async () => {
    const customerId = await createCustomer();
    for (const wipLimits of [{ TODO: 3 }, { "99999": 3 }]) {
      const res = await request(app)
        .post("/projects")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Proj E", customerId, wipLimits });
      expect(res.status).toBe(400);
    }
  });
});
