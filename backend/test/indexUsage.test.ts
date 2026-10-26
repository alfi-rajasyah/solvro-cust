import "./env.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/prisma.js";
import { seedRoles, createAdminAndToken } from "./testAuth.js";

const seededProjectIds: number[] = [];

beforeAll(async () => {
  await seedRoles();
});

// The filler rows are removed afterwards: other suites list tasks across all
// projects and must not see thousands of extra rows.
afterAll(async () => {
  await prisma.project.deleteMany({ where: { id: { in: seededProjectIds } } });
});

// Regression evidence that the query shapes behind GET /search and the
// project activity feed are served by their indexes. Seeds enough rows that
// the planner prefers an index, and asserts the named index appears in the
// plan (not a full plan snapshot, which would be brittle).

async function plan(sql: string): Promise<string> {
  return prisma.$transaction(async (tx) => {
    // Force the choice the index exists for; the assertion is that the index
    // can serve the query shape, independent of table-size heuristics.
    await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
    const rows = await tx.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(`EXPLAIN ${sql}`);
    return rows.map((r) => r["QUERY PLAN"]).join("\n");
  });
}

describe("index usage", () => {
  it("serves leading-wildcard ILIKE on task title, project name and customer name via trigram indexes", async () => {
    const user = { id: (await createAdminAndToken()).userId };
    const project = await prisma.project.create({
      data: { name: `IdxProj ${Date.now()}`, tamId: user.id },
    });
    seededProjectIds.push(project.id);
    await prisma.$executeRawUnsafe(
      `INSERT INTO tasks (project_id, title)
       SELECT ${project.id}, 'filler task ' || md5(g::text) FROM generate_series(1, 5000) g`,
    );
    await prisma.$executeRawUnsafe("ANALYZE tasks");

    const tasks = await plan(`SELECT id FROM tasks WHERE title ILIKE '%needle%' LIMIT 8`);
    expect(tasks).toContain("tasks_title_trgm_idx");
    const projects = await plan(`SELECT id FROM projects WHERE name ILIKE '%needle%' LIMIT 8`);
    expect(projects).toContain("projects_name_trgm_idx");
    const customers = await plan(`SELECT id FROM customers WHERE name ILIKE '%needle%' LIMIT 8`);
    expect(customers).toContain("customers_name_trgm_idx");
  });

  it("serves the activity feed's project + id DESC keyset query via its index", async () => {
    const user = { id: (await createAdminAndToken()).userId };
    // Many projects, so a primary-key scan filtered by project is a poor plan.
    const projects = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        prisma.project.create({ data: { name: `IdxAct ${Date.now()}-${i}`, tamId: user.id } }),
      ),
    );
    seededProjectIds.push(...projects.map((p) => p.id));
    const project = projects[0]!;
    await prisma.$executeRawUnsafe(
      `INSERT INTO activity_events (project_id, entity_type, entity_id, action)
       SELECT p.id, 'task', g, 'updated'
         FROM generate_series(1, 500) g
         CROSS JOIN (SELECT id FROM projects WHERE id IN (${projects.map((p) => p.id).join(",")})) p`,
    );
    await prisma.$executeRawUnsafe("ANALYZE activity_events");
    const out = await plan(
      `SELECT id FROM activity_events WHERE project_id = ${project.id} AND id < 1000000 ORDER BY id DESC LIMIT 51`,
    );
    expect(out).toContain("activity_events_project_id_id_idx");
  });
});
