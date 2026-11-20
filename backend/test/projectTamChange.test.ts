// Changing a project's TAM unassigns the old TAM's tasks when that ends their
// access (user decision 2026-09-30); any other access path keeps them.
import "./env.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { createUserWithRole, seedRoles } from "./testAuth.js";
import { SID } from "./statusFixtures.js";

const app = createApp();

beforeAll(async () => {
  await seedRoles();
});

const uniq = (label: string) => `${label} ${Date.now()}-${Math.random()}`;

async function setup(opts: { linkCustomerOwnedByOldTam?: boolean } = {}) {
  const oldTam = await createUserWithRole("TAM");
  const newTam = await createUserWithRole("TAM");
  const actor = await createUserWithRole("ADMIN");
  const project = await prisma.project.create({
    data: { name: uniq("Project"), tamId: oldTam.userId, status: "ACTIVE" },
  });
  if (opts.linkCustomerOwnedByOldTam) {
    const customer = await prisma.customer.create({
      data: { name: uniq("Customer"), description: "d", tamId: oldTam.userId },
    });
    await prisma.projectCustomer.create({
      data: { projectId: project.id, customerId: customer.id, isPrimary: true },
    });
  }
  const task = await prisma.task.create({
    data: {
      statusId: SID.TODO,
      projectId: project.id,
      title: "T",
      status: "TODO",
      priority: "MEDIUM",
      position: 0,
      assignedToId: oldTam.userId,
    },
  });
  return { oldTam, newTam, actor, project, task };
}

const patch = (token: string, projectId: number, body: object) =>
  request(app).patch(`/projects/${projectId}`).set({ Authorization: `Bearer ${token}` }).send(body);
const assignee = async (taskId: number) =>
  (await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).assignedToId;

describe("PATCH /projects/:id tamId change", () => {
  it("unassigns the old TAM's tasks and records an event when access ends", async () => {
    const { oldTam, newTam, actor, project, task } = await setup();
    const res = await patch(actor.token, project.id, { tamId: newTam.userId });
    expect(res.status).toBe(200);
    expect(await assignee(task.id)).toBeNull();
    const ev = await prisma.activityEvent.findFirst({
      where: { projectId: project.id, entityType: "member", action: "removed", entityId: oldTam.userId },
    });
    expect(ev).not.toBeNull();
    expect(ev!.changes).toEqual({ unassignedTasks: 1, viaTamChange: true });
  });

  it("keeps the tasks of an old TAM who is a project member", async () => {
    const { oldTam, newTam, actor, project, task } = await setup();
    await prisma.projectMember.create({
      data: { projectId: project.id, userId: oldTam.userId, addedById: actor.userId },
    });
    const res = await patch(actor.token, project.id, { tamId: newTam.userId });
    expect(res.status).toBe(200);
    expect(await assignee(task.id)).toBe(oldTam.userId);
  });

  it("keeps the tasks of an old TAM who owns a linked customer", async () => {
    const { oldTam, newTam, actor, project, task } = await setup({ linkCustomerOwnedByOldTam: true });
    const res = await patch(actor.token, project.id, { tamId: newTam.userId });
    expect(res.status).toBe(200);
    expect(await assignee(task.id)).toBe(oldTam.userId);
  });

  it("changes nothing when tamId is unchanged", async () => {
    const { oldTam, actor, project, task } = await setup();
    const res = await patch(actor.token, project.id, { tamId: oldTam.userId, name: uniq("Renamed") });
    expect(res.status).toBe(200);
    expect(await assignee(task.id)).toBe(oldTam.userId);
  });
});
