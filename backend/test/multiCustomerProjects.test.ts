// One project shared by several customers (docs/archive/plans/multi-customer-projects.md):
// visibility through ANY linked customer, one Daily Review row per customer,
// owner-only link changes, primary promotion on customer delete, and the
// primary-only surfaces (guest page, portfolio rows).
import "./env.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { createAdminAndToken, createUserWithRole, seedRoles } from "./testAuth.js";
import { SID } from "./statusFixtures.js";

const app = createApp();
beforeAll(async () => {
  await seedRoles();
});

const WEEK = "2026-W35";
const TODAY = "2026-08-28";
const uniq = (l: string) => `${l} ${Date.now()}-${Math.random()}`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const customerOf = (tamId: number | null, name = uniq("Customer")) =>
  prisma.customer.create({ data: { name, description: "d", tamId } });

/** Project TAM `tam`, primary `primary`, plus `others` as secondary links (oldest first). */
async function sharedProject(tamId: number, primaryId: number, others: number[] = []) {
  const base = Date.now();
  return prisma.project.create({
    data: {
      name: uniq("Shared"),
      tamId,
      status: "ACTIVE",
      customers: {
        create: [
          { customerId: primaryId, isPrimary: true, addedAt: new Date(base - 10_000) },
          ...others.map((customerId, i) => ({
            customerId,
            isPrimary: false,
            addedAt: new Date(base - 5_000 + i * 1000),
          })),
        ],
      },
    },
  });
}

async function world() {
  const tamA = await createUserWithRole("TAM"); // project TAM + owns A
  const tamB = await createUserWithRole("TAM"); // owns B only (secondary)
  const stranger = await createUserWithRole("TAM"); // owns neither
  const member = await createUserWithRole("TAM");
  const a = await customerOf(tamA.userId);
  const b = await customerOf(tamB.userId);
  const project = await sharedProject(tamA.userId, a.id, [b.id]);
  await prisma.projectMember.create({ data: { projectId: project.id, userId: member.userId } });
  return { tamA, tamB, stranger, member, a, b, project };
}

describe("visibility through any linked customer", () => {
  it("the secondary customer's TAM sees the project in list, detail, tasks and the customer filters", async () => {
    const { tamB, a, b, project } = await world();
    await prisma.task.create({
      data: { projectId: project.id, title: "T", statusId: SID.TODO, status: "TODO" },
    });
    const list = await request(app).get("/projects").set(auth(tamB.token));
    expect(list.body.map((p: { id: number }) => p.id)).toContain(project.id);
    const byB = await request(app).get("/projects").query({ customerId: b.id }).set(auth(tamB.token));
    expect(byB.body.map((p: { id: number }) => p.id)).toContain(project.id);
    const byA = await request(app).get("/projects").query({ customerId: a.id }).set(auth(tamB.token));
    expect(byA.body.map((p: { id: number }) => p.id)).toContain(project.id);

    const detail = await request(app).get(`/projects/${project.id}`).set(auth(tamB.token));
    expect(detail.status).toBe(200);
    expect(detail.body.customers.map((c: { id: number; isPrimary: boolean }) => [c.id, c.isPrimary])).toEqual([
      [a.id, true],
      [b.id, false],
    ]);
    expect(detail.body.primaryCustomer.id).toBe(a.id);
    expect(detail.body.customerId).toBe(a.id); // legacy field = primary
    expect(detail.body.customer.id).toBe(a.id);

    const tasks = await request(app).get("/tasks").query({ customerId: b.id }).set(auth(tamB.token));
    expect(tasks.body.map((t: { projectId: number }) => t.projectId)).toContain(project.id);
    expect(tasks.body[0].project.customer.id).toBe(a.id); // primary
    expect((await request(app).get(`/projects/${project.id}/tasks`).set(auth(tamB.token))).status).toBe(200);
  });

  it("a user who owns neither customer gets 404, a member still sees it", async () => {
    const { stranger, member, project } = await world();
    expect((await request(app).get(`/projects/${project.id}`).set(auth(stranger.token))).status).toBe(404);
    expect((await request(app).get(`/projects/${project.id}/tasks`).set(auth(stranger.token))).status).toBe(404);
    const list = await request(app).get("/projects").set(auth(stranger.token));
    expect(list.body.map((p: { id: number }) => p.id)).not.toContain(project.id);
    expect((await request(app).get(`/projects/${project.id}`).set(auth(member.token))).status).toBe(200);
  });

  it("the secondary customer's owner reaches the customer through the project", async () => {
    const { tamB, b, project } = await world();
    const detail = await request(app).get(`/customers/${b.id}`).set(auth(tamB.token));
    expect(detail.status).toBe(200);
    const row = detail.body.projects.find((p: { id: number }) => p.id === project.id);
    expect(row).toMatchObject({ isPrimary: false, isShared: true });
    expect(row.primaryCustomer.id).not.toBe(b.id);
  });
});

describe("Daily Review and badges", () => {
  it("lists the shared project under BOTH linked customers; each owner sees it under theirs", async () => {
    const viewer = await createUserWithRole("TAM");
    const other = await createUserWithRole("TAM");
    const a = await customerOf(viewer.userId);
    const b = await customerOf(viewer.userId);
    const project = await sharedProject(other.userId, a.id, [b.id]);
    const res = await request(app).get("/daily-review").query({ week: WEEK, today: TODAY }).set(auth(viewer.token));
    expect(res.status).toBe(200);
    for (const c of [a, b]) {
      const group = res.body.customers.find((x: { id: number }) => x.id === c.id);
      expect(group.projects.map((p: { id: number }) => p.id)).toEqual([project.id]);
    }
    expect(res.body.unassignedProjects.map((p: { id: number }) => p.id)).not.toContain(project.id);
  });

  it("the secondary customer's TAM gets the project under their customer, and the badge counts it", async () => {
    const { tamB, b, project } = await world();
    // tamB is not the project's TAM nor a member: they own customer B, so the
    // owned-customer arm lists every ACTIVE project of B.
    const res = await request(app).get("/daily-review").query({ week: WEEK, today: TODAY }).set(auth(tamB.token));
    const group = res.body.customers.find((x: { id: number }) => x.id === b.id);
    expect(group.projects.map((p: { id: number }) => p.id)).toContain(project.id);
    const badge = await request(app).get("/overview/badges").query({ today: TODAY }).set(auth(tamB.token));
    expect(badge.body.dailyReviewPending).toBe(1);
  });

  it("an attached customer needs a project of the caller's own; a project in scope only via another owned customer doesn't add it", async () => {
    const { tamA, tamB, a, b, project } = await world();
    // tamB (owns B only, not the project's TAM): A must not appear.
    const asB = await request(app).get("/daily-review").query({ week: WEEK, today: TODAY }).set(auth(tamB.token));
    expect(asB.body.customers.map((c: { id: number }) => c.id)).toEqual([b.id]);
    // A TAM who owns B and is the project TAM sees it under both (A is owned by someone else = attached).
    const mine = await createUserWithRole("TAM");
    const ownedB = await customerOf(mine.userId);
    const attachedA = await customerOf(tamA.userId);
    const p = await sharedProject(mine.userId, attachedA.id, [ownedB.id]);
    const asMine = await request(app).get("/daily-review").query({ week: WEEK, today: TODAY }).set(auth(mine.token));
    for (const c of [attachedA, ownedB]) {
      const g = asMine.body.customers.find((x: { id: number }) => x.id === c.id);
      expect(g.projects.map((x: { id: number }) => x.id)).toEqual([p.id]);
    }
    expect(project.id).not.toBe(p.id);
    expect(a.id).not.toBe(b.id);
  });

  it("badge and groups: a project the caller sees only via owned C1 does not count under attached C2", async () => {
    const owner = await createUserWithRole("TAM");
    const other = await createUserWithRole("TAM");
    const c1 = await customerOf(owner.userId);
    const c2 = await customerOf(other.userId); // attached at best, never owned by `owner`
    const p = await sharedProject(other.userId, c2.id, [c1.id]);
    // owner is neither the TAM nor a member: sees p only via C1.
    const res = await request(app).get("/daily-review").query({ week: WEEK, today: TODAY }).set(auth(owner.token));
    expect(res.body.customers.map((c: { id: number }) => c.id)).toEqual([c1.id]);
    expect(res.body.customers[0].projects.map((x: { id: number }) => x.id)).toEqual([p.id]);
    const badge = await request(app).get("/overview/badges").query({ today: TODAY }).set(auth(owner.token));
    expect(badge.body.dailyReviewPending).toBe(1);
  });

  it("a project with no customer link is unassigned", async () => {
    const tam = await createUserWithRole("TAM");
    const p = await prisma.project.create({ data: { name: uniq("Solo"), tamId: tam.userId, status: "ACTIVE" } });
    const res = await request(app).get("/daily-review").query({ week: WEEK, today: TODAY }).set(auth(tam.token));
    expect(res.body.unassignedProjects.map((x: { id: number }) => x.id)).toContain(p.id);
  });
});

describe("roll-ups", () => {
  it("counts a shared project's overdue tasks and open risks under each linked customer", async () => {
    const tam = await createUserWithRole("TAM");
    const a = await customerOf(tam.userId);
    const b = await customerOf(tam.userId);
    const project = await sharedProject(tam.userId, a.id, [b.id]);
    await prisma.task.create({
      data: { projectId: project.id, title: "late", statusId: SID.TODO, status: "TODO", dueDate: new Date("2026-09-01T00:00:00.000Z") },
    });
    await prisma.risk.create({
      data: { projectId: project.id, description: "r", category: "TECHNICAL", probability: 3, impact: 3, status: "OPEN" },
    });
    const res = await request(app).get("/customers").query({ today: "2026-09-30" }).set(auth(tam.token));
    for (const c of [a, b]) {
      const row = res.body.find((x: { id: number }) => x.id === c.id);
      expect(row.health.overdueCount).toBe(1);
      expect(row.health.openRiskCount).toBe(1);
      expect(row._count.projects).toBe(1);
    }
  });

  it("portfolio rows list a shared project once, with the primary customer", async () => {
    const admin = await createAdminAndToken();
    const a = await customerOf(admin.userId);
    const b = await customerOf(admin.userId);
    const project = await sharedProject(admin.userId, a.id, [b.id]);
    for (const path of ["/overview", "/reports/executive"]) {
      const res = await request(app).get(path).set(auth(admin.token));
      const rows = (res.body.portfolio ?? res.body.projects) as { id: number; customerId: number; customerName: string }[];
      const mine = rows.filter((r) => r.id === project.id);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ customerId: a.id, customerName: a.name });
    }
  });

  it("the guest share payload shows the primary customer name only", async () => {
    const { tamA, a, b, project } = await world();
    const res = await request(app).post(`/projects/${project.id}/share-links`).set(auth(tamA.token)).send({});
    expect(res.status).toBe(201);
    const token = (res.body.url as string).replace("/share/", "");
    const pub = await request(app).get(`/public/share/${token}`);
    expect(pub.body.project.customerName).toBe(a.name);
    expect(JSON.stringify(pub.body)).not.toContain(b.name);
  });
});

describe("link changes", () => {
  it("a member cannot change the links (403 owner_only), the owner can; a hidden customer is a 400", async () => {
    const { tamA, member, a, b, stranger, project } = await world();
    const hidden = await customerOf(stranger.userId);
    const body = { customers: [{ id: a.id, isPrimary: true }] };
    const asMember = await request(app).patch(`/projects/${project.id}`).set(auth(member.token)).send(body);
    expect(asMember.status).toBe(403);
    expect(asMember.body.code).toBe("owner_only");
    // re-sending the current set is not a change
    const same = await request(app)
      .patch(`/projects/${project.id}`)
      .set(auth(member.token))
      .send({ customers: [{ id: a.id, isPrimary: true }, { id: b.id, isPrimary: false }] });
    expect(same.status).toBe(200);

    const bad = await request(app)
      .patch(`/projects/${project.id}`)
      .set(auth(tamA.token))
      .send({ customers: [{ id: a.id, isPrimary: true }, { id: hidden.id, isPrimary: false }] });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("customer_not_found");

    const ok = await request(app).patch(`/projects/${project.id}`).set(auth(tamA.token)).send(body);
    expect(ok.status).toBe(200);
    expect(ok.body.customers.map((c: { id: number }) => c.id)).toEqual([a.id]);
  });

  it("moves the primary, logs the sorted name set, and accepts the legacy customerId", async () => {
    const tam = await createUserWithRole("TAM");
    const a = await customerOf(tam.userId, uniq("Zed"));
    const b = await customerOf(tam.userId, uniq("Alpha"));
    const created = await request(app)
      .post("/projects")
      .set(auth(tam.token))
      .send({ name: uniq("P"), customers: [{ id: a.id, isPrimary: true }, { id: b.id, isPrimary: false }] });
    expect(created.status).toBe(201);
    expect(created.body.customers).toHaveLength(2);
    const id = created.body.id as number;

    const moved = await request(app)
      .patch(`/projects/${id}`)
      .set(auth(tam.token))
      .send({ customers: [{ id: a.id, isPrimary: false }, { id: b.id, isPrimary: true }] });
    expect(moved.body.primaryCustomer.id).toBe(b.id);

    const shape = (r: { body: { customers: { id: number; isPrimary: boolean }[] } }) =>
      r.body.customers.map((c) => [c.id, c.isPrimary]);
    // Legacy re-save with the CURRENT primary (what the current form sends on
    // every save) plus a rename: nothing is unlinked.
    const resave = await request(app).patch(`/projects/${id}`).set(auth(tam.token)).send({ name: uniq("Renamed"), customerId: b.id });
    expect(resave.status).toBe(200);
    expect(shape(resave)).toEqual([[b.id, true], [a.id, false]]);
    // Legacy customerId of another linked customer moves the primary, keeps the rest.
    const move = await request(app).patch(`/projects/${id}`).set(auth(tam.token)).send({ customerId: a.id });
    expect(shape(move)).toEqual([[a.id, true], [b.id, false]]);
    // Legacy customerId of a NEW customer is added as primary, the old one demoted.
    const c = await customerOf(tam.userId, uniq("Mid"));
    const add = await request(app).patch(`/projects/${id}`).set(auth(tam.token)).send({ customerId: c.id });
    expect(shape(add)).toEqual([[c.id, true], [a.id, false], [b.id, false]]);

    const events = await prisma.activityEvent.findMany({ where: { projectId: id, action: "updated" }, orderBy: { id: "asc" } });
    expect(events.at(-1)!.changes).toEqual({
      customers: { from: [a.name, b.name].sort(), to: [a.name, b.name, c.name].sort() },
    });

    const viaLegacy = await request(app).post("/projects").set(auth(tam.token)).send({ name: uniq("L"), customerId: a.id });
    expect(viaLegacy.status).toBe(201);
    expect(viaLegacy.body.customerId).toBe(a.id);
  });

  it("a member's legacy re-save with the current primary is not a link change; moving the primary is owner-only", async () => {
    const { member, a, b, project } = await world();
    const same = await request(app).patch(`/projects/${project.id}`).set(auth(member.token)).send({ name: "x", customerId: a.id });
    expect(same.status).toBe(200);
    expect(same.body.customers).toHaveLength(2);
    const move = await request(app).patch(`/projects/${project.id}`).set(auth(member.token)).send({ customerId: b.id });
    expect(move.status).toBe(403);
    expect(move.body.code).toBe("owner_only");
  });

  it("rejects zero, duplicate or double-primary link sets and a create with no customer", async () => {
    const tam = await createUserWithRole("TAM");
    const a = await customerOf(tam.userId);
    const b = await customerOf(tam.userId);
    const post = (body: object) => request(app).post("/projects").set(auth(tam.token)).send({ name: "x", ...body });
    expect((await post({})).status).toBe(400);
    expect((await post({ customers: [] })).status).toBe(400);
    expect((await post({ customers: [{ id: a.id, isPrimary: false }] })).status).toBe(400);
    expect((await post({ customers: [{ id: a.id, isPrimary: true }, { id: b.id, isPrimary: true }] })).status).toBe(400);
    expect((await post({ customers: [{ id: a.id, isPrimary: true }, { id: a.id, isPrimary: false }] })).status).toBe(400);
  });

  it("deleting a shared project writes one customer activity event per linked customer", async () => {
    const { tamA, a, b, project } = await world();
    expect((await request(app).delete(`/projects/${project.id}`).set(auth(tamA.token))).status).toBe(204);
    const events = await prisma.customerActivityEvent.findMany({ where: { projectId: project.id } });
    expect(events.map((e) => e.customerId).sort()).toEqual([a.id, b.id].sort());
  });
});

describe("ownership through any linked customer", () => {
  it("a secondary customer's owner can change the TAM, change links (the remaining link becomes primary) and mint guest links", async () => {
    const { tamB, a, b, project } = await world();
    const newTam = await createUserWithRole("TAM");
    const tam = await request(app).patch(`/projects/${project.id}`).set(auth(tamB.token)).send({ tamId: newTam.userId });
    expect(tam.status).toBe(200);
    const drop = await request(app)
      .patch(`/projects/${project.id}`)
      .set(auth(tamB.token))
      .send({ customers: [{ id: b.id, isPrimary: true }] });
    expect(drop.status).toBe(200);
    expect(drop.body.customers.map((c: { id: number; isPrimary: boolean }) => [c.id, c.isPrimary])).toEqual([[b.id, true]]);
    expect(a.id).not.toBe(b.id);
    const link = await request(app).post(`/projects/${project.id}/share-links`).set(auth(tamB.token)).send({});
    expect(link.status).toBe(201);
  });

  it("a secondary customer's owner can delete the project", async () => {
    const { tamB, project } = await world();
    expect((await request(app).delete(`/projects/${project.id}`).set(auth(tamB.token))).status).toBe(204);
  });
});

describe("customer delete", () => {
  it("promotes the oldest remaining link to primary, and unlinks a project left with none", async () => {
    const admin = await createAdminAndToken();
    const a = await customerOf(admin.userId);
    const older = await customerOf(admin.userId);
    const newer = await customerOf(admin.userId);
    const project = await sharedProject(admin.userId, a.id, [older.id, newer.id]);
    const solo = await sharedProject(admin.userId, (await customerOf(admin.userId)).id);
    const soloCustomerId = (await prisma.projectCustomer.findFirstOrThrow({ where: { projectId: solo.id } })).customerId;

    expect((await request(app).delete(`/customers/${a.id}`).set(auth(admin.token))).status).toBe(204);
    const links = await prisma.projectCustomer.findMany({ where: { projectId: project.id }, orderBy: { addedAt: "asc" } });
    expect(links.map((l) => [l.customerId, l.isPrimary])).toEqual([[older.id, true], [newer.id, false]]);

    expect((await request(app).delete(`/customers/${soloCustomerId}`).set(auth(admin.token))).status).toBe(204);
    expect(await prisma.projectCustomer.count({ where: { projectId: solo.id } })).toBe(0);
    expect(await prisma.project.findUnique({ where: { id: solo.id } })).not.toBeNull();
  });

  it("deleting a secondary customer leaves the primary alone", async () => {
    const admin = await createAdminAndToken();
    const a = await customerOf(admin.userId);
    const b = await customerOf(admin.userId);
    const project = await sharedProject(admin.userId, a.id, [b.id]);
    expect((await request(app).delete(`/customers/${b.id}`).set(auth(admin.token))).status).toBe(204);
    const links = await prisma.projectCustomer.findMany({ where: { projectId: project.id } });
    expect(links.map((l) => [l.customerId, l.isPrimary])).toEqual([[a.id, true]]);
  });
});

describe("claiming an unowned customer", () => {
  it("needs the TAM of every project under it, across shared projects too", async () => {
    const tam = await createUserWithRole("TAM");
    const other = await createUserWithRole("TAM");
    const unowned = await customerOf(null);
    const mine = await customerOf(tam.userId);
    await sharedProject(other.userId, mine.id, [unowned.id]); // someone else's project is under `unowned`
    const res = await request(app).patch(`/customers/${unowned.id}`).set(auth(tam.token)).send({ tamId: tam.userId });
    expect(res.status).toBe(403);
  });
});
