import "./env.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { signToken } from "../src/http/auth.js";
import { seedRoles, createAdminAndToken, createUserWithRole } from "./testAuth.js";

// Customer Visibility (docs/plans/customer-visibility-spec.md §5.5,
// Decision 7): POST /projects, PATCH /projects/:id (when customerId is
// present), and POST /opportunities/:id/handoff must all reject a
// customerId the caller can't see with 400 customer_not_found, instead of
// letting it through to a Prisma FK error or silently linking a customer
// the caller has no business touching.

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

// Mirrors opportunityHandoff.test.ts's local permission-set helper — a
// handoff caller needs the pipeline half (create + move to WON) plus the
// project:write half the handoff route checks explicitly.
let roleCounter = 0;
async function createUserWithPermissions(
  permissions: string[],
): Promise<{ userId: number; token: string }> {
  roleCounter += 1;
  const role = await prisma.role.create({
    data: { roleName: `test-link-role-${roleCounter}-${Date.now()}`, permissions },
  });
  const user = await prisma.user.create({
    data: {
      username: `test-link-user-${roleCounter}-${Date.now()}`,
      email: `test-link-user-${roleCounter}-${Date.now()}@example.com`,
      passwordHash: null,
      roleId: role.id,
      active: true,
    },
  });
  const token = signToken({ sub: user.id, role: role.roleName, permissions });
  return { userId: user.id, token };
}

async function createHandoffCapableUser(): Promise<{ userId: number; token: string }> {
  return createUserWithPermissions([
    "pipeline:view",
    "pipeline:create",
    "pipeline:edit_all",
    "project:write",
  ]);
}

async function createWonOpportunity(token: string, userId: number): Promise<string> {
  const created = await request(app)
    .post("/opportunities")
    .set("Authorization", `Bearer ${token}`)
    .send({ title: "Link Deal", customerName: "Acme Corp", picId: userId, stage: "WON" });
  expect(created.status).toBe(201);
  return created.body.id as string;
}

function handoff(token: string, id: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/opportunities/${id}/handoff`)
    .set("Authorization", `Bearer ${token}`)
    .send(body);
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

describe("POST /opportunities/:id/handoff — customer visibility (Decision 7)", () => {
  it("400s customer_not_found for a hidden customerId", async () => {
    const owner = await createUserWithRole("TAM");
    const sa = await createHandoffCapableUser();
    const hiddenCustomerId = await createCustomer(owner.userId);
    const id = await createWonOpportunity(sa.token, sa.userId);

    const res = await handoff(sa.token, id, {
      name: "Should Fail Handoff",
      customerId: hiddenCustomerId,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("customer_not_found");

    const fetched = await request(app)
      .get(`/opportunities/${id}`)
      .set("Authorization", `Bearer ${sa.token}`);
    expect(fetched.body.projectId).toBeNull();
  });

  it("succeeds for a visible (unowned) customerId", async () => {
    const sa = await createHandoffCapableUser();
    const visibleCustomerId = await createCustomer(null);
    const id = await createWonOpportunity(sa.token, sa.userId);

    const res = await handoff(sa.token, id, {
      name: "Should Succeed Handoff",
      customerId: visibleCustomerId,
    });
    expect(res.status).toBe(201);
    expect(res.body.project.customerId).toBe(visibleCustomerId);
  });
});
