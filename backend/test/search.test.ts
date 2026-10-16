import "./env.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { seedRoles, createAdminAndToken, createUserWithRole } from "./testAuth.js";

const app = createApp();

beforeAll(async () => {
  await seedRoles();
});

// Unique needle per run so accumulated rows in the shared solvro_test DB
// can never satisfy or break these assertions.
function needle(): string {
  return `srch${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

describe("GET /search", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app).get("/search").query({ q: "anything" });
    expect(res.status).toBe(401);
  });

  it("rejects a PENDING account (no project:read) with 403", async () => {
    const pending = await createUserWithRole("PENDING");
    const res = await request(app)
      .get("/search")
      .query({ q: "anything" })
      .set("Authorization", `Bearer ${pending.token}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("forbidden");
  });

  it("lets a TAM search", async () => {
    const tam = await createUserWithRole("TAM");
    const res = await request(app)
      .get("/search")
      .query({ q: "anything" })
      .set("Authorization", `Bearer ${tam.token}`);
    expect(res.status).toBe(200);
  });

  it("rejects q shorter than 2 chars and missing q with 400", async () => {
    const { token } = await createAdminAndToken();
    const short = await request(app)
      .get("/search")
      .query({ q: "a" })
      .set("Authorization", `Bearer ${token}`);
    expect(short.status).toBe(400);

    const missing = await request(app)
      .get("/search")
      .set("Authorization", `Bearer ${token}`);
    expect(missing.status).toBe(400);
  });

  it("returns matching projects, tasks, and customers with the documented shape", async () => {
    const { token, userId } = await createAdminAndToken();
    const n = needle();

    const customer = await prisma.customer.create({
      data: { name: `${n} Corp`, description: "d" },
    });
    const project = await prisma.project.create({
      data: { name: `${n} Project`, tamId: userId, customerId: customer.id },
    });
    const task = await prisma.task.create({
      data: { title: `${n} Task`, projectId: project.id, position: 0 },
    });

    const res = await request(app)
      .get("/search")
      .query({ q: n })
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);

    expect(res.body.projects).toEqual([
      {
        id: project.id,
        name: `${n} Project`,
        status: "PLANNING",
        customerName: `${n} Corp`,
      },
    ]);
    expect(res.body.tasks).toEqual([
      {
        id: task.id,
        title: `${n} Task`,
        status: "TODO",
        projectId: project.id,
        projectName: `${n} Project`,
      },
    ]);
    expect(res.body.customers).toEqual([{ id: customer.id, name: `${n} Corp` }]);
  });

  it("matches case-insensitively", async () => {
    const { token, userId } = await createAdminAndToken();
    const n = needle();
    await prisma.project.create({
      data: { name: `${n.toUpperCase()} MixedCase`, tamId: userId },
    });

    const res = await request(app)
      .get("/search")
      .query({ q: n }) // lowercase needle against uppercase name
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.projects).toHaveLength(1);
  });

  it("caps each group at 8 results", async () => {
    const { token } = await createAdminAndToken();
    const n = needle();
    for (let i = 0; i < 10; i++) {
      await prisma.customer.create({
        data: { name: `${n} cap ${i}`, description: "d" },
      });
    }

    const res = await request(app)
      .get("/search")
      .query({ q: n })
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.customers).toHaveLength(8);
  });

  it("scopes projects and tasks by projectVisibilityFilter (TAM sees own only; admin sees all)", async () => {
    const tam = await createUserWithRole("TAM");
    const otherTam = await createUserWithRole("TAM");
    const admin = await createAdminAndToken();
    const n = needle();

    const mine = await prisma.project.create({
      data: { name: `${n} mine`, tamId: tam.userId },
    });
    const other = await prisma.project.create({
      data: { name: `${n} other`, tamId: otherTam.userId },
    });
    await prisma.task.create({
      data: { title: `${n} mine-task`, projectId: mine.id, position: 0 },
    });
    await prisma.task.create({
      data: { title: `${n} other-task`, projectId: other.id, position: 0 },
    });

    const tamRes = await request(app)
      .get("/search")
      .query({ q: n })
      .set("Authorization", `Bearer ${tam.token}`);
    expect(tamRes.status).toBe(200);
    expect(tamRes.body.projects.map((p: { name: string }) => p.name)).toEqual([`${n} mine`]);
    expect(tamRes.body.tasks.map((t: { title: string }) => t.title)).toEqual([`${n} mine-task`]);

    const adminRes = await request(app)
      .get("/search")
      .query({ q: n })
      .set("Authorization", `Bearer ${admin.token}`);
    expect(adminRes.body.projects).toHaveLength(2);
    expect(adminRes.body.tasks).toHaveLength(2);
  });

  it("scopes customer hits by customerVisibilityFilter (Decision 11: an unrelated customer never surfaces)", async () => {
    const owner = await createUserWithRole("TAM");
    const tam = await createUserWithRole("TAM");
    const n = needle();

    // Hidden from `tam`: owned by another TAM, no project of `tam`'s.
    await prisma.customer.create({
      data: { name: `${n} unrelated`, description: "d", tamId: owner.userId },
    });
    // Visible: owned by `tam` themselves.
    await prisma.customer.create({
      data: { name: `${n} owned`, description: "d", tamId: tam.userId },
    });
    // Visible: unowned.
    await prisma.customer.create({
      data: { name: `${n} unowned`, description: "d", tamId: null },
    });

    const res = await request(app)
      .get("/search")
      .query({ q: n })
      .set("Authorization", `Bearer ${tam.token}`);
    expect(res.status).toBe(200);
    const names = res.body.customers.map((c: { name: string }) => c.name).sort();
    expect(names).toEqual([`${n} owned`, `${n} unowned`]);
  });

  it("escapes LIKE metacharacters so % and _ are not treated as wildcards", async () => {
    const { token, userId } = await createAdminAndToken();
    const n = needle();

    // Seed a row containing a literal "%" so we can prove a literal-percent
    // query only matches it (not the wildcard-inflated pattern), and rows
    // that a naive q="%%" wildcard search would otherwise match.
    await prisma.project.create({
      data: { name: `${n} 100% done`, tamId: userId },
    });
    await prisma.project.create({
      data: { name: `${n} unrelated`, tamId: userId },
    });

    const literalRes = await request(app)
      .get("/search")
      .query({ q: `${n} 100%` })
      .set("Authorization", `Bearer ${token}`);
    expect(literalRes.status).toBe(200);
    expect(literalRes.body.projects.map((p: { name: string }) => p.name)).toEqual([
      `${n} 100% done`,
    ]);

    // "%%" passes min(2) but must not become a match-everything wildcard.
    const wildcardRes = await request(app)
      .get("/search")
      .query({ q: "%%" })
      .set("Authorization", `Bearer ${token}`);
    expect(wildcardRes.status).toBe(200);
    expect(wildcardRes.body.projects).toEqual([]);
    expect(wildcardRes.body.tasks).toEqual([]);
    expect(wildcardRes.body.customers).toEqual([]);
  });

  it("excludes subtasks from task results", async () => {
    const { token, userId } = await createAdminAndToken();
    const n = needle();

    const project = await prisma.project.create({
      data: { name: `${n} Parent Project`, tamId: userId },
    });
    const topLevel = await prisma.task.create({
      data: { title: `${n} top-level`, projectId: project.id, position: 0 },
    });
    await prisma.task.create({
      data: {
        title: `${n} sub-task`,
        projectId: project.id,
        position: 0,
        parentTaskId: topLevel.id,
      },
    });

    const res = await request(app)
      .get("/search")
      .query({ q: n })
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.tasks.map((t: { title: string }) => t.title)).toEqual([`${n} top-level`]);
  });
});
