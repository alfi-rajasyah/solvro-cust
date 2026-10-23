// Bad input in a request body answers 400, never 500: a date Postgres cannot
// store, a non-date value in a date field, and an unknown user id in a
// foreign-key field (TAM, assignee, epic owner). Each of these used to pass
// validation and fail at the INSERT, which the error handler logged and
// answered as 500 internal_error.
import "./env.js";
import express from "express";
import { Prisma } from "@prisma/client";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { errorHandler } from "../src/http/errors.js";
import { prisma } from "../src/prisma.js";
import { createUserWithRole, seedRoles } from "./testAuth.js";

const app = createApp();

beforeAll(async () => {
  await seedRoles();
});

function uniq(label: string): string {
  return `${label} ${Date.now()}-${Math.random()}`;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function fixture() {
  const tam = await createUserWithRole("TAM");
  const customer = await prisma.customer.create({
    data: { name: uniq("Customer"), description: "d", tamId: tam.userId },
  });
  const project = await prisma.project.create({
    data: { name: uniq("Project"), tamId: tam.userId, customerId: customer.id, status: "ACTIVE" },
  });
  return { tam, customer, project };
}

// No user row ever gets an id this high in the test database.
const UNKNOWN_USER_ID = 2_000_000_000;

// Valid JavaScript dates that Postgres cannot store, plus years outside the
// accepted 1900–2200 window.
const BAD_DATES: Array<[string, unknown]> = [
  ["a year before Postgres' minimum", "-271821-04-20T00:00:00.000Z"],
  ["year 1899", "1899-12-31T00:00:00.000Z"],
  ["year 2201", "2201-01-01T00:00:00.000Z"],
  ["a boolean", true],
  ["a number", 1_700_000_000_000],
  ["an unparseable string", "banana"],
  ["an empty string", ""],
  ["a loose string parsed in server time", "10/23/2026"],
  ["a day that rolls over", "2026-02-30"],
];

describe("date fields refuse values Postgres cannot store", () => {
  for (const [label, value] of BAD_DATES) {
    it(`POST /projects/:id/tasks startDate: ${label} → 400, nothing written`, async () => {
      const { tam, project } = await fixture();
      const res = await request(app)
        .post(`/projects/${project.id}/tasks`)
        .set(auth(tam.token))
        .send({ title: "T", startDate: value });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("validation_error");
      expect(await prisma.task.count({ where: { projectId: project.id } })).toBe(0);
    });
  }

  it("PATCH /tasks/:id dueDate out of range → 400, task unchanged", async () => {
    const { tam, project } = await fixture();
    const task = await prisma.task.create({
      data: { projectId: project.id, title: "T", status: "TODO", priority: "MEDIUM", position: 0 },
    });
    const res = await request(app)
      .patch(`/tasks/${task.id}`)
      .set(auth(tam.token))
      .send({ dueDate: "-271821-04-20T00:00:00.000Z" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation_error");
    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.dueDate).toBeNull();
  });

  it("PATCH /tasks/:id with a malformed expected date → 400", async () => {
    const { tam, project } = await fixture();
    const task = await prisma.task.create({
      data: { projectId: project.id, title: "T", status: "TODO", priority: "MEDIUM", position: 0 },
    });
    const res = await request(app)
      .patch(`/tasks/${task.id}`)
      .set(auth(tam.token))
      .send({ title: "U", expected: { startDate: true } });
    expect(res.status).toBe(400);
  });

  it("PATCH /tasks/:id can still change a stored date outside the window (expected echoes it back)", async () => {
    const { tam, project } = await fixture();
    const stored = new Date("2230-01-01T00:00:00.000Z");
    const task = await prisma.task.create({
      data: { projectId: project.id, title: "T", status: "TODO", priority: "MEDIUM", position: 0, startDate: stored },
    });
    const res = await request(app)
      .patch(`/tasks/${task.id}`)
      .set(auth(tam.token))
      .send({ startDate: "2026-01-01T00:00:00.000Z", expected: { startDate: stored.toISOString() } });
    expect(res.status).toBe(200);
    expect(res.body.startDate).toBe("2026-01-01T00:00:00.000Z");
  });

  it("POST /projects/:id/epics startDate in 1800 → 400, no epic", async () => {
    const { tam, project } = await fixture();
    const res = await request(app)
      .post(`/projects/${project.id}/epics`)
      .set(auth(tam.token))
      .send({ title: "E", startDate: "1800-01-01T00:00:00.000Z" });
    expect(res.status).toBe(400);
    expect(await prisma.epic.count({ where: { projectId: project.id } })).toBe(0);
  });

  it("PATCH /epics/:id dueDate in 2500 → 400, epic unchanged", async () => {
    const { tam, project } = await fixture();
    const epic = await prisma.epic.create({ data: { projectId: project.id, title: "E", position: 0 } });
    const res = await request(app)
      .patch(`/epics/${epic.id}`)
      .set(auth(tam.token))
      .send({ dueDate: "2500-01-01T00:00:00.000Z" });
    expect(res.status).toBe(400);
    const after = await prisma.epic.findUniqueOrThrow({ where: { id: epic.id } });
    expect(after.dueDate).toBeNull();
  });

  it("POST /projects/:id/baseline asOfDate out of range → 400", async () => {
    const { tam, project } = await fixture();
    const res = await request(app)
      .post(`/projects/${project.id}/baseline`)
      .set(auth(tam.token))
      .send({ asOfDate: "-271821-04-20T00:00:00.000Z" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation_error");
  });

  it("POST /projects/:id/baseline asOfDate null → locks as of now", async () => {
    const { tam, project } = await fixture();
    const before = Date.now();
    const res = await request(app)
      .post(`/projects/${project.id}/baseline`)
      .set(auth(tam.token))
      .send({ asOfDate: null });
    expect(res.status).toBe(200);
    expect(new Date(res.body.baselineLockedAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("accepts the window's edges, a date-only string, and null", async () => {
    const { tam, project } = await fixture();
    const edges = await request(app)
      .post(`/projects/${project.id}/tasks`)
      .set(auth(tam.token))
      .send({ title: "Edges", startDate: "1900-01-01T00:00:00.000Z", dueDate: "2200-12-31T00:00:00.000Z" });
    expect(edges.status).toBe(201);
    expect(edges.body.startDate).toBe("1900-01-01T00:00:00.000Z");
    expect(edges.body.dueDate).toBe("2200-12-31T00:00:00.000Z");

    const dayOnly = await request(app)
      .post(`/projects/${project.id}/tasks`)
      .set(auth(tam.token))
      .send({ title: "Day", dueDate: "2026-10-23", startDate: null });
    expect(dayOnly.status).toBe(201);
    expect(dayOnly.body.dueDate).toBe("2026-10-23T00:00:00.000Z");
    expect(dayOnly.body.startDate).toBeNull();
  });
});

describe("unknown user ids in a body answer 400, not 500", () => {
  it("POST /projects with an unknown tamId → 400 tam_not_found, no project", async () => {
    const { tam, customer } = await fixture();
    const name = uniq("Ghost TAM");
    const res = await request(app)
      .post("/projects")
      .set(auth(tam.token))
      .send({ name, customerId: customer.id, tamId: UNKNOWN_USER_ID });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("tam_not_found");
    expect(await prisma.project.count({ where: { name } })).toBe(0);
  });

  it("POST /projects/:id/tasks with an unknown assignee → 400 assignee_not_found, nothing written", async () => {
    const { tam, project } = await fixture();
    const res = await request(app)
      .post(`/projects/${project.id}/tasks`)
      .set(auth(tam.token))
      .send({ title: "T", assignedToId: UNKNOWN_USER_ID });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("assignee_not_found");
    expect(await prisma.task.count({ where: { projectId: project.id } })).toBe(0);
    expect(await prisma.projectMember.count({ where: { projectId: project.id } })).toBe(0);
  });

  it("POST /projects/:id/epics with an unknown owner → 400 owner_not_found, no epic", async () => {
    const { tam, project } = await fixture();
    const res = await request(app)
      .post(`/projects/${project.id}/epics`)
      .set(auth(tam.token))
      .send({ title: "E", ownerId: UNKNOWN_USER_ID });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("owner_not_found");
    expect(await prisma.epic.count({ where: { projectId: project.id } })).toBe(0);
  });

  it("known users still work on all three paths", async () => {
    const { tam, customer, project } = await fixture();
    const other = await createUserWithRole("TAM");
    const created = await request(app)
      .post("/projects")
      .set(auth(tam.token))
      .send({ name: uniq("Known TAM"), customerId: customer.id, tamId: other.userId });
    expect(created.status).toBe(201);
    const task = await request(app)
      .post(`/projects/${project.id}/tasks`)
      .set(auth(tam.token))
      .send({ title: "T", assignedToId: other.userId });
    expect(task.status).toBe(201);
    const epic = await request(app)
      .post(`/projects/${project.id}/epics`)
      .set(auth(tam.token))
      .send({ title: "E", ownerId: other.userId });
    expect(epic.status).toBe(201);
  });
});

describe("errorHandler: a foreign-key violation is a 400", () => {
  it("maps Prisma P2003 to 400 invalid_reference without leaking column names", async () => {
    const stub = express();
    stub.get("/", () => {
      throw new Prisma.PrismaClientKnownRequestError("Foreign key constraint failed on the field: `tam_id`", {
        code: "P2003",
        clientVersion: "test",
        meta: { field_name: "projects_tam_id_fkey (index)" },
      });
    });
    stub.use(errorHandler);
    const res = await request(stub).get("/");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid reference to a related record", code: "invalid_reference" });
  });
});
