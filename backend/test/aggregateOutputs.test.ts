import "./env.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { computePortfolioRows } from "../src/lib/portfolio.js";
import { seedRoles, createAdminAndToken } from "./testAuth.js";

// Pins the exact output of the roll-ups that aggregate task rows in the
// database (portfolio rows, Daily Review progress/overdue/phase/slip), so a
// change to how they are computed cannot alter what the API returns.

const app = createApp();
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

let userId: number;
let token: string;

beforeAll(async () => {
  await seedRoles();
  ({ userId, token } = await createAdminAndToken());
});

describe("task roll-ups", () => {
  it("portfolio rows: counts, progress, date range and overdue", async () => {
    const project = await prisma.project.create({
      data: { name: `Agg ${Date.now()}-${Math.random()}`, tamId: userId, status: "ACTIVE" },
    });
    const empty = await prisma.project.create({
      data: { name: `AggEmpty ${Date.now()}-${Math.random()}`, tamId: userId, status: "ACTIVE" },
    });
    await prisma.task.createMany({
      data: [
        { projectId: project.id, title: "a", status: "DONE", startDate: d("2026-01-10"), dueDate: d("2026-01-20") },
        { projectId: project.id, title: "b", status: "TODO", startDate: d("2026-01-05"), dueDate: d("2026-03-01") },
        { projectId: project.id, title: "c", status: "IN_PROGRESS", startDate: null, dueDate: null },
        { projectId: project.id, title: "d", status: "DONE", startDate: d("2026-02-01"), dueDate: d("2026-02-02") },
      ],
    });

    const rows = await computePortfolioRows({ id: { in: [project.id, empty.id] } }, "2026-03-05");
    const row = rows.find((r) => r.id === project.id)!;
    expect(row.totalTasks).toBe(4);
    expect(row.doneTasks).toBe(2);
    expect(row.progressPct).toBe(50);
    expect(row.start).toBe("2026-01-05T00:00:00.000Z");
    expect(row.end).toBe("2026-03-01T00:00:00.000Z");
    expect(row.isOverdue).toBe(true);
    expect(row.daysOverdue).toBe(4);

    const emptyRow = rows.find((r) => r.id === empty.id)!;
    expect(emptyRow).toMatchObject({
      totalTasks: 0,
      doneTasks: 0,
      progressPct: 0,
      start: null,
      end: null,
      isOverdue: false,
      daysOverdue: 0,
    });

    const notYet = await computePortfolioRows({ id: project.id }, "2026-03-01");
    expect(notYet[0]!.isOverdue).toBe(false);
  });

  it("daily review: progress, phase, slip and overdue tasks", async () => {
    const customer = await prisma.customer.create({
      data: { name: `AggCust ${Date.now()}-${Math.random()}`, description: "", tamId: userId },
    });
    const project = await prisma.project.create({
      data: {
        name: `AggDR ${Date.now()}-${Math.random()}`,
        tamId: userId,
        customerId: customer.id,
        status: "ACTIVE",
        baselineLockedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    const s1 = await prisma.section.create({ data: { projectId: project.id, name: "Build", position: 1 } });
    const s2 = await prisma.section.create({ data: { projectId: project.id, name: "Launch", position: 2 } });
    await prisma.task.createMany({
      data: [
        { projectId: project.id, sectionId: s1.id, title: "t1", status: "DONE", dueDate: d("2026-03-01"), baselineDueDate: d("2026-03-01") },
        { projectId: project.id, sectionId: s1.id, title: "t2", status: "TODO", dueDate: d("2026-03-05"), baselineDueDate: d("2026-03-01") },
        { projectId: project.id, sectionId: s2.id, title: "t3", status: "TODO", dueDate: d("2026-04-10"), baselineDueDate: d("2026-04-01") },
        { projectId: project.id, title: "t4", status: "IN_PROGRESS", dueDate: null },
      ],
    });

    const res = await request(app)
      .get("/daily-review")
      .query({ week: "2026-W10", today: "2026-03-09" })
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const found = res.body.customers
      .find((c: { id: number }) => c.id === customer.id)
      .projects.find((p: { id: number }) => p.id === project.id);
    expect(found.progress).toEqual({ done: 1, total: 4 });
    expect(found.phase).toBe("Build");
    expect(found.slipDays).toBe(9);
    expect(found.overdueTasks.map((t: { title: string }) => t.title)).toEqual(["t2"]);
  });
});
