// Project members (docs/archive/plans/collaboration-and-sharing.md, C1):
// the projectVisibilityFilter member arm and the /projects/:id/members API.
// Fixtures write via `prisma` directly.
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

/**
 * tam    — project TAM, also owns the customer
 * member — a TAM-role user with no relation to the project (until added)
 * outsider — another unrelated TAM
 * customer — owned by `tam`; project — under it, tamId = tam
 */
async function fixture() {
  const tam = await createUserWithRole("TAM");
  const member = await createUserWithRole("TAM");
  const outsider = await createUserWithRole("TAM");
  const customer = await prisma.customer.create({
    data: { name: uniq("Customer"), description: "d", tamId: tam.userId },
  });
  const project = await prisma.project.create({
    data: { name: uniq("Project"), tamId: tam.userId, customerId: customer.id, status: "ACTIVE" },
  });
  return { tam, member, outsider, customer, project };
}

async function addMember(projectId: number, userId: number, addedById: number | null = null) {
  await prisma.projectMember.create({ data: { projectId, userId, addedById } });
}

describe("projectVisibilityFilter — member arm", () => {
  it("a member sees the project in the list, its detail, nested routes and its customer", async () => {
    const { tam, member, customer, project } = await fixture();
    await addMember(project.id, member.userId, tam.userId);
    const task = await prisma.task.create({
      data: { projectId: project.id, title: "T", status: "TODO", priority: "MEDIUM", position: 0 },
    });

    const list = await request(app).get("/projects").set(auth(member.token));
    expect(list.status).toBe(200);
    expect((list.body as Array<{ id: number }>).map((p) => p.id)).toContain(project.id);

    const detail = await request(app).get(`/projects/${project.id}`).set(auth(member.token));
    expect(detail.status).toBe(200);

    const tasks = await request(app).get(`/projects/${project.id}/tasks`).set(auth(member.token));
    expect(tasks.status).toBe(200);
    expect((tasks.body as Array<{ id: number }>).map((t) => t.id)).toContain(task.id);

    // Full edit access, same as the TAM.
    const patch = await request(app)
      .patch(`/tasks/${task.id}`)
      .set(auth(member.token))
      .send({ title: "Renamed" });
    expect(patch.status).toBe(200);

    const cust = await request(app).get(`/customers/${customer.id}`).set(auth(member.token));
    expect(cust.status).toBe(200);
  });

  it("a non-member gets 404 on the project and its nested routes", async () => {
    const { outsider, project } = await fixture();
    const detail = await request(app).get(`/projects/${project.id}`).set(auth(outsider.token));
    expect(detail.status).toBe(404);
    const tasks = await request(app).get(`/projects/${project.id}/tasks`).set(auth(outsider.token));
    expect(tasks.status).toBe(404);
    const list = await request(app).get("/projects").set(auth(outsider.token));
    expect((list.body as Array<{ id: number }>).map((p) => p.id)).not.toContain(project.id);
  });

  it("a removed member gets 404 again", async () => {
    const { tam, member, project } = await fixture();
    await addMember(project.id, member.userId, tam.userId);
    expect((await request(app).get(`/projects/${project.id}`).set(auth(member.token))).status).toBe(200);

    const del = await request(app)
      .delete(`/projects/${project.id}/members/${member.userId}`)
      .set(auth(tam.token));
    expect(del.status).toBe(204);

    expect((await request(app).get(`/projects/${project.id}`).set(auth(member.token))).status).toBe(404);
  });
});

describe("GET /projects/:id/members", () => {
  it("lists members ordered by username with the contract shape, excluding the TAM", async () => {
    const { tam, member, outsider, project } = await fixture();
    await addMember(project.id, member.userId, tam.userId);
    await addMember(project.id, outsider.userId, null);
    // A member row for the TAM (e.g. added before a TAM reassignment) is hidden.
    await addMember(project.id, tam.userId, null);

    const res = await request(app).get(`/projects/${project.id}/members`).set(auth(tam.token));
    expect(res.status).toBe(200);
    const rows = res.body as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.userId).sort()).toEqual([member.userId, outsider.userId].sort());
    const usernames = rows.map((r) => r.username as string);
    expect(usernames).toEqual([...usernames].sort());

    const row = rows.find((r) => r.userId === member.userId)!;
    expect(Object.keys(row).sort()).toEqual(
      ["addedAt", "addedBy", "assignedTaskCount", "avatarUrl", "email", "userId", "username"],
    );
    expect(row.avatarUrl).toBeNull();
    expect(typeof row.addedAt).toBe("string");
    const tamUser = await prisma.user.findUniqueOrThrow({ where: { id: tam.userId } });
    expect(row.addedBy).toEqual({ id: tam.userId, username: tamUser.username });
    expect(rows.find((r) => r.userId === outsider.userId)!.addedBy).toBeNull();
  });

  it("reports assignedTaskCount per member, counting only this project's tasks", async () => {
    const { tam, member, outsider, project } = await fixture();
    await addMember(project.id, member.userId, tam.userId);
    await addMember(project.id, outsider.userId, tam.userId);
    const mk = (projectId: number, assignedToId: number | null) =>
      prisma.task.create({
        data: { projectId, title: "T", status: "TODO", priority: "MEDIUM", position: 0, assignedToId },
      });
    await mk(project.id, member.userId);
    await mk(project.id, member.userId);
    const other = await prisma.project.create({
      data: { name: uniq("Other"), tamId: tam.userId, status: "ACTIVE" },
    });
    await mk(other.id, member.userId);

    const res = await request(app).get(`/projects/${project.id}/members`).set(auth(tam.token));
    const rows = res.body as Array<{ userId: number; assignedTaskCount: number }>;
    expect(rows.find((r) => r.userId === member.userId)!.assignedTaskCount).toBe(2);
    expect(rows.find((r) => r.userId === outsider.userId)!.assignedTaskCount).toBe(0);
  });

  it("a member can list members; a non-member gets 404", async () => {
    const { tam, member, outsider, project } = await fixture();
    await addMember(project.id, member.userId, tam.userId);
    expect(
      (await request(app).get(`/projects/${project.id}/members`).set(auth(member.token))).status,
    ).toBe(200);
    expect(
      (await request(app).get(`/projects/${project.id}/members`).set(auth(outsider.token))).status,
    ).toBe(404);
  });
});

describe("POST /projects/:id/members", () => {
  it("adds a member (201) and is idempotent (200, one row)", async () => {
    const { tam, member, project } = await fixture();
    const first = await request(app)
      .post(`/projects/${project.id}/members`)
      .set(auth(tam.token))
      .send({ userId: member.userId });
    expect(first.status).toBe(201);
    expect(first.body.userId).toBe(member.userId);
    expect(first.body.addedBy.id).toBe(tam.userId);

    const second = await request(app)
      .post(`/projects/${project.id}/members`)
      .set(auth(tam.token))
      .send({ userId: member.userId });
    expect(second.status).toBe(200);
    expect(second.body.userId).toBe(member.userId);
    expect(second.body.addedAt).toBe(first.body.addedAt);

    expect(await prisma.projectMember.count({ where: { projectId: project.id } })).toBe(1);
  });

  it("an existing member can add another member", async () => {
    const { tam, member, outsider, project } = await fixture();
    await addMember(project.id, member.userId, tam.userId);
    const res = await request(app)
      .post(`/projects/${project.id}/members`)
      .set(auth(member.token))
      .send({ userId: outsider.userId });
    expect(res.status).toBe(201);
  });

  it("400 is_tam when adding the project's TAM", async () => {
    const { tam, project } = await fixture();
    const res = await request(app)
      .post(`/projects/${project.id}/members`)
      .set(auth(tam.token))
      .send({ userId: tam.userId });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("is_tam");
  });

  it("400 user_inactive for an inactive user", async () => {
    const { tam, member, project } = await fixture();
    await prisma.user.update({ where: { id: member.userId }, data: { active: false } });
    const res = await request(app)
      .post(`/projects/${project.id}/members`)
      .set(auth(tam.token))
      .send({ userId: member.userId });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("user_inactive");
  });

  it("re-adding an existing member who was deactivated since is still 200; only a new add is refused", async () => {
    const { tam, member, project } = await fixture();
    await addMember(project.id, member.userId, tam.userId);
    await prisma.user.update({ where: { id: member.userId }, data: { active: false } });
    const res = await request(app)
      .post(`/projects/${project.id}/members`)
      .set(auth(tam.token))
      .send({ userId: member.userId });
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(member.userId);
  });

  it("404 user_not_found for an unknown user", async () => {
    const { tam, project } = await fixture();
    const res = await request(app)
      .post(`/projects/${project.id}/members`)
      .set(auth(tam.token))
      .send({ userId: 2_000_000_000 });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("user_not_found");
  });

  it("404 before body validation on a project the caller cannot see", async () => {
    const { member, outsider, project } = await fixture();
    const valid = await request(app)
      .post(`/projects/${project.id}/members`)
      .set(auth(outsider.token))
      .send({ userId: member.userId });
    expect(valid.status).toBe(404);
    const invalid = await request(app)
      .post(`/projects/${project.id}/members`)
      .set(auth(outsider.token))
      .send({ userId: "nope" });
    expect(invalid.status).toBe(404);
    expect(await prisma.projectMember.count({ where: { projectId: project.id } })).toBe(0);
  });

  it("400 validation_error for a bad body on a visible project", async () => {
    const { tam, project } = await fixture();
    const res = await request(app)
      .post(`/projects/${project.id}/members`)
      .set(auth(tam.token))
      .send({ userId: "nope" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation_error");
  });

  it("403 without project:write (read-only view-all user)", async () => {
    const { member, project } = await fixture();
    const viewer = await createUserWithRole("STAKEHOLDER");
    const res = await request(app)
      .post(`/projects/${project.id}/members`)
      .set(auth(viewer.token))
      .send({ userId: member.userId });
    expect(res.status).toBe(403);
    const del = await request(app)
      .delete(`/projects/${project.id}/members/${member.userId}`)
      .set(auth(viewer.token));
    expect(del.status).toBe(403);
    // ...but they can read the list.
    const list = await request(app).get(`/projects/${project.id}/members`).set(auth(viewer.token));
    expect(list.status).toBe(200);
  });

  it("a project:view-all user with write can manage members of any project", async () => {
    const { member, project } = await fixture();
    const admin = await createUserWithRole("ADMIN");
    const res = await request(app)
      .post(`/projects/${project.id}/members`)
      .set(auth(admin.token))
      .send({ userId: member.userId });
    expect(res.status).toBe(201);
  });
});

describe("DELETE /projects/:id/members/:userId", () => {
  it("removes a member (204) and is 204 again when not a member", async () => {
    const { tam, member, project } = await fixture();
    await addMember(project.id, member.userId, tam.userId);
    const first = await request(app)
      .delete(`/projects/${project.id}/members/${member.userId}`)
      .set(auth(tam.token));
    expect(first.status).toBe(204);
    const second = await request(app)
      .delete(`/projects/${project.id}/members/${member.userId}`)
      .set(auth(tam.token));
    expect(second.status).toBe(204);
    expect(await prisma.projectMember.count({ where: { projectId: project.id } })).toBe(0);
  });

  it("unassigns the removed member's tasks in this project only", async () => {
    const { tam, member, project } = await fixture();
    await addMember(project.id, member.userId, tam.userId);
    const other = await prisma.project.create({
      data: { name: uniq("Other"), tamId: tam.userId, status: "ACTIVE" },
    });
    await addMember(other.id, member.userId, tam.userId);
    const mk = (projectId: number, assignedToId: number) =>
      prisma.task.create({
        data: { projectId, title: "T", status: "TODO", priority: "MEDIUM", position: 0, assignedToId },
      });
    const mine = await mk(project.id, member.userId);
    const tamTask = await mk(project.id, tam.userId);
    const elsewhere = await mk(other.id, member.userId);

    const del = await request(app)
      .delete(`/projects/${project.id}/members/${member.userId}`)
      .set(auth(tam.token));
    expect(del.status).toBe(204);

    const get = (id: number) => prisma.task.findUniqueOrThrow({ where: { id } });
    expect((await get(mine.id)).assignedToId).toBeNull();
    expect((await get(tamTask.id)).assignedToId).toBe(tam.userId);
    expect((await get(elsewhere.id)).assignedToId).toBe(member.userId);
  });

  it("DELETE for a non-member (e.g. the TAM) leaves that user's tasks assigned", async () => {
    const { tam, project } = await fixture();
    const task = await prisma.task.create({
      data: { projectId: project.id, title: "T", status: "TODO", priority: "MEDIUM", position: 0, assignedToId: tam.userId },
    });
    const del = await request(app)
      .delete(`/projects/${project.id}/members/${tam.userId}`)
      .set(auth(tam.token));
    expect(del.status).toBe(204);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).assignedToId).toBe(tam.userId);
  });

  it("removing a stale member row of the current TAM (TAM reassigned to a member) keeps the TAM's tasks assigned", async () => {
    const { tam, member, project } = await fixture();
    await addMember(project.id, member.userId, tam.userId);
    const task = await prisma.task.create({
      data: { projectId: project.id, title: "T", status: "TODO", priority: "MEDIUM", position: 0, assignedToId: member.userId },
    });
    // Reassign the TAM to the existing member; their member row stays behind.
    await prisma.project.update({ where: { id: project.id }, data: { tamId: member.userId } });

    const list = await request(app).get(`/projects/${project.id}/members`).set(auth(member.token));
    expect((list.body as Array<{ userId: number }>).map((r) => r.userId)).not.toContain(member.userId);

    const del = await request(app)
      .delete(`/projects/${project.id}/members/${member.userId}`)
      .set(auth(member.token));
    expect(del.status).toBe(204);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).assignedToId).toBe(member.userId);
  });

  it("a member can remove themselves and then loses access", async () => {
    const { tam, member, project } = await fixture();
    await addMember(project.id, member.userId, tam.userId);
    const del = await request(app)
      .delete(`/projects/${project.id}/members/${member.userId}`)
      .set(auth(member.token));
    expect(del.status).toBe(204);
    expect((await request(app).get(`/projects/${project.id}`).set(auth(member.token))).status).toBe(404);
  });

  it("404 on a project the caller cannot see, and nothing is deleted", async () => {
    const { tam, member, outsider, project } = await fixture();
    await addMember(project.id, member.userId, tam.userId);
    const res = await request(app)
      .delete(`/projects/${project.id}/members/${member.userId}`)
      .set(auth(outsider.token));
    expect(res.status).toBe(404);
    expect(await prisma.projectMember.count({ where: { projectId: project.id } })).toBe(1);
  });

  it("membership rows cascade when the project is deleted", async () => {
    const { tam, member, project } = await fixture();
    await addMember(project.id, member.userId, tam.userId);
    await prisma.project.delete({ where: { id: project.id } });
    expect(await prisma.projectMember.count({ where: { projectId: project.id } })).toBe(0);
  });
});

describe("GET /users", () => {
  it("includes active and avatarUrl on every row", async () => {
    const { tam, member } = await fixture();
    await prisma.user.update({ where: { id: member.userId }, data: { active: false } });
    const res = await request(app).get("/users").set(auth(tam.token));
    expect(res.status).toBe(200);
    const rows = res.body as Array<{ id: number; active: boolean; avatarUrl: string | null }>;
    expect(rows.find((u) => u.id === tam.userId)).toMatchObject({ active: true, avatarUrl: null });
    expect(rows.find((u) => u.id === member.userId)).toMatchObject({ active: false });
  });
});

describe("GET /projects/:id — detail payload", () => {
  it("includes the TAM's avatarUrl and the customer's tamId", async () => {
    const { tam, member, customer, project } = await fixture();
    await addMember(project.id, member.userId, tam.userId);
    await prisma.user.update({ where: { id: tam.userId }, data: { avatarUrl: "https://example.com/a.png" } });
    const res = await request(app).get(`/projects/${project.id}`).set(auth(member.token));
    expect(res.status).toBe(200);
    expect(res.body.tam.avatarUrl).toBe("https://example.com/a.png");
    expect(res.body.customer.tamId).toBe(tam.userId);
    expect(res.body.customer.id).toBe(customer.id);
  });
});
