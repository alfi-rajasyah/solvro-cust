import "./env.js";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { signToken } from "../src/http/auth.js";
import { seedRoles } from "./testAuth.js";

// POST /opportunities/:id/handoff — the native port's one-transaction
// won-deal -> Solvro project handoff (M5.23). Mirrors opportunities.test.ts's
// house pattern: a local, per-test permission-set helper rather than the
// fixed SA/TAM shapes in testAuth.ts, so each test is explicit about which
// permission combination it's exercising.

const app = createApp();

let roleCounter = 0;

async function createUserWithPermissions(
  permissions: string[],
): Promise<{ userId: number; token: string }> {
  roleCounter += 1;
  const role = await prisma.role.create({
    data: { roleName: `test-handoff-role-${roleCounter}-${Date.now()}`, permissions },
  });
  const user = await prisma.user.create({
    data: {
      username: `test-handoff-user-${roleCounter}-${Date.now()}`,
      email: `test-handoff-user-${roleCounter}-${Date.now()}@example.com`,
      passwordHash: null,
      roleId: role.id,
      active: true,
    },
  });
  const token = signToken({ sub: user.id, role: role.roleName, permissions });
  return { userId: user.id, token };
}

// Full permission set a real SA Manager doing a handoff would need:
// pipeline view/create (test setup: creating + moving the deal to WON) plus
// edit_all (deal-edit gate) and project:write (the other half of the
// composed gate).
async function createHandoffCapableUser(): Promise<{ userId: number; token: string }> {
  return createUserWithPermissions([
    "pipeline:view",
    "pipeline:create",
    "pipeline:edit_all",
    "project:write",
  ]);
}

let customerCounter = 0;
async function createCustomer(): Promise<number> {
  customerCounter += 1;
  const customer = await prisma.customer.create({
    data: { name: `Handoff Test Co ${customerCounter}-${Date.now()}`, description: "d" },
  });
  return customer.id;
}

function createOpportunity(token: string, body: Record<string, unknown> = {}) {
  return request(app)
    .post("/opportunities")
    .set("Authorization", `Bearer ${token}`)
    .send({ title: "Handoff Deal", customerName: "Acme Corp", ...body });
}

function getOpportunity(token: string, id: string) {
  return request(app).get(`/opportunities/${id}`).set("Authorization", `Bearer ${token}`);
}

function patchOpportunity(token: string, id: string, body: Record<string, unknown>) {
  return request(app)
    .patch(`/opportunities/${id}`)
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

function handoff(token: string, id: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/opportunities/${id}/handoff`)
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

function createProject(token: string, body: Record<string, unknown>) {
  return request(app).post("/projects").set("Authorization", `Bearer ${token}`).send(body);
}

async function activitiesFor(opportunityId: string) {
  return prisma.opportunityActivity.findMany({
    where: { opportunityId },
    orderBy: { createdAt: "asc" },
  });
}

// Creates a WON opportunity owned (picId) by `token`'s user, ready to hand off.
async function createWonOpportunity(token: string, userId: number): Promise<string> {
  const created = await createOpportunity(token, { picId: userId, stage: "WON" });
  expect(created.status).toBe(201);
  return created.body.id as string;
}

beforeAll(async () => {
  await seedRoles();
});

describe("POST /opportunities/:id/handoff — happy path", () => {
  it("creates the project with every POST /projects side effect replicated, links the deal, and logs an activity", async () => {
    const sa = await createHandoffCapableUser();
    const tam = await createUserWithPermissions(["project:write"]);
    const customerId = await createCustomer();
    const id = await createWonOpportunity(sa.token, sa.userId);

    const res = await handoff(sa.token, id, {
      name: "Acme Rollout",
      description: "From pipeline deal: Handoff Deal",
      saId: sa.userId,
      tamId: tam.userId,
      customerId,
      status: "ACTIVE",
      wipLimits: { TODO: 5, IN_PROGRESS: 3, DONE: null },
      excludeFromPortfolio: true,
    });

    expect(res.status).toBe(201);
    expect(res.body.project).toMatchObject({
      name: "Acme Rollout",
      description: "From pipeline deal: Handoff Deal",
      saId: sa.userId,
      tamId: tam.userId,
      customerId,
      status: "ACTIVE",
      wipLimits: { TODO: 5, IN_PROGRESS: 3, DONE: null },
      excludeFromPortfolio: true,
    });
    const projectId = res.body.project.id as number;

    // Response's own opportunity payload reflects the link.
    expect(res.body.opportunity.id).toBe(id);
    expect(res.body.opportunity.projectId).toBe(projectId);
    expect(res.body.opportunity.pic).toEqual({
      id: sa.userId,
      username: expect.any(String),
      avatarUrl: null,
    });

    // Link persisted, not just echoed in the response.
    const fetched = await getOpportunity(sa.token, id);
    expect(fetched.body.projectId).toBe(projectId);

    // Activity written with the expected note and acting user.
    const activities = await activitiesFor(id);
    expect(activities).toHaveLength(1);
    expect(activities[0].note).toBe('Handed off to project "Acme Rollout"');
    expect(activities[0].userId).toBe(sa.userId);
  });

  it("defaults tamId to the caller, status to PLANNING, and excludeFromPortfolio to false when omitted — same defaults POST /projects applies", async () => {
    const sa = await createHandoffCapableUser();
    const customerId = await createCustomer();
    const id = await createWonOpportunity(sa.token, sa.userId);

    const res = await handoff(sa.token, id, { name: "Minimal Rollout", customerId });

    expect(res.status).toBe(201);
    expect(res.body.project.tamId).toBe(sa.userId);
    expect(res.body.project.status).toBe("PLANNING");
    expect(res.body.project.excludeFromPortfolio).toBe(false);
    expect(res.body.project.saId).toBeNull();
  });
});

describe("POST /opportunities/:id/handoff — error paths", () => {
  it("404s an unknown deal id", async () => {
    const sa = await createHandoffCapableUser();
    const customerId = await createCustomer();

    const res = await handoff(sa.token, randomUUID(), { name: "Ghost Deal", customerId });
    expect(res.status).toBe(404);
  });

  it("409s (not_won) a deal that isn't in stage WON", async () => {
    const sa = await createHandoffCapableUser();
    const customerId = await createCustomer();
    const created = await createOpportunity(sa.token, { picId: sa.userId, stage: "ASSESSMENT" });
    const id = created.body.id as string;

    const res = await handoff(sa.token, id, { name: "Too Early", customerId });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("not_won");
  });

  it("409s (already_linked) a deal that already has a project", async () => {
    const sa = await createHandoffCapableUser();
    const customerId = await createCustomer();
    const id = await createWonOpportunity(sa.token, sa.userId);

    const first = await handoff(sa.token, id, { name: "First Project", customerId });
    expect(first.status).toBe(201);

    const second = await handoff(sa.token, id, { name: "Second Project", customerId });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("already_linked");

    // Only one project ended up linked — the second attempt created nothing.
    const fetched = await getOpportunity(sa.token, id);
    expect(fetched.body.projectId).toBe(first.body.project.id);
  });

  it("under concurrent handoff attempts, exactly one succeeds and the rest get the accurate already_linked code from the post-updateMany re-read (finding N7)", async () => {
    // Fires several handoff calls for the SAME won deal at once — unlike
    // the sequential "already_linked" test above (whose second call is
    // already caught by the pre-transaction `current.projectId !== null`
    // check, never touching the updateMany-failure branch at all), these
    // race for real: Postgres serializes the conflicting `updateMany`s
    // (each conditioned on `projectId: null`), so only one can ever
    // succeed — the rest hit N7's re-read path with `count === 0` and must
    // report `already_linked`, never `not_won` (the deal's stage never
    // changes here), deterministically regardless of exact interleaving.
    const sa = await createHandoffCapableUser();
    const customerId = await createCustomer();
    const id = await createWonOpportunity(sa.token, sa.userId);

    const attempts = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        handoff(sa.token, id, { name: `Concurrent Rollout ${i}`, customerId }),
      ),
    );

    const succeeded = attempts.filter((r) => r.status === 201);
    const conflicted = attempts.filter((r) => r.status === 409);
    expect(succeeded).toHaveLength(1);
    expect(conflicted).toHaveLength(4);
    for (const res of conflicted) {
      expect(res.body.code).toBe("already_linked");
    }

    // Only the winner's project ended up linked.
    const fetched = await getOpportunity(sa.token, id);
    expect(fetched.body.projectId).toBe(succeeded[0]!.body.project.id);

    // The 4 losers' transactions ROLLED BACK their project creates — this is
    // the entire point of the conditional updateMany; a regression to a plain
    // .update would orphan 4 unlinked projects and keep the rest green.
    const projectCount = await prisma.project.count({
      where: { name: { startsWith: "Concurrent Rollout" } },
    });
    expect(projectCount).toBe(1);
  });

  it("403s (missing project:write) a deal-editor who lacks project:write", async () => {
    const sa = await createUserWithPermissions([
      "pipeline:view",
      "pipeline:create",
      "pipeline:edit_own",
    ]);
    const customerId = await createCustomer();
    const id = await createWonOpportunity(sa.token, sa.userId);

    const res = await handoff(sa.token, id, { name: "No Project Write", customerId });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/project:write/);

    // Nothing was created or linked.
    const fetched = await getOpportunity(sa.token, id);
    expect(fetched.body.projectId).toBeNull();
  });

  it("403s (deal-edit gate) a project:write holder who isn't the PIC and lacks edit_all", async () => {
    const owner = await createHandoffCapableUser();
    const outsider = await createUserWithPermissions(["pipeline:edit_own", "project:write"]);
    const customerId = await createCustomer();
    const id = await createWonOpportunity(owner.token, owner.userId);

    const res = await handoff(outsider.token, id, { name: "Not My Deal", customerId });
    expect(res.status).toBe(403);
    // assertCanWriteOpportunity's own message, not the project:write one —
    // proves the deal-edit gate is checked (and fails) before project:write.
    expect(res.body.error).toMatch(/pipeline:edit_all|pipeline:edit_own/);

    const fetched = await getOpportunity(owner.token, id);
    expect(fetched.body.projectId).toBeNull();
  });

  it("mirrors POST /projects's body validation for a malformed tamId (same 4xx both routes give)", async () => {
    const sa = await createHandoffCapableUser();
    const customerId = await createCustomer();
    const id = await createWonOpportunity(sa.token, sa.userId);

    const projectsRes = await createProject(sa.token, {
      name: "Bad Tam",
      customerId,
      tamId: -1,
    });
    const handoffRes = await handoff(sa.token, id, {
      name: "Bad Tam Handoff",
      customerId,
      tamId: -1,
    });

    expect(projectsRes.status).toBeGreaterThanOrEqual(400);
    expect(projectsRes.status).toBeLessThan(500);
    expect(handoffRes.status).toBe(projectsRes.status);

    // Nothing got created or linked on the invalid-body attempt.
    const fetched = await getOpportunity(sa.token, id);
    expect(fetched.body.projectId).toBeNull();
  });
});

describe("Opportunity.projectId — not writable outside POST /:id/handoff", () => {
  it("400s a PATCH body containing projectId", async () => {
    const sa = await createHandoffCapableUser();
    const created = await createOpportunity(sa.token, { picId: sa.userId });
    const id = created.body.id as string;

    const res = await patchOpportunity(sa.token, id, { projectId: 1 });
    expect(res.status).toBe(400);

    const unchanged = await getOpportunity(sa.token, id);
    expect(unchanged.body.projectId).toBeNull();
  });

  it("400s a create body containing projectId", async () => {
    const sa = await createHandoffCapableUser();
    const res = await createOpportunity(sa.token, { projectId: 1 });
    expect(res.status).toBe(400);
  });
});
