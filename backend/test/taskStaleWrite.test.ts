// C4 (docs/archive/plans/collaboration-and-sharing.md): per-field optimistic
// check on PATCH /tasks/:id. `expected` holds the value the client last saw for
// each field it changes; the save 409s `stale_write` only when someone changed
// one of THOSE fields.
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
  const other = await createUserWithRole("TAM");
  const customer = await prisma.customer.create({
    data: { name: uniq("Customer"), description: "d", tamId: tam.userId },
  });
  const project = await prisma.project.create({
    data: { name: uniq("Project"), tamId: tam.userId, customerId: customer.id, status: "ACTIVE" },
  });
  const task = await prisma.task.create({
    data: {
      projectId: project.id,
      title: "Original",
      description: "desc",
      status: "TODO",
      priority: "MEDIUM",
      dueDate: new Date("2026-10-05T00:00:00.000Z"),
    },
  });
  return { tam, other, project, task };
}

const patch = (token: string, id: number, body: object) =>
  request(app).patch(`/tasks/${id}`).set(auth(token)).send(body);

describe("PATCH /tasks/:id — expected (per-field optimistic check)", () => {
  it("applies the write when every expected value still matches", async () => {
    const { tam, task } = await fixture();
    const res = await patch(tam.token, task.id, {
      title: "Renamed",
      status: "IN_PROGRESS",
      expected: { title: "Original", status: "TODO", description: "desc", dueDate: "2026-10-05" },
    });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Renamed");
    const row = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row).toMatchObject({ title: "Renamed", status: "IN_PROGRESS" });
  });

  it("409 stale_write when an expected field changed; nothing is written", async () => {
    const { tam, other, task } = await fixture();
    await prisma.task.update({ where: { id: task.id }, data: { title: "Theirs" } });

    const res = await patch(tam.token, task.id, {
      title: "Mine",
      priority: "HIGH",
      assignedToId: other.userId,
      expected: { title: "Original", priority: "MEDIUM", assignedToId: null },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("stale_write");
    expect(res.body.details.conflicts).toEqual([
      { field: "title", expected: "Original", current: "Theirs" },
    ]);
    // The current task comes back in the normal PATCH response shape.
    expect(res.body.details.task).toMatchObject({ id: task.id, title: "Theirs", priority: "MEDIUM", labels: [] });
    expect(res.body.details.task).toHaveProperty("assignedTo", null);
    // Same keys as a successful PATCH response for that task.
    const okRes = await patch(tam.token, task.id, {});
    expect(okRes.status).toBe(200);
    expect(Object.keys(res.body.details.task).sort()).toEqual(Object.keys(okRes.body).sort());

    const row = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row).toMatchObject({ title: "Theirs", priority: "MEDIUM", assignedToId: null });
    // No C2 side effect: the would-be assignee was not added as a member.
    expect(await prisma.projectMember.count({ where: { projectId: row.projectId } })).toBe(0);
  });

  it("lists every conflicting field", async () => {
    const { tam, task } = await fixture();
    await prisma.task.update({ where: { id: task.id }, data: { status: "DONE", isMilestone: true } });
    const res = await patch(tam.token, task.id, {
      status: "IN_PROGRESS",
      expected: { status: "TODO", isMilestone: false, isCriticalPath: false },
    });
    expect(res.status).toBe(409);
    const fields = (res.body.details.conflicts as { field: string }[]).map((c) => c.field).sort();
    expect(fields).toEqual(["isMilestone", "status"]);
  });

  it("a change to a different field is not a conflict", async () => {
    const { tam, task } = await fixture();
    // Someone else moved the due date; I only edited the title.
    await prisma.task.update({
      where: { id: task.id },
      data: { dueDate: new Date("2026-11-30T00:00:00.000Z") },
    });
    const res = await patch(tam.token, task.id, {
      title: "Mine",
      expected: { title: "Original" },
    });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Mine");
  });

  it("compares dates as calendar days, not instants", async () => {
    const { tam, task } = await fixture();
    // Legacy row: a non-midnight instant on 2026-10-05 (UTC).
    await prisma.task.update({
      where: { id: task.id },
      data: { dueDate: new Date("2026-10-05T13:45:00.000Z") },
    });
    const same = await patch(tam.token, task.id, {
      title: "A",
      expected: { dueDate: "2026-10-05" },
    });
    expect(same.status).toBe(200);
    const sameIso = await patch(tam.token, task.id, {
      title: "B",
      expected: { dueDate: "2026-10-05T00:00:00.000Z" },
    });
    expect(sameIso.status).toBe(200);

    const otherDay = await patch(tam.token, task.id, {
      title: "C",
      expected: { dueDate: "2026-10-06" },
    });
    expect(otherDay.status).toBe(409);
    expect(otherDay.body.details.conflicts[0].field).toBe("dueDate");
  });

  it("null matches null and only null", async () => {
    const { tam, task } = await fixture();
    // startDate is null on the fixture.
    const ok = await patch(tam.token, task.id, {
      title: "A",
      expected: { startDate: null, assignedToId: null, sectionId: null, epicId: null, parentTaskId: null },
    });
    expect(ok.status).toBe(200);

    const stale = await patch(tam.token, task.id, {
      title: "B",
      expected: { startDate: "2026-10-01" },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.details.conflicts).toEqual([
      { field: "startDate", expected: "2026-10-01T00:00:00.000Z", current: null },
    ]);

    // Expected null, current non-null.
    const stale2 = await patch(tam.token, task.id, {
      title: "C",
      expected: { dueDate: null },
    });
    expect(stale2.status).toBe(409);
    expect(stale2.body.details.conflicts[0]).toMatchObject({ field: "dueDate", expected: null });
  });

  it("compares labelIds as an unordered set", async () => {
    const { tam, project, task } = await fixture();
    const [a, b, c] = await Promise.all(
      ["a", "b", "c"].map((name) =>
        prisma.label.create({ data: { projectId: project.id, name: uniq(name), color: "#112233" } }),
      ),
    );
    await prisma.task.update({
      where: { id: task.id },
      data: { labels: { set: [{ id: a.id }, { id: b.id }] } },
    });

    const ok = await patch(tam.token, task.id, {
      labelIds: [c.id],
      expected: { labelIds: [b.id, a.id] },
    });
    expect(ok.status).toBe(200);

    // Now the labels are [c]; expecting [a, b] is stale, and a subset is too.
    const stale = await patch(tam.token, task.id, {
      title: "x",
      expected: { labelIds: [a.id, b.id] },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.details.conflicts).toEqual([
      { field: "labelIds", expected: [a.id, b.id], current: [c.id] },
    ]);
    const subset = await patch(tam.token, task.id, { title: "x", expected: { labelIds: [] } });
    expect(subset.status).toBe(409);
    const empty = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(empty.title).toBe("Original");
  });

  it("checks expected before a reorder (position) and writes nothing on conflict", async () => {
    const { tam, project, task } = await fixture();
    const sibling = await prisma.task.create({
      data: { projectId: project.id, title: "Sibling", position: 1 },
    });
    await prisma.task.update({ where: { id: task.id }, data: { position: 0 } });

    const stale = await patch(tam.token, task.id, {
      position: 1,
      status: "DONE",
      expected: { status: "IN_PROGRESS" },
    });
    expect(stale.status).toBe(409);
    expect(await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({
      position: 0,
      status: "TODO",
    });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: sibling.id } })).position).toBe(1);

    const ok = await patch(tam.token, task.id, {
      position: 1,
      expected: { status: "TODO" },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.position).toBe(1);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: sibling.id } })).position).toBe(0);
  });

  it("still adds a new assignee as a member when expected matches", async () => {
    const { tam, other, project, task } = await fixture();
    const res = await patch(tam.token, task.id, {
      assignedToId: other.userId,
      expected: { assignedToId: null },
    });
    expect(res.status).toBe(200);
    expect(await prisma.projectMember.count({ where: { projectId: project.id, userId: other.userId } })).toBe(1);
  });

  it("without expected it stays last-write-wins", async () => {
    const { tam, task } = await fixture();
    await prisma.task.update({ where: { id: task.id }, data: { title: "Theirs" } });
    const res = await patch(tam.token, task.id, { title: "Mine" });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Mine");
  });

  it("404 (not 400/409) for a task the caller cannot see, before any check", async () => {
    const { task } = await fixture();
    const stranger = await createUserWithRole("TAM");
    const res = await patch(stranger.token, task.id, { title: "x", expected: { title: "nope" } });
    expect(res.status).toBe(404);
  });

  it("rejects a malformed expected value with 400", async () => {
    const { tam, task } = await fixture();
    const res = await patch(tam.token, task.id, { title: "x", expected: { status: "NOPE" } });
    expect(res.status).toBe(400);
  });

  it("uses the locked row for the milestone rule (no stale due date written to startDate)", async () => {
    const { tam, task } = await fixture();
    await prisma.task.update({ where: { id: task.id }, data: { isMilestone: false } });
    // Milestone toggled on with expected: startDate must follow the CURRENT due date.
    const res = await patch(tam.token, task.id, {
      isMilestone: true,
      expected: { isMilestone: false },
    });
    expect(res.status).toBe(200);
    expect(res.body.startDate).toBe("2026-10-05T00:00:00.000Z");
  });

  it("does not deadlock against a labels-only write without expected", async () => {
    const { tam, other, project } = await fixture();
    await prisma.projectMember.create({
      data: { projectId: project.id, userId: other.userId, addedById: tam.userId },
    });
    const [a, b, c] = await Promise.all(
      ["a", "b", "c"].map((name) =>
        prisma.label.create({ data: { projectId: project.id, name: uniq(name), color: "#112233" } }),
      ),
    );
    // A labels write is DELETE + INSERT on the join table; its FK check takes
    // FOR KEY SHARE on the task row, which a FOR UPDATE lock would deadlock with.
    for (let i = 0; i < 20; i++) {
      const task = await prisma.task.create({
        data: { projectId: project.id, title: "Original", labels: { connect: [{ id: a.id }, { id: b.id }] } },
      });
      const both = await Promise.all([
        patch(tam.token, task.id, { labelIds: [a.id, c.id], expected: { title: "Original" } }),
        patch(other.token, task.id, { labelIds: [b.id, c.id] }),
      ]);
      for (const r of both) expect(r.status).toBe(200);
    }
  });

  it("two concurrent saves with the same expected: exactly one wins", async () => {
    const { tam, other, project } = await fixture();
    await prisma.projectMember.create({
      data: { projectId: project.id, userId: other.userId, addedById: tam.userId },
    });
    // Repeat on fresh tasks so a lucky interleaving can't hide a missing lock.
    for (let i = 0; i < 5; i++) {
      const task = await prisma.task.create({ data: { projectId: project.id, title: "Original" } });
      const expected = { title: "Original" };
      const both = await Promise.all([
        patch(tam.token, task.id, { title: "From A", expected }),
        patch(other.token, task.id, { title: "From B", expected }),
      ]);
      expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
      const loser = both.find((r) => r.status === 409)!;
      const winner = both.find((r) => r.status === 200)!;
      expect(loser.body.code).toBe("stale_write");
      expect(loser.body.details.task.title).toBe(winner.body.title);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).title).toBe(winner.body.title);
    }
  });
});
