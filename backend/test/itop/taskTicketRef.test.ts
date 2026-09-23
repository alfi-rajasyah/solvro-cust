// Task.itopTicketRef (routes/tasks.ts PATCH) and its read-side lookup
// (routes/itop.ts GET /tickets/by-ref/:ref). Exercises the ref format
// validation, that a PATCH'd ref round-trips through both the single-task
// PATCH response and the cross-project GET /tasks list, that `null` clears
// it, and that by-ref lookup follows the exact same visibility rule as
// GET /tickets/:id (404 for hidden/unknown, never a distinguishable error).
// See docs/archive/plans/itop-integration.md Task 4.2.
import "../env.js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/prisma.js";
import { seedRoles, createUserWithRole } from "../testAuth.js";

const app = createApp();

function call(method: "get" | "patch", path: string, token: string) {
  return request(app)[method](path).set("Authorization", `Bearer ${token}`);
}

async function createProject(tamId: number) {
  return prisma.project.create({
    data: {
      name: `iTop ticket ref test project ${Date.now()}-${Math.random()}`,
      tamId,
      status: "ACTIVE",
    },
  });
}

async function createTask(projectId: number) {
  return prisma.task.create({
    data: { projectId, title: "Task with a possible iTop ref" },
  });
}

// Distinct id range from the other itop/*.test.ts files' ticket fixtures
// (tickets.test.ts: 900_000_00x, daily.test.ts: 91-92_000_00x,
// utilization.test.ts: 970_000_00x) so a concurrent full `npm test` run
// never collides on ItopTicket's unique `id` column.
let ticketIdCounter = 0;
function nextTicketId(): number {
  ticketIdCounter += 1;
  return 930_000_000 + ticketIdCounter;
}

// The ref must be something a task could actually hold — routes/tasks.ts's
// updateTaskSchema validates itopTicketRef against
// /^[A-Z]{1,3}-\d{4,8}$/, so it can't just be derived from the 9-digit
// ticket id above (930_000_00x overflows the 8-digit cap). A separate
// 6-digit counter keeps every ref both PATCH-storable and unique per run.
let ticketRefCounter = 0;
function nextTicketRef(): string {
  ticketRefCounter += 1;
  return `TKT-${String(100_000 + ticketRefCounter).padStart(6, "0")}`;
}

async function createTicket(overrides: { customerId?: number | null } = {}) {
  const id = nextTicketId();
  return prisma.itopTicket.create({
    data: {
      id,
      class: "UserRequest",
      ref: nextTicketRef(),
      title: "Test ticket",
      status: "new",
      orgId: 1,
      customerId: overrides.customerId ?? null,
      lastUpdate: new Date(),
      syncedAt: new Date(),
    },
  });
}

beforeAll(async () => {
  await seedRoles();
});

describe("PATCH /tasks/:id — itopTicketRef", () => {
  let token: string;
  let taskId: number;

  beforeEach(async () => {
    const owner = await createUserWithRole("TAM");
    token = owner.token;
    const project = await createProject(owner.userId);
    const task = await createTask(project.id);
    taskId = task.id;
  });

  it("persists a valid ref and returns it in the PATCH response", async () => {
    const res = await call("patch", `/tasks/${taskId}`, token).send({ itopTicketRef: "TST-100123" });
    expect(res.status).toBe(200);
    expect(res.body.itopTicketRef).toBe("TST-100123");

    const row = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.itopTicketRef).toBe("TST-100123");
  });

  it("the persisted ref comes back on GET /tasks (cross-project list)", async () => {
    await call("patch", `/tasks/${taskId}`, token).send({ itopTicketRef: "TST-100124" }).expect(200);

    const res = await call("get", "/tasks", token);
    expect(res.status).toBe(200);
    const row = (res.body as Array<{ id: number; itopTicketRef: string | null }>).find((t) => t.id === taskId);
    expect(row?.itopTicketRef).toBe("TST-100124");
  });

  it("400s an invalid ref", async () => {
    const res = await call("patch", `/tasks/${taskId}`, token).send({ itopTicketRef: "not-a-ref" });
    expect(res.status).toBe(400);
  });

  it("400s a ref missing the dash/digit shape entirely", async () => {
    const res = await call("patch", `/tasks/${taskId}`, token).send({ itopTicketRef: "TOOLONGPREFIX-123456789" });
    expect(res.status).toBe(400);
  });

  it("null clears a previously set ref", async () => {
    await call("patch", `/tasks/${taskId}`, token).send({ itopTicketRef: "TST-100125" }).expect(200);

    const res = await call("patch", `/tasks/${taskId}`, token).send({ itopTicketRef: null });
    expect(res.status).toBe(200);
    expect(res.body.itopTicketRef).toBeNull();

    const row = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.itopTicketRef).toBeNull();
  });
});

describe("GET /itop/tickets/by-ref/:ref", () => {
  it("200s the ticket row for a visible (owned) customer", async () => {
    const owner = await createUserWithRole("TAM");
    const customer = await prisma.customer.create({
      data: { name: `by-ref visible customer ${Date.now()}-${Math.random()}`, description: "d", tamId: owner.userId },
    });
    const ticket = await createTicket({ customerId: customer.id });

    const res = await call("get", `/itop/tickets/by-ref/${ticket.ref}`, owner.token);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(ticket.id);
    expect(res.body.ref).toBe(ticket.ref);
  });

  it("404s for a ticket whose customer is hidden from the caller", async () => {
    const owner = await createUserWithRole("TAM");
    const caller = await createUserWithRole("TAM");
    const customer = await prisma.customer.create({
      data: { name: `by-ref hidden customer ${Date.now()}-${Math.random()}`, description: "d", tamId: owner.userId },
    });
    const ticket = await createTicket({ customerId: customer.id });

    const res = await call("get", `/itop/tickets/by-ref/${ticket.ref}`, caller.token);
    expect(res.status).toBe(404);
  });

  it("404s for a ticket with no customer link (unmapped)", async () => {
    const { token } = await createUserWithRole("TAM");
    const ticket = await createTicket({ customerId: null });

    const res = await call("get", `/itop/tickets/by-ref/${ticket.ref}`, token);
    expect(res.status).toBe(404);
  });

  it("404s for a ref that doesn't exist in the snapshot at all", async () => {
    const { token } = await createUserWithRole("TAM");
    const res = await call("get", "/itop/tickets/by-ref/NOPE-999999", token);
    expect(res.status).toBe(404);
  });
});

describe("PATCH /tasks/:id itopTicketRef + GET /itop/tickets/by-ref/:ref — end to end", () => {
  it("a ref pinned to a task that also exists in the snapshot resolves via by-ref", async () => {
    const owner = await createUserWithRole("TAM");
    const project = await createProject(owner.userId);
    const task = await createTask(project.id);
    const customer = await prisma.customer.create({
      data: { name: `by-ref e2e customer ${Date.now()}-${Math.random()}`, description: "d", tamId: owner.userId },
    });
    const ticket = await createTicket({ customerId: customer.id });

    const patchRes = await call("patch", `/tasks/${task.id}`, owner.token).send({ itopTicketRef: ticket.ref });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.itopTicketRef).toBe(ticket.ref);

    const byRefRes = await call("get", `/itop/tickets/by-ref/${ticket.ref}`, owner.token);
    expect(byRefRes.status).toBe(200);
    expect(byRefRes.body.id).toBe(ticket.id);
    expect(byRefRes.body.ref).toBe(ticket.ref);
  });
});
