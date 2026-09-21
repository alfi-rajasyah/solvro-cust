// projectVisibilityFilter — the owned-customer arm (docs/plans/
// customer-visibility-spec.md §3 Decision 14): a user who owns a customer as
// TAM (`Customer.tamId`) sees every project of that customer, including the
// ones where another user is the project TAM, and can act on them (reviews,
// notes). Projects of customers they don't own and aren't attached to stay
// hidden — 404, never 403. Fixtures write via `prisma` directly.
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

function uniq(label: string): string {
  return `${label} ${Date.now()}-${Math.random()}`;
}

async function createCustomer(tamId: number | null) {
  return prisma.customer.create({
    data: { name: uniq("Customer"), description: "d", tamId },
  });
}

async function createProject(customerId: number, tamId: number) {
  return prisma.project.create({
    data: { name: uniq("Project"), tamId, customerId, status: "ACTIVE" },
  });
}

/**
 * owner  — TAM who owns customer C (but is project TAM on none of its projects)
 * other  — TAM who is the project TAM on both projects, and owns customer D
 * C/P    — customer owned by `owner`, project P under it with tamId = other
 * D/Q    — customer owned by `other`, project Q under it with tamId = other
 */
async function fixture() {
  const owner = await createUserWithRole("TAM");
  const other = await createUserWithRole("TAM");
  const c = await createCustomer(owner.userId);
  const d = await createCustomer(other.userId);
  const p = await createProject(c.id, other.userId);
  const q = await createProject(d.id, other.userId);
  return { owner, other, c, d, p, q };
}

describe("projectVisibilityFilter — owned-customer arm (Decision 14)", () => {
  it("GET /projects lists the owned customer's project even when another user is its TAM, and hides an unrelated one", async () => {
    const { owner, p, q } = await fixture();
    const res = await request(app)
      .get("/projects")
      .set("Authorization", `Bearer ${owner.token}`);
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: number }>).map((x) => x.id);
    expect(ids).toContain(p.id);
    expect(ids).not.toContain(q.id);
  });

  it("GET /projects/:id — 200 for the owned customer's project, 404 for the unrelated one", async () => {
    const { owner, p, q } = await fixture();
    const ok = await request(app)
      .get(`/projects/${p.id}`)
      .set("Authorization", `Bearer ${owner.token}`);
    expect(ok.status).toBe(200);
    expect(ok.body.id).toBe(p.id);

    const hidden = await request(app)
      .get(`/projects/${q.id}`)
      .set("Authorization", `Bearer ${owner.token}`);
    expect(hidden.status).toBe(404);
  });

  it("the customer's owner can mark the project reviewed and log a note on it", async () => {
    const { owner, p } = await fixture();
    const review = await request(app)
      .post(`/projects/${p.id}/reviews`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ reviewDate: "2026-08-28" });
    expect(review.status).toBe(201);

    const note = await request(app)
      .post(`/projects/${p.id}/notes`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ body: "Reviewed with the account team", noteDate: "2026-08-28" });
    expect(note.status).toBe(201);
    expect(note.body.projectId).toBe(p.id);
  });

  it("the customer's owner can change a task's status on that project (the silent-rollback symptom)", async () => {
    const { owner, p } = await fixture();
    const task = await prisma.task.create({
      data: { projectId: p.id, title: "Kickoff", status: "TODO" },
    });
    const res = await request(app)
      .patch(`/tasks/${task.id}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ status: "IN_PROGRESS" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("IN_PROGRESS");
  });

  it("the owner cannot review a project of a customer they don't own: 404", async () => {
    const { owner, q } = await fixture();
    const res = await request(app)
      .post(`/projects/${q.id}/reviews`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ reviewDate: "2026-08-28" });
    expect(res.status).toBe(404);
  });

  it("an unowned customer (tamId null) grants nobody project access through this arm", async () => {
    const nobody = await createUserWithRole("TAM");
    const other = await createUserWithRole("TAM");
    const unowned = await createCustomer(null);
    const proj = await createProject(unowned.id, other.userId);
    const res = await request(app)
      .get(`/projects/${proj.id}`)
      .set("Authorization", `Bearer ${nobody.token}`);
    expect(res.status).toBe(404);
  });
});
