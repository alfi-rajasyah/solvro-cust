import "./env.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { seedRoles, createAdminAndToken, createUserWithRole } from "./testAuth.js";

// Customer Visibility (docs/plans/customer-visibility-spec.md §5.5,
// Decision 7): POST /projects and PATCH /projects/:id (when customerId is
// present) must reject a customerId the caller can't see with 400
// customer_not_found, instead of letting it through to a Prisma FK error
// or silently linking a customer the caller has no business touching.

const app = createApp();

let customerCounter = 0;

/** tamId omitted -> unowned (tamId: null); pass an explicit id to own it. */
async function createCustomer(tamId?: number | null): Promise<number> {
  customerCounter += 1;
  const customer = await prisma.customer.create({
    data: {
      name: `Link Test Co ${customerCounter}-${Date.now()}`,
      description: "d",
      tamId: tamId ?? null,
    },
  });
  return customer.id;
}

function createProject(token: string, body: Record<string, unknown>) {
  return request(app).post("/projects").set("Authorization", `Bearer ${token}`).send(body);
}

function patchProject(token: string, id: number, body: Record<string, unknown>) {
  return request(app).patch(`/projects/${id}`).set("Authorization", `Bearer ${token}`).send(body);
}

beforeAll(async () => {
  await seedRoles();
});

describe("POST /projects — customer visibility (Decision 7)", () => {
  it("400s customer_not_found for a customer owned by another TAM with no project of the caller's", async () => {
    const owner = await createUserWithRole("TAM");
    const caller = await createUserWithRole("TAM");
    const hiddenCustomerId = await createCustomer(owner.userId);

    const res = await createProject(caller.token, {
      name: "Should Fail",
      customerId: hiddenCustomerId,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("customer_not_found");
  });

  it("201s when the customer is owned by the caller", async () => {
    const caller = await createUserWithRole("TAM");
    const ownedCustomerId = await createCustomer(caller.userId);

    const res = await createProject(caller.token, {
      name: "Owned Customer Project",
      customerId: ownedCustomerId,
    });
    expect(res.status).toBe(201);
    expect(res.body.customerId).toBe(ownedCustomerId);
  });

  it("201s when the customer is unowned (tamId: null)", async () => {
    const caller = await createUserWithRole("TAM");
    const unownedCustomerId = await createCustomer(null);

    const res = await createProject(caller.token, {
      name: "Unowned Customer Project",
      customerId: unownedCustomerId,
    });
    expect(res.status).toBe(201);
    expect(res.body.customerId).toBe(unownedCustomerId);
  });

  it("ADMIN can link any customer, including one owned by another TAM", async () => {
    const owner = await createUserWithRole("TAM");
    const admin = await createAdminAndToken();
    const customerId = await createCustomer(owner.userId);

    const res = await createProject(admin.token, {
      name: "Admin Linked Project",
      customerId,
    });
    expect(res.status).toBe(201);
    expect(res.body.customerId).toBe(customerId);
  });
});

describe("PATCH /projects/:id — customer visibility (Decision 7)", () => {
  it("400s customer_not_found when the new customerId is hidden from the caller", async () => {
    const owner = await createUserWithRole("TAM");
    const caller = await createUserWithRole("TAM");
    const ownedCustomerId = await createCustomer(caller.userId);
    const hiddenCustomerId = await createCustomer(owner.userId);

    const created = await createProject(caller.token, {
      name: "Patch Target",
      customerId: ownedCustomerId,
    });
    expect(created.status).toBe(201);

    const res = await patchProject(caller.token, created.body.id, {
      customerId: hiddenCustomerId,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("customer_not_found");

    // Nothing changed on the failed attempt.
    const unchanged = await request(app)
      .get(`/projects/${created.body.id}`)
      .set("Authorization", `Bearer ${caller.token}`);
    expect(unchanged.body.customerId).toBe(ownedCustomerId);
  });
});
