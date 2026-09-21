import "./env.js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { seedRoles, createAdminAndToken, createUserWithRole } from "./testAuth.js";

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

async function createCustomer(authToken = token): Promise<number> {
  const res = await request(app)
    .post("/customers")
    .set("Authorization", `Bearer ${authToken}`)
    .send({ name: `Customer ${Date.now()}-${Math.random()}`, description: "d" });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

async function createProject(customerId: number, authToken = token, saId = userId): Promise<number> {
  const res = await request(app)
    .post("/projects")
    .set("Authorization", `Bearer ${authToken}`)
    .send({ name: `Project ${Date.now()}-${Math.random()}`, saId, customerId });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

async function createService(authToken = token): Promise<number> {
  const res = await request(app)
    .post("/services")
    .set("Authorization", `Bearer ${authToken}`)
    .send({ name: `Service ${Date.now()}-${Math.random()}` });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

describe("PUT /projects/:id/services", () => {
  it("assigns services and reads them back on the response and on GET /projects/:id", async () => {
    const customerId = await createCustomer();
    const projectId = await createProject(customerId);
    const serviceA = await createService();
    const serviceB = await createService();

    const putRes = await request(app)
      .put(`/projects/${projectId}/services`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        assignments: [
          { serviceId: serviceA, tools: ["Acronis", "Veeam"] },
          { serviceId: serviceB, tools: [] },
        ],
      });
    expect(putRes.status).toBe(200);
    expect(putRes.body.services).toHaveLength(2);
    const putNames = putRes.body.services.map((s: { service: { id: number } }) => s.service.id);
    expect(putNames.sort()).toEqual([serviceA, serviceB].sort());
    const acronisEntry = putRes.body.services.find(
      (s: { serviceId: number }) => s.serviceId === serviceA,
    );
    expect(acronisEntry.tools).toEqual(["Acronis", "Veeam"]);

    const getRes = await request(app)
      .get(`/projects/${projectId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.services).toHaveLength(2);
    // Ordered by service name asc.
    const names = getRes.body.services.map((s: { service: { name: string } }) => s.service.name);
    expect(names).toEqual([...names].sort());
  });

  it("replaces the assignment set on a second PUT (removal-by-omission + upsert)", async () => {
    const customerId = await createCustomer();
    const projectId = await createProject(customerId);
    const serviceA = await createService();
    const serviceB = await createService();

    await request(app)
      .put(`/projects/${projectId}/services`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        assignments: [
          { serviceId: serviceA, tools: ["Acronis"] },
          { serviceId: serviceB, tools: [] },
        ],
      })
      .expect(200);

    const secondRes = await request(app)
      .put(`/projects/${projectId}/services`)
      .set("Authorization", `Bearer ${token}`)
      .send({ assignments: [{ serviceId: serviceA, tools: ["Veeam", "Rubrik"] }] });
    expect(secondRes.status).toBe(200);
    expect(secondRes.body.services).toHaveLength(1);
    expect(secondRes.body.services[0].serviceId).toBe(serviceA);
    expect(secondRes.body.services[0].tools).toEqual(["Veeam", "Rubrik"]);
  });

  it("allows a TAM to create catalogue services (project:write gate regression)", async () => {
    const tam = await createUserWithRole("TAM");
    const serviceRes = await request(app)
      .post("/services")
      .set("Authorization", `Bearer ${tam.token}`)
      .send({ name: `TAM Service ${Date.now()}-${Math.random()}` });
    expect(serviceRes.status).toBe(201);
  });

  it("rejects a read-only STAKEHOLDER from writing services or assignments", async () => {
    const stakeholder = await createUserWithRole("STAKEHOLDER");
    const customerId = await createCustomer();
    const projectId = await createProject(customerId);

    const serviceRes = await request(app)
      .post("/services")
      .set("Authorization", `Bearer ${stakeholder.token}`)
      .send({ name: `Stakeholder Service ${Date.now()}-${Math.random()}` });
    expect(serviceRes.status).toBe(403);

    const putRes = await request(app)
      .put(`/projects/${projectId}/services`)
      .set("Authorization", `Bearer ${stakeholder.token}`)
      .send({ assignments: [] });
    expect(putRes.status).toBe(403);
  });

  it("hides the project from a TAM who isn't assigned as its tam/sa (404, not 403)", async () => {
    const customerId = await createCustomer();
    const projectId = await createProject(customerId); // saId = admin's userId, tamId defaults to admin too

    const otherTam = await createUserWithRole("TAM");
    const putRes = await request(app)
      .put(`/projects/${projectId}/services`)
      .set("Authorization", `Bearer ${otherTam.token}`)
      .send({ assignments: [] });
    expect(putRes.status).toBe(404);
  });

  it("rejects a non-positive serviceId", async () => {
    const customerId = await createCustomer();
    const projectId = await createProject(customerId);

    const res = await request(app)
      .put(`/projects/${projectId}/services`)
      .set("Authorization", `Bearer ${token}`)
      .send({ assignments: [{ serviceId: -1 }] });
    expect(res.status).toBe(400);
  });

  it("rejects a nonexistent serviceId with 400 instead of a raw FK 500", async () => {
    const customerId = await createCustomer();
    const projectId = await createProject(customerId);

    const res = await request(app)
      .put(`/projects/${projectId}/services`)
      .set("Authorization", `Bearer ${token}`)
      .send({ assignments: [{ serviceId: 999999, tools: [] }] });
    expect(res.status).toBe(400);
  });

  it("PUT /customers/:id/services rejects a nonexistent serviceId with 400 and accepts a real one", async () => {
    const customerId = await createCustomer();

    const badRes = await request(app)
      .put(`/customers/${customerId}/services`)
      .set("Authorization", `Bearer ${token}`)
      .send({ assignments: [{ serviceId: 999999, tools: [] }] });
    expect(badRes.status).toBe(400);

    const serviceA = await createService();
    const goodRes = await request(app)
      .put(`/customers/${customerId}/services`)
      .set("Authorization", `Bearer ${token}`)
      .send({ assignments: [{ serviceId: serviceA, tools: [] }] });
    expect(goodRes.status).toBe(200);
    expect(goodRes.body.services).toHaveLength(1);
  });
});
