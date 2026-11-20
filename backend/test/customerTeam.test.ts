// Customer team (GitHub #93, docs/archive/plans/customer-team.md): the team arm
// of the visibility filters, the /customers/:id/team API, and the places that
// treat a team member like a project member (Daily Review, notifications,
// assignee auto-add). Fixtures write via `prisma` directly.
import "./env.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { signToken } from "../src/http/auth.js";
import { createUserWithRole, seedRoles } from "./testAuth.js";
import { SID } from "./statusFixtures.js";

const app = createApp();

beforeAll(async () => {
  await seedRoles();
});

const uniq = (label: string) => `${label} ${Date.now()}-${Math.random()}`;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

let n = 0;
/** A user whose role carries exactly `perms`. */
async function userWith(perms: string[], opts: { active?: boolean } = {}) {
  n += 1;
  const role = await prisma.role.create({
    data: { roleName: `ct-${Date.now()}-${n}`, permissions: perms },
  });
  const user = await prisma.user.create({
    data: {
      username: `ct-user-${Date.now()}-${n}`,
      email: `ct-${Date.now()}-${n}@example.com`,
      passwordHash: null,
      roleId: role.id,
      active: opts.active ?? true,
    },
  });
  return { userId: user.id, token: signToken({ sub: user.id, ver: 0 }), username: user.username };
}

/**
 * owner   — owns the customer and the project (TAM role)
 * member  — a TAM-role user with no relation to the customer (until added)
 * outsider — another unrelated TAM
 */
async function fixture() {
  const owner = await createUserWithRole("TAM");
  const member = await createUserWithRole("TAM");
  const outsider = await createUserWithRole("TAM");
  const customer = await prisma.customer.create({
    data: { name: uniq("Customer"), description: "d", tamId: owner.userId },
  });
  const project = await prisma.project.create({
    data: {
      name: uniq("Project"),
      tamId: owner.userId,
      customers: { create: { customerId: customer.id, isPrimary: true } },
      status: "ACTIVE",
    },
  });
  return { owner, member, outsider, customer, project };
}

const addToTeam = (customerId: number, userId: number) =>
  prisma.customerTeamMember.create({ data: { customerId, userId } });

const post = (token: string, customerId: number, userId: number) =>
  request(app).post(`/customers/${customerId}/team`).set(auth(token)).send({ userId });
const del = (token: string, customerId: number, userId: number) =>
  request(app).delete(`/customers/${customerId}/team/${userId}`).set(auth(token));
const list = (token: string, customerId: number) =>
  request(app).get(`/customers/${customerId}/team`).set(auth(token));

describe("team arm of the visibility filters", () => {
  it("a team member sees every project of the customer, its tasks, and can edit them", async () => {
    const { member, customer, project } = await fixture();
    await addToTeam(customer.id, member.userId);
    const task = await prisma.task.create({
      data: { statusId: SID.TODO, projectId: project.id, title: "T", status: "TODO", priority: "MEDIUM", position: 0 },
    });

    const projects = await request(app).get("/projects").set(auth(member.token));
    expect((projects.body as Array<{ id: number }>).map((p) => p.id)).toContain(project.id);
    expect((await request(app).get(`/projects/${project.id}`).set(auth(member.token))).status).toBe(200);
    const tasks = await request(app).get(`/projects/${project.id}/tasks`).set(auth(member.token));
    expect((tasks.body as Array<{ id: number }>).map((t) => t.id)).toContain(task.id);
    const patch = await request(app).patch(`/tasks/${task.id}`).set(auth(member.token)).send({ title: "Renamed" });
    expect(patch.status).toBe(200);
  });

  it("a project linked to the customer later is visible to the team", async () => {
    const { owner, member, outsider, customer } = await fixture();
    await addToTeam(customer.id, member.userId);
    const later = await prisma.project.create({
      data: { name: uniq("Later"), tamId: owner.userId, status: "ACTIVE" },
    });
    expect((await request(app).get(`/projects/${later.id}`).set(auth(member.token))).status).toBe(404);

    await prisma.projectCustomer.create({ data: { projectId: later.id, customerId: customer.id, isPrimary: true } });
    expect((await request(app).get(`/projects/${later.id}`).set(auth(member.token))).status).toBe(200);
    expect((await request(app).get(`/projects/${later.id}`).set(auth(outsider.token))).status).toBe(404);
  });

  it("a team member of any linked customer of a shared project sees it", async () => {
    const { owner, member, project } = await fixture();
    const second = await prisma.customer.create({
      data: { name: uniq("Second"), description: "d", tamId: owner.userId },
    });
    await prisma.projectCustomer.create({ data: { projectId: project.id, customerId: second.id, isPrimary: false } });
    await addToTeam(second.id, member.userId);
    expect((await request(app).get(`/projects/${project.id}`).set(auth(member.token))).status).toBe(200);
  });

  it("a customer with no projects is visible to its team and hidden from others", async () => {
    const { owner, member, outsider } = await fixture();
    const empty = await prisma.customer.create({
      data: { name: uniq("Empty"), description: "d", tamId: owner.userId },
    });
    expect((await request(app).get(`/customers/${empty.id}`).set(auth(member.token))).status).toBe(404);
    await addToTeam(empty.id, member.userId);
    expect((await request(app).get(`/customers/${empty.id}`).set(auth(member.token))).status).toBe(200);
    const listed = await request(app).get("/customers").set(auth(member.token));
    expect((listed.body as Array<{ id: number }>).map((c) => c.id)).toContain(empty.id);
    expect((await request(app).get(`/customers/${empty.id}`).set(auth(outsider.token))).status).toBe(404);
  });

  it("removing a member revokes the access on the next request", async () => {
    const { owner, member, customer, project } = await fixture();
    await addToTeam(customer.id, member.userId);
    expect((await request(app).get(`/projects/${project.id}`).set(auth(member.token))).status).toBe(200);
    expect((await del(owner.token, customer.id, member.userId)).status).toBe(204);
    expect((await request(app).get(`/projects/${project.id}`).set(auth(member.token))).status).toBe(404);
    expect((await request(app).get(`/customers/${customer.id}`).set(auth(member.token))).status).toBe(404);
  });

  it("deleting the customer or the user cascades the membership away", async () => {
    const a = await fixture();
    await addToTeam(a.customer.id, a.member.userId);
    await prisma.customer.delete({ where: { id: a.customer.id } });
    expect(await prisma.customerTeamMember.count({ where: { customerId: a.customer.id } })).toBe(0);

    const b = await fixture();
    await addToTeam(b.customer.id, b.member.userId);
    await prisma.user.delete({ where: { id: b.member.userId } });
    expect(await prisma.customerTeamMember.count({ where: { customerId: b.customer.id } })).toBe(0);
  });
});

describe("a team member is never an owner", () => {
  it("cannot delete the customer, change its owner, delete the project or change its customers/TAM", async () => {
    const { owner, member, customer, project } = await fixture();
    await addToTeam(customer.id, member.userId);

    const delCustomer = await request(app).delete(`/customers/${customer.id}`).set(auth(member.token));
    expect(delCustomer.status).toBe(403);
    expect(delCustomer.body.code).toBe("owner_only");

    const owner2 = await request(app)
      .patch(`/customers/${customer.id}`)
      .set(auth(member.token))
      .send({ tamId: member.userId });
    expect(owner2.status).toBe(403);
    expect(owner2.body.code).toBe("owner_only");

    const delProject = await request(app).delete(`/projects/${project.id}`).set(auth(member.token));
    expect(delProject.status).toBe(403);
    expect(delProject.body.code).toBe("owner_only");

    const other = await prisma.customer.create({
      data: { name: uniq("Other"), description: "d", tamId: member.userId },
    });
    const links = await request(app)
      .patch(`/projects/${project.id}`)
      .set(auth(member.token))
      .send({ customers: [{ id: customer.id, isPrimary: true }, { id: other.id, isPrimary: false }] });
    expect(links.status).toBe(403);
    expect(links.body.code).toBe("owner_only");

    const tam = await request(app).patch(`/projects/${project.id}`).set(auth(member.token)).send({ tamId: member.userId });
    expect(tam.status).toBe(403);
    expect(tam.body.code).toBe("owner_only");

    const share = await request(app)
      .post(`/projects/${project.id}/share-links`)
      .set(auth(member.token))
      .send({});
    expect(share.status).toBe(403);
    expect(share.body.code).toBe("owner_only");

    expect(await prisma.customer.count({ where: { id: customer.id, tamId: owner.userId } })).toBe(1);
    expect(await prisma.project.count({ where: { id: project.id } })).toBe(1);
  });

  it("can edit the customer's own fields", async () => {
    const { member, customer } = await fixture();
    await addToTeam(customer.id, member.userId);
    const res = await request(app)
      .patch(`/customers/${customer.id}`)
      .set(auth(member.token))
      .send({ description: "Edited by the team", accountManager: "AM" });
    expect(res.status).toBe(200);
    expect(res.body.description).toBe("Edited by the team");
  });
});

describe("/customers/:id/team", () => {
  it("GET lists members sorted by username with canManage", async () => {
    const { owner, member, outsider, customer } = await fixture();
    const second = await createUserWithRole("TAM");
    await prisma.customerTeamMember.createMany({
      data: [
        { customerId: customer.id, userId: member.userId, addedById: owner.userId },
        { customerId: customer.id, userId: second.userId },
      ],
    });
    const asOwner = await list(owner.token, customer.id);
    expect(asOwner.status).toBe(200);
    expect(asOwner.body.canManage).toBe(true);
    const names = (asOwner.body.members as Array<{ username: string }>).map((m) => m.username);
    expect(names).toEqual([...names].sort());
    const row = (asOwner.body.members as Array<{ userId: number }>).find((m) => m.userId === member.userId);
    expect(row).toMatchObject({
      userId: member.userId,
      active: true,
      addedBy: { id: owner.userId, username: expect.any(String) },
    });
    expect(row).toHaveProperty("email");
    expect(row).toHaveProperty("addedAt");

    const asMember = await list(member.token, customer.id);
    expect(asMember.status).toBe(200);
    expect(asMember.body.canManage).toBe(false);
    expect((await list(outsider.token, customer.id)).status).toBe(404);
  });

  it("owner with customer:write can add (201) and remove (204), recording activity", async () => {
    const { owner, member, customer } = await fixture();
    const added = await post(owner.token, customer.id, member.userId);
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ userId: member.userId, active: true, addedBy: { id: owner.userId } });

    expect((await del(owner.token, customer.id, member.userId)).status).toBe(204);
    const events = await prisma.customerActivityEvent.findMany({
      where: { customerId: customer.id },
      orderBy: { id: "asc" },
    });
    expect(events.map((e) => e.action)).toEqual(["team_member_added", "team_member_removed"]);
    expect(events.every((e) => e.actorId === owner.userId && e.memberId === member.userId)).toBe(true);
    expect(events[0].memberName).toBe(added.body.username);
  });

  it("customer:team-all manages any customer, including an unowned one", async () => {
    const { member } = await fixture();
    const lead = await userWith(["customer:read", "customer:team-all"]);
    const unowned = await prisma.customer.create({ data: { name: uniq("Unowned"), description: "d" } });
    expect((await post(lead.token, unowned.id, member.userId)).status).toBe(201);
    expect((await list(lead.token, unowned.id)).body.canManage).toBe(true);
    expect((await del(lead.token, unowned.id, member.userId)).status).toBe(204);
  });

  it("a plain customer:write holder who does not own the customer gets 403, a non-owner of an unowned customer too", async () => {
    const { owner, member, outsider, customer } = await fixture();
    // outsider sees the customer through the team, but does not own it.
    await addToTeam(customer.id, outsider.userId);
    const res = await post(outsider.token, customer.id, member.userId);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("forbidden");
    expect((await del(outsider.token, customer.id, owner.userId)).status).toBe(403);

    const unowned = await prisma.customer.create({ data: { name: uniq("Unowned"), description: "d" } });
    expect((await post(outsider.token, unowned.id, member.userId)).status).toBe(403);
    expect(await prisma.customerTeamMember.count({ where: { customerId: customer.id } })).toBe(1);
  });

  it("project:view-all alone does not manage the team", async () => {
    const { member, customer } = await fixture();
    const auditor = await createUserWithRole("AUDITOR");
    expect((await post(auditor.token, customer.id, member.userId)).status).toBe(403);
  });

  it("an owner without customer:write cannot manage the team", async () => {
    const reader = await userWith(["customer:read"]);
    const customer = await prisma.customer.create({
      data: { name: uniq("Owned"), description: "d", tamId: reader.userId },
    });
    const target = await createUserWithRole("TAM");
    expect((await post(reader.token, customer.id, target.userId)).status).toBe(403);
  });

  it("a caller who cannot see the customer gets 404 on every verb, before body validation", async () => {
    const { member, outsider, customer } = await fixture();
    expect((await post(outsider.token, customer.id, member.userId)).status).toBe(404);
    expect((await del(outsider.token, customer.id, member.userId)).status).toBe(404);
    const bad = await request(app).post(`/customers/${customer.id}/team`).set(auth(outsider.token)).send({});
    expect(bad.status).toBe(404);
  });

  it("refuses an inactive user (400), an unknown user (404), and a duplicate (409)", async () => {
    const { owner, member, customer } = await fixture();
    const inactive = await userWith([], { active: false });
    const res = await post(owner.token, customer.id, inactive.userId);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("user_inactive");
    expect((await post(owner.token, customer.id, 999_999_999)).status).toBe(404);

    expect((await post(owner.token, customer.id, member.userId)).status).toBe(201);
    const dup = await post(owner.token, customer.id, member.userId);
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("already_member");
    expect(await prisma.customerTeamMember.count({ where: { customerId: customer.id } })).toBe(1);
  });

  it("DELETE of a user who is not on the team is 404", async () => {
    const { owner, member, customer } = await fixture();
    expect((await del(owner.token, customer.id, member.userId)).status).toBe(404);
  });
});

describe("team membership counts as 'my projects' in Daily Review", () => {
  it("lists a team customer's project as mine, and surfaces the customer", async () => {
    const { member, customer, project } = await fixture();
    await addToTeam(customer.id, member.userId);
    const res = await request(app)
      .get("/daily-review")
      .query({ week: "2026-W47", today: "2026-11-19" })
      .set(auth(member.token));
    expect(res.status).toBe(200);
    const cust = (res.body.customers as Array<{ id: number; projects: Array<{ id: number }> }>).find(
      (c) => c.id === customer.id,
    );
    expect(cust).toBeDefined();
    expect(cust!.projects.map((p) => p.id)).toContain(project.id);
  });

  it("a non-member does not get the customer", async () => {
    const { outsider, customer } = await fixture();
    const res = await request(app)
      .get("/daily-review")
      .query({ week: "2026-W47", today: "2026-11-19" })
      .set(auth(outsider.token));
    expect((res.body.customers as Array<{ id: number }>).map((c) => c.id)).not.toContain(customer.id);
  });
});

describe("notifications reach team members", () => {
  it("a team member assigned a task is notified of a comment", async () => {
    const { owner, member, customer, project } = await fixture();
    await addToTeam(customer.id, member.userId);
    const task = await prisma.task.create({
      data: {
        statusId: SID.TODO, projectId: project.id, title: "T", status: "TODO", priority: "MEDIUM",
        position: 0, assignedToId: member.userId,
      },
    });
    const res = await request(app)
      .post(`/tasks/${task.id}/comments`)
      .set(auth(owner.token))
      .send({ body: "ping" });
    expect(res.status).toBe(201);
    const rows = await prisma.notification.findMany({ where: { userId: member.userId } });
    expect(rows.map((r) => r.reason)).toEqual(["commented"]);
  });
});

describe("assigning a task to a team member adds no ProjectMember", () => {
  it("single update, create and bulk paths leave project_members untouched", async () => {
    const { owner, member, customer, project } = await fixture();
    await addToTeam(customer.id, member.userId);

    const created = await request(app)
      .post(`/projects/${project.id}/tasks`)
      .set(auth(owner.token))
      .send({ title: "Assigned on create", assignedToId: member.userId });
    expect(created.status).toBe(201);

    const t2 = await prisma.task.create({
      data: { statusId: SID.TODO, projectId: project.id, title: "T2", status: "TODO", priority: "MEDIUM", position: 9 },
    });
    const patched = await request(app).patch(`/tasks/${t2.id}`).set(auth(owner.token)).send({ assignedToId: member.userId });
    expect(patched.status).toBe(200);

    const t3 = await prisma.task.create({
      data: { statusId: SID.TODO, projectId: project.id, title: "T3", status: "TODO", priority: "MEDIUM", position: 10 },
    });
    const bulk = await request(app)
      .post("/tasks/bulk")
      .set(auth(owner.token))
      .send({ taskIds: [t3.id], assignedToId: member.userId });
    expect(bulk.status).toBe(200);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t3.id } })).assignedToId).toBe(member.userId);

    expect(await prisma.projectMember.count({ where: { projectId: project.id, userId: member.userId } })).toBe(0);
  });

  it("still adds a member for an assignee with no team access", async () => {
    const { owner, outsider, project } = await fixture();
    const t = await prisma.task.create({
      data: { statusId: SID.TODO, projectId: project.id, title: "T", status: "TODO", priority: "MEDIUM", position: 0 },
    });
    const res = await request(app).patch(`/tasks/${t.id}`).set(auth(owner.token)).send({ assignedToId: outsider.userId });
    expect(res.status).toBe(200);
    expect(await prisma.projectMember.count({ where: { projectId: project.id, userId: outsider.userId } })).toBe(1);
  });
});

describe("workload", () => {
  it("a team member's own row counts their tasks in the team customer's projects", async () => {
    const { member, customer, project } = await fixture();
    await addToTeam(customer.id, member.userId);
    await prisma.task.create({
      data: {
        statusId: SID.TODO, projectId: project.id, title: "T", status: "TODO", priority: "MEDIUM",
        position: 0, assignedToId: member.userId,
      },
    });
    const res = await request(app)
      .get("/utilization/workload?week=2026-W47&utcOffsetMinutes=0")
      .set(auth(member.token));
    expect(res.status).toBe(200);
    const row = (res.body.rows as Array<{ userId: number; open: number }>).find((r) => r.userId === member.userId);
    expect(row?.open).toBe(1);
  });
});

describe("losing team access unassigns the person's tasks", () => {
  async function withAssignedTask() {
    const f = await fixture();
    await addToTeam(f.customer.id, f.member.userId);
    const task = await prisma.task.create({
      data: {
        statusId: SID.TODO, projectId: f.project.id, title: "T", status: "TODO", priority: "MEDIUM",
        position: 0, assignedToId: f.member.userId,
      },
    });
    return { ...f, task };
  }
  const assignee = async (taskId: number) =>
    (await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).assignedToId;

  it("removing a team member unassigns their tasks in the customer's projects and records activity", async () => {
    const { owner, member, customer, project, task } = await withAssignedTask();
    expect((await del(owner.token, customer.id, member.userId)).status).toBe(204);
    expect(await assignee(task.id)).toBeNull();
    const ev = await prisma.activityEvent.findFirstOrThrow({
      where: { projectId: project.id, entityType: "member", action: "removed" },
    });
    expect(ev.changes).toMatchObject({ unassignedTasks: 1, viaCustomerTeam: true });
  });

  it("keeps the tasks when another path still gives access (project member)", async () => {
    const { owner, member, customer, project, task } = await withAssignedTask();
    await prisma.projectMember.create({ data: { projectId: project.id, userId: member.userId } });
    expect((await del(owner.token, customer.id, member.userId)).status).toBe(204);
    expect(await assignee(task.id)).toBe(member.userId);
  });

  it("unlinking the project from the customer unassigns team members' tasks", async () => {
    const { owner, member, customer, project, task } = await withAssignedTask();
    const other = await prisma.customer.create({
      data: { name: uniq("Other"), description: "d", tamId: owner.userId },
    });
    const res = await request(app)
      .patch(`/projects/${project.id}`)
      .set(auth(owner.token))
      .send({ customers: [{ id: other.id, isPrimary: true }] });
    expect(res.status).toBe(200);
    expect(await prisma.projectCustomer.count({ where: { projectId: project.id, customerId: customer.id } })).toBe(0);
    expect(await assignee(task.id)).toBeNull();
  });

  it("deleting the customer unassigns team members' tasks", async () => {
    const { owner, customer, task } = await withAssignedTask();
    expect((await request(app).delete(`/customers/${customer.id}`).set(auth(owner.token))).status).toBe(204);
    expect(await assignee(task.id)).toBeNull();
  });
});

describe("GET /projects/:id/team-access", () => {
  it("returns the user ids with access through a customer team", async () => {
    const { owner, member, outsider, customer, project } = await fixture();
    await addToTeam(customer.id, member.userId);
    await prisma.projectMember.create({ data: { projectId: project.id, userId: outsider.userId } });
    const res = await request(app).get(`/projects/${project.id}/team-access`).set(auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ teamAccessUserIds: [member.userId] });
    const hidden = await createUserWithRole("TAM");
    expect((await request(app).get(`/projects/${project.id}/team-access`).set(auth(hidden.token))).status).toBe(404);
  });
});
