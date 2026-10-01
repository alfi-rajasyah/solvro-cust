import "./env.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { createUserWithRole, seedRoles } from "./testAuth.js";

// `health` on GET /customers: overdue tasks and open risks rolled up over the
// caller's VISIBLE projects of each customer, plus that ISO week's weekly
// update. A TAM token scopes every response to this test's own fixtures.

const app = createApp();

beforeAll(async () => {
  await seedRoles();
});

function uniq(label: string): string {
  return `${label} ${Date.now()}-${Math.random()}`;
}

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

async function addTask(projectId: number, o: { status?: "TODO" | "DONE"; dueDate: string }) {
  await prisma.task.create({
    data: { projectId, title: "T", status: o.status ?? "TODO", dueDate: day(o.dueDate) },
  });
}

async function addRisk(projectId: number, status: "OPEN" | "MITIGATED" | "CLOSED") {
  await prisma.risk.create({
    data: { projectId, description: "R", probability: 3, impact: 3, status },
  });
}

interface CustomerRow {
  id: number;
  health: {
    overdueCount: number;
    openRiskCount: number;
    weeklyUpdate: { weekStart: string; status: string; health: string | null } | null;
  };
}

async function list(token: string, query = ""): Promise<CustomerRow[]> {
  const res = await request(app).get(`/customers${query}`).set("Authorization", `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body as CustomerRow[];
}

describe("GET /customers health", () => {
  it("rolls up only the caller's visible projects of each customer", async () => {
    const tam = await createUserWithRole("TAM");
    const other = await createUserWithRole("TAM");

    // Customer owned by someone else: `tam` sees it only through their own project.
    const attached = await prisma.customer.create({
      data: { name: uniq("Attached"), description: "d", tamId: other.userId },
    });
    const visible = await prisma.project.create({
      data: { name: uniq("Vis"), tamId: tam.userId, customerId: attached.id, status: "ACTIVE" },
    });
    const hidden = await prisma.project.create({
      data: { name: uniq("Hid"), tamId: other.userId, customerId: attached.id, status: "ACTIVE" },
    });

    await addTask(visible.id, { dueDate: "2026-09-20" }); // overdue
    await addTask(visible.id, { dueDate: "2026-09-25", status: "DONE" }); // done: not overdue
    await addTask(visible.id, { dueDate: "2026-10-05" }); // future
    await addRisk(visible.id, "OPEN");
    await addRisk(visible.id, "MITIGATED");
    await addRisk(visible.id, "CLOSED");
    // Hidden project: must contribute nothing.
    await addTask(hidden.id, { dueDate: "2026-09-01" });
    await addTask(hidden.id, { dueDate: "2026-09-02" });
    await addRisk(hidden.id, "OPEN");
    await addRisk(hidden.id, "OPEN");

    // A second visible project of the same customer adds to the roll-up.
    const visible2 = await prisma.project.create({
      data: { name: uniq("Vis2"), tamId: tam.userId, customerId: attached.id, status: "ACTIVE" },
    });
    await addTask(visible2.id, { dueDate: "2026-09-10" });
    await addRisk(visible2.id, "OPEN");

    const row = (await list(tam.token, "?today=2026-09-30")).find((c) => c.id === attached.id)!;
    expect(row.health.overdueCount).toBe(2);
    expect(row.health.openRiskCount).toBe(2);
  });

  it("uses the supplied today for the overdue boundary", async () => {
    const tam = await createUserWithRole("TAM");
    const customer = await prisma.customer.create({
      data: { name: uniq("Boundary"), description: "d", tamId: tam.userId },
    });
    const project = await prisma.project.create({
      data: { name: uniq("P"), tamId: tam.userId, customerId: customer.id, status: "ACTIVE" },
    });
    await addTask(project.id, { dueDate: "2026-09-30" });

    const onDay = (await list(tam.token, "?today=2026-09-30")).find((c) => c.id === customer.id)!;
    expect(onDay.health.overdueCount).toBe(0); // due today is not overdue
    const nextDay = (await list(tam.token, "?today=2026-10-01")).find((c) => c.id === customer.id)!;
    expect(nextDay.health.overdueCount).toBe(1);
  });

  it("returns this ISO week's weekly update, not another week's", async () => {
    const tam = await createUserWithRole("TAM");
    const withThisWeek = await prisma.customer.create({
      data: { name: uniq("ThisWeek"), description: "d", tamId: tam.userId },
    });
    const withOldWeek = await prisma.customer.create({
      data: { name: uniq("OldWeek"), description: "d", tamId: tam.userId },
    });
    await prisma.weeklyUpdate.create({
      data: {
        customerId: withThisWeek.id,
        weekStart: day("2026-09-28"),
        authorId: tam.userId,
        status: "DONE",
        health: "AMBER",
      },
    });
    await prisma.weeklyUpdate.create({
      data: {
        customerId: withOldWeek.id,
        weekStart: day("2026-09-21"),
        authorId: tam.userId,
        status: "DRAFT",
      },
    });

    // Wednesday and Sunday of the same ISO week resolve to Monday 2026-09-28.
    for (const today of ["2026-09-30", "2026-10-04"]) {
      const rows = await list(tam.token, `?today=${today}`);
      expect(rows.find((c) => c.id === withThisWeek.id)!.health.weeklyUpdate).toEqual({
        weekStart: "2026-09-28",
        status: "DONE",
        health: "AMBER",
      });
      expect(rows.find((c) => c.id === withOldWeek.id)!.health.weeklyUpdate).toBeNull();
    }

    // The next Monday starts a new week: nothing filed yet.
    const nextWeek = await list(tam.token, "?today=2026-10-05");
    expect(nextWeek.find((c) => c.id === withThisWeek.id)!.health.weeklyUpdate).toBeNull();
  });

  it("returns zeros and a null weekly update for a customer with no projects", async () => {
    const tam = await createUserWithRole("TAM");
    const customer = await prisma.customer.create({
      data: { name: uniq("Empty"), description: "d", tamId: tam.userId },
    });
    const row = (await list(tam.token, "?today=2026-09-30")).find((c) => c.id === customer.id)!;
    expect(row.health).toEqual({ overdueCount: 0, openRiskCount: 0, weeklyUpdate: null });
  });

  it("rejects an invalid today", async () => {
    const tam = await createUserWithRole("TAM");
    const res = await request(app)
      .get("/customers?today=2026-02-30")
      .set("Authorization", `Bearer ${tam.token}`);
    expect(res.status).toBe(400);
  });
});
