// Customer visibility (docs/plans/customer-visibility-spec.md §3, §5.2, §8
// criteria 1-4). Fixtures write directly via `prisma` for the "attached" /
// "unrelated" scenarios (needs full control over Customer.tamId and
// Project.tamId independent of the caller), and through the HTTP API where
// the route under test is what's being exercised (POST /customers, PATCH).
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

function uniq(label: string): string {
  return `${label} ${Date.now()}-${Math.random()}`;
}

async function createCustomer(overrides: { name?: string; tamId?: number | null } = {}) {
  return prisma.customer.create({
    data: {
      name: overrides.name ?? uniq("Customer"),
      description: "d",
      tamId: overrides.tamId ?? null,
    },
  });
}

async function createProject(overrides: { tamId: number; customerId?: number | null }) {
  return prisma.project.create({
    data: {
      name: uniq("Project"),
      tamId: overrides.tamId,
      customerId: overrides.customerId ?? null,
      status: "ACTIVE",
    },
  });
}

// STAKEHOLDER (seeded: project:read + project:view-all, no project:write —
// backend/prisma/seed.ts) can't reach POST /customers at all: the route
// gates on project:write before Decision 4's tamId branch ever runs, so a
// real STAKEHOLDER token 403s at the permission middleware. To exercise
// `hasPermission(user, "project:view-all")` on its own — distinct from
// ADMIN's "*" wildcard, which already satisfies every permission check on
// its own — this seeds a one-off role that combines write with view-all.
async function createViewAllWriterAndToken(): Promise<{ userId: number; token: string }> {
  await prisma.role.upsert({
    where: { roleName: "TEST_VIEW_ALL_WRITER" },
    update: { permissions: ["project:write", "project:view-all"] },
    create: {
      roleName: "TEST_VIEW_ALL_WRITER",
      permissions: ["project:write", "project:view-all"],
    },
  });
  return createUserWithRole("TEST_VIEW_ALL_WRITER");
}

// Sets up the four-customer fixture from acceptance criterion 1: a TAM with
// one owned customer, one attached customer (project TAM on another TAM's
// customer), one unowned customer, and one unrelated customer (owned by
// another TAM, no project of the caller's).
async function fourCustomerFixture() {
  const tam = await createUserWithRole("TAM");
  const otherTam = await createUserWithRole("TAM");

  const owned = await createCustomer({ tamId: tam.userId, name: uniq("Owned") });

  const attached = await createCustomer({ tamId: otherTam.userId, name: uniq("Attached") });
  await createProject({ tamId: tam.userId, customerId: attached.id });

  const unowned = await createCustomer({ tamId: null, name: uniq("Unowned") });

  const unrelated = await createCustomer({ tamId: otherTam.userId, name: uniq("Unrelated") });
  // Give otherTam's unrelated customer a project too, but tam'd to otherTam
  // — never visible to `tam`.
  await createProject({ tamId: otherTam.userId, customerId: unrelated.id });

  return { tam, otherTam, owned, attached, unowned, unrelated };
}

describe("GET /customers — visibility (criterion 1)", () => {
  it("a TAM sees owned + attached + unowned, and not the unrelated customer", async () => {
    const { tam, owned, attached, unowned, unrelated } = await fourCustomerFixture();

    const res = await request(app)
      .get("/customers")
      .set("Authorization", `Bearer ${tam.token}`);
    expect(res.status).toBe(200);
    const ids = res.body.map((c: any) => c.id);
    expect(ids).toContain(owned.id);
    expect(ids).toContain(attached.id);
    expect(ids).toContain(unowned.id);
    expect(ids).not.toContain(unrelated.id);
  });

  it("STAKEHOLDER (project:view-all) and ADMIN (*) see every customer (criterion 3)", async () => {
    const { owned, attached, unowned, unrelated } = await fourCustomerFixture();
    const stakeholder = await createUserWithRole("STAKEHOLDER");
    const admin = await createAdminAndToken();

    for (const token of [stakeholder.token, admin.token]) {
      const res = await request(app)
        .get("/customers")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      const ids = res.body.map((c: any) => c.id);
      expect(ids).toContain(owned.id);
      expect(ids).toContain(attached.id);
      expect(ids).toContain(unowned.id);
      expect(ids).toContain(unrelated.id);
    }
  });
});

describe("GET /customers/:id — visibility (criterion 2)", () => {
  it("404s customer_not_found on the unrelated customer", async () => {
    const { tam, unrelated } = await fourCustomerFixture();
    const res = await request(app)
      .get(`/customers/${unrelated.id}`)
      .set("Authorization", `Bearer ${tam.token}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("customer_not_found");
  });

  it("200s owned, attached, and unowned customers", async () => {
    const { tam, owned, attached, unowned } = await fourCustomerFixture();
    for (const c of [owned, attached, unowned]) {
      const res = await request(app)
        .get(`/customers/${c.id}`)
        .set("Authorization", `Bearer ${tam.token}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(c.id);
    }
  });
});

describe("GET /customers/:id and GET /customers — nested/counted projects are visibility-filtered", () => {
  it("a TAM attached via one project on a customer with two sees only that project, and _count.projects = 1 on both routes", async () => {
    const tam = await createUserWithRole("TAM");
    const otherTam = await createUserWithRole("TAM");
    const customer = await createCustomer({ tamId: otherTam.userId, name: uniq("Two Projects") });
    const visible = await createProject({ tamId: tam.userId, customerId: customer.id });
    // Second project on the same customer, TAM'd to someone else — must not
    // appear in `tam`'s view of this customer even though the customer
    // itself is visible (Decision 1's third arm only vouches for the one
    // project that makes the customer visible, not the whole project list).
    await createProject({ tamId: otherTam.userId, customerId: customer.id });

    const detail = await request(app)
      .get(`/customers/${customer.id}`)
      .set("Authorization", `Bearer ${tam.token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.projects).toHaveLength(1);
    expect(detail.body.projects[0].id).toBe(visible.id);
    expect(detail.body._count.projects).toBe(1);

    const list = await request(app)
      .get("/customers")
      .set("Authorization", `Bearer ${tam.token}`);
    expect(list.status).toBe(200);
    const listed = list.body.find((c: any) => c.id === customer.id);
    expect(listed._count.projects).toBe(1);
  });
});

describe("Id-keyed customer routes — 404 customer_not_found on the unrelated customer (criterion 2)", () => {
  it("notes GET/POST", async () => {
    const { tam, unrelated } = await fourCustomerFixture();

    const getRes = await request(app)
      .get(`/customers/${unrelated.id}/notes`)
      .set("Authorization", `Bearer ${tam.token}`);
    expect(getRes.status).toBe(404);
    expect(getRes.body.code).toBe("customer_not_found");

    const postRes = await request(app)
      .post(`/customers/${unrelated.id}/notes`)
      .set("Authorization", `Bearer ${tam.token}`)
      .send({ body: "should not land", title: "Blocked" });
    expect(postRes.status).toBe(404);
    expect(postRes.body.code).toBe("customer_not_found");
  });

  it("weekly-updates GET/PUT", async () => {
    const { tam, unrelated } = await fourCustomerFixture();

    const getRes = await request(app)
      .get(`/customers/${unrelated.id}/weekly-updates`)
      .set("Authorization", `Bearer ${tam.token}`);
    expect(getRes.status).toBe(404);
    expect(getRes.body.code).toBe("customer_not_found");

    const putRes = await request(app)
      .put(`/customers/${unrelated.id}/weekly-updates/2026-08-24`)
      .set("Authorization", `Bearer ${tam.token}`)
      .send({ category: "x", status: "DRAFT" });
    expect(putRes.status).toBe(404);
    expect(putRes.body.code).toBe("customer_not_found");
  });

  it("services PUT", async () => {
    const { tam, unrelated } = await fourCustomerFixture();
    const res = await request(app)
      .put(`/customers/${unrelated.id}/services`)
      .set("Authorization", `Bearer ${tam.token}`)
      .send({ assignments: [] });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("customer_not_found");
  });

  it("PATCH and DELETE", async () => {
    const { tam, unrelated } = await fourCustomerFixture();

    const patchRes = await request(app)
      .patch(`/customers/${unrelated.id}`)
      .set("Authorization", `Bearer ${tam.token}`)
      .send({ name: "Renamed" });
    expect(patchRes.status).toBe(404);
    expect(patchRes.body.code).toBe("customer_not_found");

    const deleteRes = await request(app)
      .delete(`/customers/${unrelated.id}`)
      .set("Authorization", `Bearer ${tam.token}`);
    expect(deleteRes.status).toBe(404);
    expect(deleteRes.body.code).toBe("customer_not_found");
  });
});

describe("POST /customers — Decision 4 create default (criterion 4)", () => {
  it("a TAM without tamId gets tam.id = caller", async () => {
    const tam = await createUserWithRole("TAM");
    const res = await request(app)
      .post("/customers")
      .set("Authorization", `Bearer ${tam.token}`)
      .send({ name: uniq("Self-owned"), description: "d" });
    expect(res.status).toBe(201);
    expect(res.body.tam.id).toBe(tam.userId);
  });

  it("a TAM with explicit tamId: null gets 400 tam_required", async () => {
    const tam = await createUserWithRole("TAM");
    const res = await request(app)
      .post("/customers")
      .set("Authorization", `Bearer ${tam.token}`)
      .send({ name: uniq("Unowned attempt"), description: "d", tamId: null });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("tam_required");
  });

  it("ADMIN with tamId: null gets 201, tam null", async () => {
    const admin = await createAdminAndToken();
    const res = await request(app)
      .post("/customers")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ name: uniq("Admin unowned"), description: "d", tamId: null });
    expect(res.status).toBe(201);
    expect(res.body.tam).toBeNull();
  });

  it("a non-wildcard view-all writer with tamId: null gets 201, tam null (project:view-all itself, not the * wildcard)", async () => {
    const viewAllWriter = await createViewAllWriterAndToken();
    const res = await request(app)
      .post("/customers")
      .set("Authorization", `Bearer ${viewAllWriter.token}`)
      .send({ name: uniq("View-all unowned"), description: "d", tamId: null });
    expect(res.status).toBe(201);
    expect(res.body.tam).toBeNull();
  });

  it("a numeric tamId still validates via the existing tam_not_found path", async () => {
    const tam = await createUserWithRole("TAM");
    const res = await request(app)
      .post("/customers")
      .set("Authorization", `Bearer ${tam.token}`)
      .send({ name: uniq("Bogus tam"), description: "d", tamId: 999999 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("tam_not_found");
  });
});

describe("PATCH /customers/:id — reassign (Decision 5)", () => {
  it("reassigning tamId to another user is allowed: 200", async () => {
    const owner = await createUserWithRole("TAM");
    const otherTam = await createUserWithRole("TAM");
    const customer = await createCustomer({ tamId: owner.userId, name: uniq("Handover") });

    const res = await request(app)
      .patch(`/customers/${customer.id}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ tamId: otherTam.userId });
    expect(res.status).toBe(200);
    expect(res.body.tam.id).toBe(otherTam.userId);
  });
});

describe("PATCH /customers/:id — un-owning guard (Decision 4 anti-bypass)", () => {
  it("a TAM un-owning their own OWNED customer without project:view-all is 400 tam_required", async () => {
    const owner = await createUserWithRole("TAM");
    const customer = await createCustomer({ tamId: owner.userId, name: uniq("Owned Un-owning") });

    const res = await request(app)
      .patch(`/customers/${customer.id}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ tamId: null });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("tam_required");
  });

  // The customer is already unowned, so `tamId: null` isn't an un-owning
  // move at all — it's the edit form re-saving its current (unowned) state,
  // which must keep working for a plain TAM, not just a view-all user.
  it("re-saving tamId: null on an already-unowned customer stays 200 and unowned", async () => {
    const tam = await createUserWithRole("TAM");
    const customer = await createCustomer({ tamId: null, name: uniq("Already Unowned") });

    const res = await request(app)
      .patch(`/customers/${customer.id}`)
      .set("Authorization", `Bearer ${tam.token}`)
      .send({ tamId: null });
    expect(res.status).toBe(200);
    expect(res.body.tam).toBeNull();
  });
});
