// C2 (docs/archive/plans/collaboration-and-sharing.md): assigning a task to a
// user who is neither the project's TAM nor a member adds them as a member in
// the same transaction as the task write.
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

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function fixture() {
  const tam = await createUserWithRole("TAM");
  const assignee = await createUserWithRole("TAM");
  const customer = await prisma.customer.create({
    data: { name: uniq("Customer"), description: "d", tamId: tam.userId },
  });
  const project = await prisma.project.create({
    data: { name: uniq("Project"), tamId: tam.userId, customerId: customer.id, status: "ACTIVE" },
  });
  return { tam, assignee, project };
}

// Valid JS date, but before Postgres' minimum date/timestamp (4713 BC).
const OUT_OF_RANGE_DATE = "-271821-04-20T00:00:00.000Z";

const memberRows = (projectId: number) =>
  prisma.projectMember.findMany({ where: { projectId } });

describe("POST /projects/:id/tasks — assignee becomes a member", () => {
  it("adds exactly one membership for a non-member assignee, addedById = acting user", async () => {
    const { tam, assignee, project } = await fixture();
    const res = await request(app)
      .post(`/projects/${project.id}/tasks`)
      .set(auth(tam.token))
      .send({ title: "A", assignedToId: assignee.userId });
    expect(res.status).toBe(201);
    expect(res.body.assignedTo.id).toBe(assignee.userId);
    expect(Object.keys(res.body)).not.toContain("members");

    const rows = await memberRows(project.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: assignee.userId, addedById: tam.userId });

    // The new member can now open the project.
    expect((await request(app).get(`/projects/${project.id}`).set(auth(assignee.token))).status).toBe(200);
  });

  it("adds nothing when assigning the TAM, an existing member, or nobody", async () => {
    const { tam, assignee, project } = await fixture();
    await prisma.projectMember.create({
      data: { projectId: project.id, userId: assignee.userId, addedById: null },
    });

    for (const assignedToId of [tam.userId, assignee.userId, null]) {
      const res = await request(app)
        .post(`/projects/${project.id}/tasks`)
        .set(auth(tam.token))
        .send({ title: "B", assignedToId });
      expect(res.status).toBe(201);
    }
    const rows = await memberRows(project.id);
    expect(rows).toHaveLength(1);
    // The existing row was left untouched (addedById stays null).
    expect(rows[0].addedById).toBeNull();
  });

  it("assigning the same new person twice still yields one membership", async () => {
    const { tam, assignee, project } = await fixture();
    await Promise.all(
      [1, 2].map((n) =>
        request(app)
          .post(`/projects/${project.id}/tasks`)
          .set(auth(tam.token))
          .send({ title: `C${n}`, assignedToId: assignee.userId }),
      ),
    );
    expect(await memberRows(project.id)).toHaveLength(1);
  });

  it("rolls the membership back when the task insert fails after the helper ran", async () => {
    const { tam, assignee, project } = await fixture();
    // Passes validation and the assignee helper, then the INSERT itself fails
    // (a date below Postgres' minimum) — so the membership row was really
    // written inside the transaction before being rolled back.
    const res = await request(app)
      .post(`/projects/${project.id}/tasks`)
      .set(auth(tam.token))
      .send({ title: "D", assignedToId: assignee.userId, startDate: OUT_OF_RANGE_DATE });
    expect(res.status).toBe(500);
    expect(await memberRows(project.id)).toHaveLength(0);
    expect(await prisma.task.count({ where: { projectId: project.id } })).toBe(0);
  });
});

describe("PATCH /tasks/:id — assignee becomes a member", () => {
  async function newTask(projectId: number) {
    return prisma.task.create({
      data: { projectId, title: "T", status: "TODO", priority: "MEDIUM", position: 0 },
    });
  }

  it("adds exactly one membership for a non-member assignee", async () => {
    const { tam, assignee, project } = await fixture();
    const task = await newTask(project.id);
    const res = await request(app)
      .patch(`/tasks/${task.id}`)
      .set(auth(tam.token))
      .send({ assignedToId: assignee.userId });
    expect(res.status).toBe(200);
    expect(res.body.assignedTo.id).toBe(assignee.userId);
    const rows = await memberRows(project.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: assignee.userId, addedById: tam.userId });
  });

  it("also adds the membership when the patch re-orders (position + assignee)", async () => {
    const { tam, assignee, project } = await fixture();
    const task = await newTask(project.id);
    const res = await request(app)
      .patch(`/tasks/${task.id}`)
      .set(auth(tam.token))
      .send({ assignedToId: assignee.userId, position: 0 });
    expect(res.status).toBe(200);
    expect(await memberRows(project.id)).toHaveLength(1);
  });

  it("adds nothing for the TAM or an existing member; unassigning keeps membership", async () => {
    const { tam, assignee, project } = await fixture();
    const task = await newTask(project.id);
    await prisma.projectMember.create({
      data: { projectId: project.id, userId: assignee.userId, addedById: null },
    });

    for (const assignedToId of [tam.userId, assignee.userId]) {
      const res = await request(app)
        .patch(`/tasks/${task.id}`)
        .set(auth(tam.token))
        .send({ assignedToId });
      expect(res.status).toBe(200);
    }
    expect(await memberRows(project.id)).toHaveLength(1);

    const unassign = await request(app)
      .patch(`/tasks/${task.id}`)
      .set(auth(tam.token))
      .send({ assignedToId: null });
    expect(unassign.status).toBe(200);
    expect(unassign.body.assignedTo).toBeNull();
    expect(await memberRows(project.id)).toHaveLength(1);
  });

  it("unassigning a user added by assignment does not remove the membership", async () => {
    const { tam, assignee, project } = await fixture();
    const task = await newTask(project.id);
    await request(app)
      .patch(`/tasks/${task.id}`)
      .set(auth(tam.token))
      .send({ assignedToId: assignee.userId });
    await request(app).patch(`/tasks/${task.id}`).set(auth(tam.token)).send({ assignedToId: null });
    expect(await memberRows(project.id)).toHaveLength(1);
  });

  it("an unknown assignee still 404s and adds no membership", async () => {
    const { tam, project } = await fixture();
    const task = await newTask(project.id);
    const res = await request(app)
      .patch(`/tasks/${task.id}`)
      .set(auth(tam.token))
      .send({ assignedToId: 2_000_000_000 });
    expect(res.status).toBe(404);
    expect(await memberRows(project.id)).toHaveLength(0);
  });

  it("rolls the membership back when the task update fails after the helper ran", async () => {
    const { tam, assignee, project } = await fixture();
    const task = await newTask(project.id);
    const res = await request(app)
      .patch(`/tasks/${task.id}`)
      .set(auth(tam.token))
      .send({ assignedToId: assignee.userId, startDate: OUT_OF_RANGE_DATE });
    expect(res.status).toBe(500);
    expect(await memberRows(project.id)).toHaveLength(0);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.assignedToId).toBeNull();
  });

  it("re-saving the same assignee does not re-add a removed member", async () => {
    const { tam, assignee, project } = await fixture();
    const task = await newTask(project.id);
    // Assign (adds the member), then remove the member — this unassigns them.
    await request(app).patch(`/tasks/${task.id}`).set(auth(tam.token)).send({ assignedToId: assignee.userId });
    await request(app)
      .delete(`/projects/${project.id}/members/${assignee.userId}`)
      .set(auth(tam.token));
    // Simulate a stale edit form that still carries the old assignee id while
    // the task is (again) assigned to that person by direct write.
    await prisma.task.update({ where: { id: task.id }, data: { assignedToId: assignee.userId } });
    const res = await request(app)
      .patch(`/tasks/${task.id}`)
      .set(auth(tam.token))
      .send({ title: "Renamed", assignedToId: assignee.userId });
    expect(res.status).toBe(200);
    expect(await memberRows(project.id)).toHaveLength(0);
  });

  it("does not add an inactive assignee as a member", async () => {
    const { tam, assignee, project } = await fixture();
    await prisma.user.update({ where: { id: assignee.userId }, data: { active: false } });
    const task = await newTask(project.id);
    const res = await request(app)
      .patch(`/tasks/${task.id}`)
      .set(auth(tam.token))
      .send({ assignedToId: assignee.userId });
    expect(res.status).toBe(200);
    expect(await memberRows(project.id)).toHaveLength(0);
  });
});
