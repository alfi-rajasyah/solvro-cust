// Cross-project label filter: GET /labels and GET /tasks?labelName=.
import "./env.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { createUserWithRole, seedRoles } from "./testAuth.js";
import { SID } from "./statusFixtures.js";

const app = createApp();
const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

beforeAll(async () => {
  await seedRoles();
  await prisma.role.upsert({
    where: { roleName: "TEST_NO_PROJECT_READ" },
    update: { permissions: ["task:read"] },
    create: { roleName: "TEST_NO_PROJECT_READ", permissions: ["task:read"] },
  });
});

async function project(tamId: number, memberIds: number[] = []) {
  return prisma.project.create({
    data: {
      name: `LN ${uniq()}`,
      tamId,
      status: "ACTIVE",
      members: { create: memberIds.map((userId) => ({ userId })) },
    },
  });
}

async function labelled(projectId: number, labelName: string, title = "t") {
  const label = await prisma.label.create({ data: { projectId, name: labelName } });
  const task = await prisma.task.create({
    data: { projectId, title, statusId: SID.TODO, labels: { connect: { id: label.id } } },
  });
  return { label, task };
}

const get = (token: string, url: string) =>
  request(app).get(url).set("Authorization", `Bearer ${token}`);

describe("GET /labels", () => {
  it("requires project:read", async () => {
    const u = await createUserWithRole("TEST_NO_PROJECT_READ");
    expect((await get(u.token, "/labels")).status).toBe(403);
  });

  it("groups case-insensitively, picks the majority casing, never lists hidden projects", async () => {
    const tag = uniq();
    const me = await createUserWithRole("TAM");
    const other = await createUserWithRole("TAM");
    const p1 = await project(me.userId);
    const p2 = await project(me.userId);
    const p3 = await project(me.userId);
    const hidden = await project(other.userId);
    await labelled(p1.id, `Blocked-${tag}`);
    await labelled(p2.id, `blocked-${tag}`);
    await labelled(p3.id, `blocked-${tag}`);
    await labelled(hidden.id, `blocked-${tag}`);
    await labelled(hidden.id, `hiddenonly-${tag}`);
    // tie: one project each, alphabetical first ("Tie" < "tie")
    await labelled(p1.id, `Tie-${tag}`);
    await labelled(p2.id, `tie-${tag}`);

    const res = await get(me.token, "/labels");
    expect(res.status).toBe(200);
    const mine = (res.body as Array<{ name: string; projectCount: number }>).filter((l) =>
      l.name.toLowerCase().endsWith(`-${tag}`),
    );
    expect(mine).toEqual([
      { name: `blocked-${tag}`, projectCount: 3 },
      { name: `Tie-${tag}`, projectCount: 2 },
    ]);
  });

  it("sorts by name case-insensitively", async () => {
    const tag = uniq();
    const me = await createUserWithRole("TAM");
    const p = await project(me.userId);
    await labelled(p.id, `b-${tag}`);
    await labelled(p.id, `A-${tag}`);
    await labelled(p.id, `c-${tag}`);
    const res = await get(me.token, "/labels");
    const names = (res.body as Array<{ name: string }>)
      .map((l) => l.name)
      .filter((n) => n.endsWith(`-${tag}`));
    expect(names).toEqual([`A-${tag}`, `b-${tag}`, `c-${tag}`]);
  });
});

describe("GET /tasks?labelName=", () => {
  it("matches case-insensitively across projects, any-of for repeated values", async () => {
    const tag = uniq();
    const me = await createUserWithRole("TAM");
    const p1 = await project(me.userId);
    const p2 = await project(me.userId);
    const a = await labelled(p1.id, `Bug-${tag}`);
    const b = await labelled(p2.id, `bug-${tag}`);
    const c = await labelled(p2.id, `feat-${tag}`);
    await labelled(p1.id, `other-${tag}`);

    const one = await get(me.token, `/tasks?labelName=BUG-${tag}`);
    expect(one.status).toBe(200);
    expect(one.body.map((t: { id: number }) => t.id).sort()).toEqual([a.task.id, b.task.id].sort());

    const two = await get(me.token, `/tasks?labelName=bug-${tag}&labelName=feat-${tag}`);
    expect(two.body.map((t: { id: number }) => t.id).sort()).toEqual(
      [a.task.id, b.task.id, c.task.id].sort(),
    );
  });

  it("treats _ and % literally", async () => {
    const tag = uniq();
    const me = await createUserWithRole("TAM");
    const p = await project(me.userId);
    const lit = await labelled(p.id, `a_b-${tag}`);
    await labelled(p.id, `axb-${tag}`);
    const pct = await labelled(p.id, `50%-${tag}`);
    await labelled(p.id, `500-${tag}`);

    const u = await get(me.token, `/tasks?labelName=${encodeURIComponent(`a_b-${tag}`)}`);
    expect(u.body.map((t: { id: number }) => t.id)).toEqual([lit.task.id]);
    const w = await get(me.token, `/tasks?labelName=${encodeURIComponent(`%-${tag}`)}`);
    expect(w.body).toEqual([]);
    const l = await get(me.token, `/tasks?labelName=${encodeURIComponent(`50%-${tag}`)}`);
    expect(l.body.map((t: { id: number }) => t.id)).toEqual([pct.task.id]);
  });

  it("answers 400 above 20 values and accepts exactly 20", async () => {
    const me = await createUserWithRole("TAM");
    const q = (n: number) =>
      Array.from({ length: n }, (_, i) => `labelName=n${i}`).join("&");
    expect((await get(me.token, `/tasks?${q(21)}`)).status).toBe(400);
    expect((await get(me.token, `/tasks?${q(20)}`)).status).toBe(200);
    expect((await get(me.token, "/tasks?labelName=")).status).toBe(400);
  });

  it("intersects with another filter and with labelId", async () => {
    const tag = uniq();
    const me = await createUserWithRole("TAM");
    const p = await project(me.userId);
    const label = await prisma.label.create({ data: { projectId: p.id, name: `x-${tag}` } });
    const hi = await prisma.task.create({
      data: { projectId: p.id, title: "hi", statusId: SID.TODO, priority: "HIGH", labels: { connect: { id: label.id } } },
    });
    await prisma.task.create({
      data: { projectId: p.id, title: "lo", statusId: SID.TODO, priority: "LOW", labels: { connect: { id: label.id } } },
    });
    const res = await get(me.token, `/tasks?labelName=x-${tag}&priority=HIGH`);
    expect(res.body.map((t: { id: number }) => t.id)).toEqual([hi.id]);
    const both = await get(me.token, `/tasks?labelName=x-${tag}&labelId=${label.id}&priority=HIGH`);
    expect(both.body.map((t: { id: number }) => t.id)).toEqual([hi.id]);
  });

  it("returns nothing, not everything, when no label matches", async () => {
    const me = await createUserWithRole("TAM");
    const p = await project(me.userId);
    await prisma.task.create({ data: { projectId: p.id, title: "plain", statusId: SID.TODO } });
    const res = await get(me.token, `/tasks?labelName=nope-${uniq()}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(res.headers["x-total-count"]).toBe("0");
  });

  it("never returns a hidden project's task to a member of another project", async () => {
    const tag = uniq();
    const owner = await createUserWithRole("TAM");
    const member = await createUserWithRole("TAM");
    const visibleP = await project(owner.userId, [member.userId]);
    const hiddenP = await project(owner.userId);
    const v = await labelled(visibleP.id, `Shared-${tag}`);
    await labelled(hiddenP.id, `shared-${tag}`);

    const res = await get(member.token, `/tasks?labelName=shared-${tag}`);
    expect(res.body.map((t: { id: number }) => t.id)).toEqual([v.task.id]);
    const only = await get(member.token, `/labels`);
    const entry = (only.body as Array<{ name: string; projectCount: number }>).find(
      (l) => l.name.toLowerCase() === `shared-${tag}`,
    );
    expect(entry?.projectCount).toBe(1);
  });
});
