import "./env.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { signToken } from "../src/http/auth.js";
import { seedRoles, createAdminAndToken } from "./testAuth.js";

// Uses the real createApp() (as backend/test/opportunities.test.ts does),
// not a local scaffold — src/app.ts:64-65 mounts opportunitiesRouter and
// opportunityItemsRouter at the same "/opportunities" base path (the former
// owns CRUD + move, the latter owns /:opportunityId/activities and
// /:opportunityId/links), so exercising the real app is what actually
// covers that two-routers-one-base-path arrangement — a future shadowing
// route would fail loudly here instead of passing against an isolated app.
const app = createApp();

let roleCounter = 0;

// Built-in seeded roles (mirrored in testAuth.ts) don't include a
// pipeline:view-only combination, so this creates a one-off role for cases
// that need an exact permission set.
async function createUserWithPermissions(
  permissions: string[],
): Promise<{ userId: number; token: string }> {
  roleCounter += 1;
  const role = await prisma.role.create({
    data: { roleName: `test-pipeline-role-${roleCounter}-${Date.now()}`, permissions },
  });
  const user = await prisma.user.create({
    data: {
      username: `test-pipeline-user-${roleCounter}-${Date.now()}`,
      email: `test-pipeline-user-${roleCounter}-${Date.now()}@example.com`,
      passwordHash: null,
      roleId: role.id,
      active: true,
    },
  });
  const token = signToken({ sub: user.id, role: role.roleName, permissions });
  return { userId: user.id, token };
}

// SA is the PRD's real pipeline:view/edit_own role, and test/testAuth.ts's
// seeded SA already carries the pipeline:* grants. Explicit permission sets
// are used here anyway, since they're more precise: each case tests exactly
// the permission combination it's about, independent of whatever the
// seeded SA role happens to include.
async function createViewer(): Promise<{ userId: number; token: string }> {
  return createUserWithPermissions(["pipeline:view"]);
}

async function createOwnerCapableUser(): Promise<{ userId: number; token: string }> {
  return createUserWithPermissions(["pipeline:view", "pipeline:edit_own"]);
}

async function createOpportunity(
  overrides: { picId?: number | null; title?: string; customerName?: string } = {},
) {
  return prisma.opportunity.create({
    data: {
      title: overrides.title ?? `Deal ${Date.now()}-${Math.random()}`,
      customerName: overrides.customerName ?? "Acme Corp",
      picId: overrides.picId ?? null,
    },
  });
}

beforeAll(async () => {
  await seedRoles();
});

describe("activities", () => {
  it("creates activities and lists them newest first, with the acting user attached", async () => {
    const viewer = await createViewer();
    const opportunity = await createOpportunity();

    const first = await request(app)
      .post(`/opportunities/${opportunity.id}/activities`)
      .set("Authorization", `Bearer ${viewer.token}`)
      .send({ note: "First note" });
    expect(first.status).toBe(201);
    expect(first.body.note).toBe("First note");
    expect(first.body.user).toMatchObject({ id: viewer.userId });

    const second = await request(app)
      .post(`/opportunities/${opportunity.id}/activities`)
      .set("Authorization", `Bearer ${viewer.token}`)
      .send({ note: "Second note" });
    expect(second.status).toBe(201);

    const list = await request(app)
      .get(`/opportunities/${opportunity.id}/activities`)
      .set("Authorization", `Bearer ${viewer.token}`);
    expect(list.status).toBe(200);
    expect(list.body.map((a: { note: string }) => a.note)).toEqual(["Second note", "First note"]);
    expect(list.body[0].user).toMatchObject({
      id: viewer.userId,
      username: expect.any(String),
    });
  });

  it("rejects an empty note with a 400", async () => {
    const viewer = await createViewer();
    const opportunity = await createOpportunity();

    const res = await request(app)
      .post(`/opportunities/${opportunity.id}/activities`)
      .set("Authorization", `Bearer ${viewer.token}`)
      .send({ note: "   " });
    expect(res.status).toBe(400);
  });

  it("a pipeline:view-only user CAN post an activity note", async () => {
    const viewOnly = await createUserWithPermissions(["pipeline:view"]);
    const opportunity = await createOpportunity();

    const res = await request(app)
      .post(`/opportunities/${opportunity.id}/activities`)
      .set("Authorization", `Bearer ${viewOnly.token}`)
      .send({ note: "Touching base" });
    expect(res.status).toBe(201);
  });

  it("404s GET activities for an unknown opportunity", async () => {
    const viewer = await createViewer();
    const res = await request(app)
      .get(`/opportunities/00000000-0000-4000-8000-000000000000/activities`)
      .set("Authorization", `Bearer ${viewer.token}`);
    expect(res.status).toBe(404);
  });

  it("404s POST activities for an unknown opportunity", async () => {
    const viewer = await createViewer();
    const res = await request(app)
      .post(`/opportunities/00000000-0000-4000-8000-000000000000/activities`)
      .set("Authorization", `Bearer ${viewer.token}`)
      .send({ note: "Hello" });
    expect(res.status).toBe(404);
  });
});

describe("links", () => {
  it("lists links ordered oldest first", async () => {
    const admin = await createAdminAndToken();
    const opportunity = await createOpportunity();

    const a = await request(app)
      .post(`/opportunities/${opportunity.id}/links`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ label: "Proposal doc", url: "https://docs.example.com/a" });
    expect(a.status).toBe(201);

    const b = await request(app)
      .post(`/opportunities/${opportunity.id}/links`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ label: "Contract", url: "https://docs.example.com/b" });
    expect(b.status).toBe(201);

    const list = await request(app)
      .get(`/opportunities/${opportunity.id}/links`)
      .set("Authorization", `Bearer ${admin.token}`);
    expect(list.status).toBe(200);
    expect(list.body.map((l: { id: string }) => l.id)).toEqual([a.body.id, b.body.id]);
  });

  it("a pipeline:view-only user CANNOT add a link (403)", async () => {
    const viewOnly = await createUserWithPermissions(["pipeline:view"]);
    const opportunity = await createOpportunity();

    const res = await request(app)
      .post(`/opportunities/${opportunity.id}/links`)
      .set("Authorization", `Bearer ${viewOnly.token}`)
      .send({ label: "Doc", url: "https://example.com/doc" });
    expect(res.status).toBe(403);
  });

  it("rejects an invalid URL with a 400", async () => {
    const admin = await createAdminAndToken();
    const opportunity = await createOpportunity();

    const res = await request(app)
      .post(`/opportunities/${opportunity.id}/links`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ label: "Doc", url: "not-a-url" });
    expect(res.status).toBe(400);
  });

  it("rejects a non-http(s) URL scheme with a 400", async () => {
    const admin = await createAdminAndToken();
    const opportunity = await createOpportunity();

    const res = await request(app)
      .post(`/opportunities/${opportunity.id}/links`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ label: "Doc", url: "ftp://example.com/doc" });
    expect(res.status).toBe(400);
  });

  it("404s links routes for an unknown opportunity", async () => {
    const admin = await createAdminAndToken();
    const res = await request(app)
      .get(`/opportunities/00000000-0000-4000-8000-000000000000/links`)
      .set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(404);
  });

  describe("edit gate: pipeline:edit_own", () => {
    it("lets the PIC (owner) add, patch, and delete a link", async () => {
      const owner = await createOwnerCapableUser();
      const opportunity = await createOpportunity({ picId: owner.userId });

      const created = await request(app)
        .post(`/opportunities/${opportunity.id}/links`)
        .set("Authorization", `Bearer ${owner.token}`)
        .send({ label: "Doc", url: "https://example.com/doc" });
      expect(created.status).toBe(201);

      const patched = await request(app)
        .patch(`/opportunities/${opportunity.id}/links/${created.body.id}`)
        .set("Authorization", `Bearer ${owner.token}`)
        .send({ label: "Renamed doc" });
      expect(patched.status).toBe(200);
      expect(patched.body.label).toBe("Renamed doc");
      expect(patched.body.url).toBe("https://example.com/doc"); // untouched

      const deleted = await request(app)
        .delete(`/opportunities/${opportunity.id}/links/${created.body.id}`)
        .set("Authorization", `Bearer ${owner.token}`);
      expect(deleted.status).toBe(204);

      const list = await request(app)
        .get(`/opportunities/${opportunity.id}/links`)
        .set("Authorization", `Bearer ${owner.token}`);
      expect(list.body).toEqual([]);
    });

    it("403s a pipeline:edit_own user who isn't the PIC", async () => {
      const owner = await createOwnerCapableUser();
      const nonOwner = await createOwnerCapableUser();
      const opportunity = await createOpportunity({ picId: owner.userId });

      const res = await request(app)
        .post(`/opportunities/${opportunity.id}/links`)
        .set("Authorization", `Bearer ${nonOwner.token}`)
        .send({ label: "Doc", url: "https://example.com/doc" });
      expect(res.status).toBe(403);
    });
  });

  describe("edit gate: pipeline:edit_all", () => {
    it("lets an edit_all (admin wildcard) user edit a link they don't own", async () => {
      const owner = await createOwnerCapableUser();
      const admin = await createAdminAndToken();
      const opportunity = await createOpportunity({ picId: owner.userId });

      const created = await request(app)
        .post(`/opportunities/${opportunity.id}/links`)
        .set("Authorization", `Bearer ${owner.token}`)
        .send({ label: "Doc", url: "https://example.com/doc" });
      expect(created.status).toBe(201);

      const patched = await request(app)
        .patch(`/opportunities/${opportunity.id}/links/${created.body.id}`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ url: "https://example.com/doc-v2" });
      expect(patched.status).toBe(200);
      expect(patched.body.url).toBe("https://example.com/doc-v2");
    });
  });

  describe("cross-opportunity 404s", () => {
    it("404s a PATCH when the link belongs to a different opportunity", async () => {
      const admin = await createAdminAndToken();
      const opportunityA = await createOpportunity();
      const opportunityB = await createOpportunity();

      const created = await request(app)
        .post(`/opportunities/${opportunityA.id}/links`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ label: "Doc", url: "https://example.com/doc" });
      expect(created.status).toBe(201);

      const res = await request(app)
        .patch(`/opportunities/${opportunityB.id}/links/${created.body.id}`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ label: "Renamed" });
      expect(res.status).toBe(404);
    });

    it("404s a DELETE when the link belongs to a different opportunity", async () => {
      const admin = await createAdminAndToken();
      const opportunityA = await createOpportunity();
      const opportunityB = await createOpportunity();

      const created = await request(app)
        .post(`/opportunities/${opportunityA.id}/links`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ label: "Doc", url: "https://example.com/doc" });
      expect(created.status).toBe(201);

      const res = await request(app)
        .delete(`/opportunities/${opportunityB.id}/links/${created.body.id}`)
        .set("Authorization", `Bearer ${admin.token}`);
      expect(res.status).toBe(404);

      // Untouched: still fetchable under its real opportunity.
      const list = await request(app)
        .get(`/opportunities/${opportunityA.id}/links`)
        .set("Authorization", `Bearer ${admin.token}`);
      expect(list.body.map((l: { id: string }) => l.id)).toEqual([created.body.id]);
    });
  });
});
