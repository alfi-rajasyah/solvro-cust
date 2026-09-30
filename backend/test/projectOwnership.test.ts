// Ownership stays with owners (docs/archive/plans/collaboration-and-sharing.md,
// "Phase 2 decisions"): project membership alone must not allow changing a
// project's TAM or customer, deleting a project, changing a customer's owner,
// or deleting a customer. Visible-but-member-only callers get 403 `owner_only`;
// non-members keep getting 404.
import "./env.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { createUserWithRole, seedRoles } from "./testAuth.js";

const app = createApp();

beforeAll(async () => {
  await seedRoles();
});

const uniq = (label: string) => `${label} ${Date.now()}-${Math.random()}`;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** owner: customer owner + project TAM. member: only a project member. */
async function fixture() {
  const owner = await createUserWithRole("TAM");
  const member = await createUserWithRole("TAM");
  const outsider = await createUserWithRole("TAM");
  const customer = await prisma.customer.create({
    data: { name: uniq("Customer"), description: "d", tamId: owner.userId },
  });
  const project = await prisma.project.create({
    data: { name: uniq("Project"), tamId: owner.userId, customerId: customer.id, status: "ACTIVE" },
  });
  await prisma.projectMember.create({ data: { projectId: project.id, userId: member.userId } });
  return { owner, member, outsider, customer, project };
}

describe("member-only access is refused owner actions (403 owner_only)", () => {
  it("PATCH /projects/:id — tamId", async () => {
    const { member, project, owner } = await fixture();
    const res = await request(app)
      .patch(`/projects/${project.id}`)
      .set(auth(member.token))
      .send({ tamId: member.userId });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("owner_only");
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).tamId).toBe(owner.userId);
  });

  it("PATCH /projects/:id — customerId", async () => {
    const { member, project, customer } = await fixture();
    const target = await prisma.customer.create({
      data: { name: uniq("Target"), description: "d", tamId: null },
    });
    const res = await request(app)
      .patch(`/projects/${project.id}`)
      .set(auth(member.token))
      .send({ customerId: target.id });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("owner_only");
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).customerId).toBe(customer.id);
  });

  it("PATCH /projects/:id — other fields, and re-sending the current tamId/customerId, still work", async () => {
    const { member, project, owner, customer } = await fixture();
    const res = await request(app)
      .patch(`/projects/${project.id}`)
      .set(auth(member.token))
      .send({ name: "Renamed by member", status: "ON_HOLD", tamId: owner.userId, customerId: customer.id });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Renamed by member");
  });

  it("DELETE /projects/:id", async () => {
    const { member, project } = await fixture();
    const res = await request(app).delete(`/projects/${project.id}`).set(auth(member.token));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("owner_only");
    expect(await prisma.project.count({ where: { id: project.id } })).toBe(1);
  });

  it("PATCH /customers/:id — tamId (take-over), but name edits and re-sending the owner still work", async () => {
    const { member, customer, owner } = await fixture();
    const res = await request(app)
      .patch(`/customers/${customer.id}`)
      .set(auth(member.token))
      .send({ tamId: member.userId });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("owner_only");
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).tamId).toBe(owner.userId);

    const ok = await request(app)
      .patch(`/customers/${customer.id}`)
      .set(auth(member.token))
      .send({ accountManager: "Someone", tamId: owner.userId });
    expect(ok.status).toBe(200);
  });

  it("DELETE /customers/:id", async () => {
    const { member, customer } = await fixture();
    const res = await request(app).delete(`/customers/${customer.id}`).set(auth(member.token));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("owner_only");
    expect(await prisma.customer.count({ where: { id: customer.id } })).toBe(1);
  });
});

describe("owners keep their access", () => {
  it("the project TAM can change the TAM and customer, then delete the project", async () => {
    const { owner, member, project } = await fixture();
    const target = await prisma.customer.create({
      data: { name: uniq("Target"), description: "d", tamId: owner.userId },
    });
    const patch = await request(app)
      .patch(`/projects/${project.id}`)
      .set(auth(owner.token))
      .send({ tamId: member.userId, customerId: target.id });
    expect(patch.status).toBe(200);

    // owner is no longer the TAM, but still owns the (target) customer, so
    // still sees and may delete the project through the customer arm.
    const del = await request(app).delete(`/projects/${project.id}`).set(auth(owner.token));
    expect(del.status).toBe(204);
  });

  it("the customer owner can change the owner and delete the customer", async () => {
    const { owner, member, customer } = await fixture();
    const patch = await request(app)
      .patch(`/customers/${customer.id}`)
      .set(auth(owner.token))
      .send({ tamId: member.userId });
    expect(patch.status).toBe(200);

    const c2 = await prisma.customer.create({
      data: { name: uniq("C2"), description: "d", tamId: owner.userId },
    });
    const del = await request(app).delete(`/customers/${c2.id}`).set(auth(owner.token));
    expect(del.status).toBe(204);
  });

  it("a project TAM on someone else's customer (no membership needed) may delete their project but not the customer's owner change", async () => {
    const owner = await createUserWithRole("TAM");
    const tam = await createUserWithRole("TAM");
    const customer = await prisma.customer.create({
      data: { name: uniq("Cust"), description: "d", tamId: owner.userId },
    });
    const project = await prisma.project.create({
      data: { name: uniq("P"), tamId: tam.userId, customerId: customer.id, status: "ACTIVE" },
    });
    // Same as before members existed: the project's TAM sees the customer via
    // their project, so owner-level customer actions were already open to them.
    const del = await request(app).delete(`/projects/${project.id}`).set(auth(tam.token));
    expect(del.status).toBe(204);
  });

  it("a project:view-all user (ADMIN) can do all of it", async () => {
    const { member, project, customer } = await fixture();
    const admin = await createUserWithRole("ADMIN");
    const patch = await request(app)
      .patch(`/projects/${project.id}`)
      .set(auth(admin.token))
      .send({ tamId: member.userId });
    expect(patch.status).toBe(200);
    const cpatch = await request(app)
      .patch(`/customers/${customer.id}`)
      .set(auth(admin.token))
      .send({ tamId: member.userId });
    expect(cpatch.status).toBe(200);
    expect((await request(app).delete(`/projects/${project.id}`).set(auth(admin.token))).status).toBe(204);
    expect((await request(app).delete(`/customers/${customer.id}`).set(auth(admin.token))).status).toBe(204);
  });

  it("an unowned customer stays deletable by anyone who can see it", async () => {
    const someone = await createUserWithRole("TAM");
    const customer = await prisma.customer.create({
      data: { name: uniq("Unowned"), description: "d", tamId: null },
    });
    const res = await request(app).delete(`/customers/${customer.id}`).set(auth(someone.token));
    expect(res.status).toBe(204);
  });
});

describe("non-members still get 404", () => {
  it("on every owner action", async () => {
    const { outsider, project, customer } = await fixture();
    // The customer is owned by someone else and the outsider has no project on it.
    for (const [method, path, body] of [
      ["patch", `/projects/${project.id}`, { tamId: outsider.userId }],
      ["delete", `/projects/${project.id}`, undefined],
      ["patch", `/customers/${customer.id}`, { tamId: outsider.userId }],
      ["delete", `/customers/${customer.id}`, undefined],
    ] as const) {
      const req = request(app)[method](path).set(auth(outsider.token));
      const res = await (body ? req.send(body) : req);
      expect(res.status, `${method} ${path}`).toBe(404);
    }
  });
});
