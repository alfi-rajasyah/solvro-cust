import "./env.js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { seedRoles, createAdminAndToken, createUserWithRole } from "./testAuth.js";

const app = createApp();

let token: string;
let projectId: number;

// `ownerUserId` must be the same user whose token the caller authenticates
// with (see beforeEach below) — otherwise every "visible project" test would
// pass only because ADMIN's wildcard permission bypasses tam/sa scoping, not
// because the caller is actually the project's tam/sa.
async function createProject(ownerUserId: number): Promise<number> {
  const project = await prisma.project.create({
    data: {
      name: `Project ${Date.now()}-${Math.random()}`,
      tamId: ownerUserId,
      status: "ACTIVE",
    },
  });
  return project.id;
}

interface SectionRow {
  id: number;
  projectId: number;
  name: string;
  color: string;
  position: number;
}

async function createSection(inProjectId: number, name: string): Promise<SectionRow> {
  const res = await request(app)
    .post(`/projects/${inProjectId}/sections`)
    .set("Authorization", `Bearer ${token}`)
    .send({ name });
  expect(res.status).toBe(201);
  return res.body as SectionRow;
}

async function patchSection(id: number, body: Record<string, unknown>) {
  return request(app).patch(`/sections/${id}`).set("Authorization", `Bearer ${token}`).send(body);
}

async function listSections(inProjectId: number): Promise<SectionRow[]> {
  const res = await request(app)
    .get(`/projects/${inProjectId}/sections`)
    .set("Authorization", `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body as SectionRow[];
}

beforeAll(async () => {
  await seedRoles();
});

beforeEach(async () => {
  const admin = await createAdminAndToken();
  token = admin.token;
  projectId = await createProject(admin.userId);
});

describe("PATCH /sections/:id ordering", () => {
  it("moves a section toward the front of the list (move up)", async () => {
    const a = await createSection(projectId, "A");
    const b = await createSection(projectId, "B");
    const c = await createSection(projectId, "C");

    const res = await patchSection(c.id, { position: 0 });
    expect(res.status).toBe(200);
    expect(res.body.position).toBe(0);

    const listed = await listSections(projectId);
    expect(listed.map((s) => s.id)).toEqual([c.id, a.id, b.id]);
    expect(listed.map((s) => s.position)).toEqual([0, 1, 2]);
  });

  it("moves a section toward the back of the list (move down)", async () => {
    const a = await createSection(projectId, "A");
    const b = await createSection(projectId, "B");
    const c = await createSection(projectId, "C");

    const res = await patchSection(a.id, { position: 2 });
    expect(res.status).toBe(200);
    expect(res.body.position).toBe(2);

    const listed = await listSections(projectId);
    expect(listed.map((s) => s.id)).toEqual([b.id, c.id, a.id]);
    expect(listed.map((s) => s.position)).toEqual([0, 1, 2]);
  });

  it("clamps a position beyond the end of the list", async () => {
    const a = await createSection(projectId, "A");
    const b = await createSection(projectId, "B");

    const res = await patchSection(a.id, { position: 999 });
    expect(res.status).toBe(200);
    expect(res.body.position).toBe(1);

    const listed = await listSections(projectId);
    expect(listed.map((s) => s.id)).toEqual([b.id, a.id]);
    expect(listed.map((s) => s.position)).toEqual([0, 1]);
  });

  // insertSectionAt's lower clamp (Math.max(0, …)) can only fire on a
  // negative requestedPosition, but updateSectionSchema's `position.min(0)`
  // rejects negatives before the handler ever runs — so the route's honest
  // contract is a 400 here, not a clamp to 0. Documented as a deliberate
  // choice: the internal Math.max(0, …) floor is defense-in-depth for a
  // caller that isn't reachable through this schema today, not dead-code.
  it("rejects a negative position with a 400 before any re-pack runs", async () => {
    const a = await createSection(projectId, "A");
    const b = await createSection(projectId, "B");

    const res = await patchSection(a.id, { position: -1 });
    expect(res.status).toBe(400);

    const listed = await listSections(projectId);
    expect(listed.map((s) => s.id)).toEqual([a.id, b.id]);
    expect(listed.map((s) => s.position)).toEqual([0, 1]);
  });

  it("a position-only patch leaves names and colors untouched", async () => {
    const a = await createSection(projectId, "Alpha");
    const b = await createSection(projectId, "Beta");

    const res = await patchSection(b.id, { position: 0 });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Beta");
    expect(res.body.color).toBe("#94a3b8"); // schema default, untouched

    const listed = await listSections(projectId);
    expect(listed.find((s) => s.id === a.id)?.name).toBe("Alpha");
    expect(listed.find((s) => s.id === b.id)?.name).toBe("Beta");
  });

  it("a name-only patch leaves order untouched", async () => {
    const a = await createSection(projectId, "A");
    const b = await createSection(projectId, "B");
    const c = await createSection(projectId, "C");

    const res = await patchSection(b.id, { name: "Renamed" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Renamed");
    expect(res.body.position).toBe(1); // unchanged: b was created second

    const listed = await listSections(projectId);
    expect(listed.map((s) => s.id)).toEqual([a.id, b.id, c.id]);
    expect(listed.map((s) => s.position)).toEqual([0, 1, 2]);
  });

  it("keeps positions dense 0..n-1 after a sequence of moves", async () => {
    const a = await createSection(projectId, "A");
    const b = await createSection(projectId, "B");
    const c = await createSection(projectId, "C");
    const d = await createSection(projectId, "D");

    await patchSection(d.id, { position: 0 }); // D A B C
    await patchSection(a.id, { position: 3 }); // D B C A
    await patchSection(c.id, { position: 1 }); // D C B A

    const listed = await listSections(projectId);
    expect(listed.map((s) => s.id)).toEqual([d.id, c.id, b.id, a.id]);
    expect(listed.map((s) => s.position)).toEqual([0, 1, 2, 3]);
  });

  it("applies a name/color change together with a position move in the same request", async () => {
    const a = await createSection(projectId, "A");
    const b = await createSection(projectId, "B");

    const res = await patchSection(a.id, {
      position: 1,
      name: "A-renamed",
      color: "#123456",
    });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("A-renamed");
    expect(res.body.color).toBe("#123456");
    expect(res.body.position).toBe(1);

    const listed = await listSections(projectId);
    expect(listed.map((s) => s.id)).toEqual([b.id, a.id]);
  });

  it("404s a position PATCH on a section in a project invisible to the caller", async () => {
    const otherTam = await createUserWithRole("TAM");
    const section = await createSection(projectId, "Hidden");

    const res = await request(app)
      .patch(`/sections/${section.id}`)
      .set("Authorization", `Bearer ${otherTam.token}`)
      .send({ position: 0 });
    expect(res.status).toBe(404);

    // Untouched: the rejected request must not have re-packed the list.
    const listed = await listSections(projectId);
    expect(listed.map((s) => s.id)).toEqual([section.id]);
    expect(listed[0].position).toBe(0);
  });
});
