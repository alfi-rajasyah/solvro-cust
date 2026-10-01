import "./env.js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { seedRoles, createAdminAndToken } from "./testAuth.js";

// lib/portfolio.ts's computePortfolioRows is the single row builder behind
// GET /overview (`portfolio`) and GET /reports/executive (`projects`). The
// Portfolio Timelines calendar (frontend PortfolioCalendar.tsx) shows each
// row's customer name beside the project name and links it to
// /customers/:id, so every row must carry the customer's id next to its
// name — and null for BOTH when the project has no customer, so the UI
// renders the bare project name instead of a dead link.

const app = createApp();

let token: string;
let ownerId: number;

type Row = { id: number; customerId: number | null; customerName: string | null };

// Both routes' portfolio rows live under a different response key
// (`portfolio` for /overview, `projects` for /reports/executive) — this
// normalizes them for the shared assertions below.
function portfolioRows(body: unknown): Row[] {
  const b = body as { portfolio?: unknown; projects?: unknown };
  return (b.portfolio ?? b.projects) as Row[];
}

async function createProject(customerId: number | null): Promise<number> {
  const project = await prisma.project.create({
    data: {
      name: `Portfolio customer ${Date.now()}-${Math.random()}`,
      tamId: ownerId,
      status: "ACTIVE",
      customerId,
    },
  });
  return project.id;
}

beforeAll(async () => {
  await seedRoles();
});

beforeEach(async () => {
  // Admin: /reports/executive requires report:executive, which only the
  // seeded "*" wildcard satisfies; the same token also sees every project
  // on /overview. Neither route paginates, so the fixture project is
  // simply looked up by id in the response.
  const { userId, token: t } = await createAdminAndToken();
  ownerId = userId;
  token = t;
});

describe.each([
  ["GET /overview", "/overview"],
  ["GET /reports/executive", "/reports/executive"],
])("%s — customer id and name on each portfolio row", (_label, path) => {
  it("a project with a customer carries the customer's id and name", async () => {
    const customer = await prisma.customer.create({
      data: {
        name: `Portfolio row customer ${Date.now()}-${Math.random()}`,
        description: "Fixture for the portfolio row's customer link",
      },
    });
    const projectId = await createProject(customer.id);

    const res = await request(app).get(path).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const row = portfolioRows(res.body).find((r) => r.id === projectId);
    expect(row).toMatchObject({ customerId: customer.id, customerName: customer.name });
  });

  it("a project without a customer carries null for both", async () => {
    const projectId = await createProject(null);

    const res = await request(app).get(path).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const row = portfolioRows(res.body).find((r) => r.id === projectId);
    expect(row).toMatchObject({ customerId: null, customerName: null });
  });
});
