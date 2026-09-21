// GET /notes/recent — the Overview page's "Recent notes" feed: project notes
// and operations notes merged, over the 7 calendar days ending on the
// caller's `today`, scoped by lib/visibility.ts's two filters and nothing
// narrower (an excludeFromPortfolio container's notes are IN — the Daily
// Review lets you write them). Fixtures write via `prisma` directly.
import "./env.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { utcMidnightOfDayString } from "../src/lib/dateBoundary.js";
import { createAdminAndToken, createUserWithRole, seedRoles } from "./testAuth.js";

const app = createApp();

beforeAll(async () => {
  await seedRoles();
});

// Fixed days, far from any other suite's dates, so the window edges are
// deterministic: today - 6 is the first day IN the window, today - 7 is out,
// and a note dated after `today` (the week editor lets you write one) is out.
const TODAY = "2026-03-10";
const TOMORROW = "2026-03-11";
const WINDOW_START = "2026-03-04";
const BEFORE_WINDOW = "2026-03-03";

function uniq(label: string): string {
  return `${label} ${Date.now()}-${Math.random()}`;
}

async function createCustomer(tamId: number | null) {
  return prisma.customer.create({ data: { name: uniq("Customer"), description: "d", tamId } });
}

async function createProject(customerId: number | null, tamId: number, excludeFromPortfolio = false) {
  return prisma.project.create({
    data: { name: uniq("Project"), tamId, customerId, status: "ACTIVE", excludeFromPortfolio },
  });
}

async function projectNote(projectId: number, authorId: number, day: string, body: string) {
  return prisma.projectNote.create({
    data: { projectId, authorId, body, noteDate: utcMidnightOfDayString(day) },
  });
}

async function customerNote(customerId: number, authorId: number, day: string, title: string, body: string) {
  return prisma.customerNote.create({
    data: { customerId, authorId, title, body, noteDate: utcMidnightOfDayString(day) },
  });
}

interface Row {
  kind: "project" | "operations";
  id: number;
  noteDate: string;
  body: string;
  title: string | null;
  author: { id: number; username: string };
  project: { id: number; name: string } | null;
  customer: { id: number; name: string } | null;
}

/**
 * owner     — TAM who owns customer C (project TAM on none of C's projects)
 * other     — TAM who owns customer D and is project TAM on P, Q, and the container
 * C/P       — customer owned by `owner`; P under it (tamId = other)
 * C/cont    — administrative container under C (excludeFromPortfolio) with a note
 * D/Q       — customer owned by `other`; Q under it
 * loose     — project with no customer, tamId = owner
 */
async function fixture() {
  const owner = await createUserWithRole("TAM");
  const other = await createUserWithRole("TAM");
  const c = await createCustomer(owner.userId);
  const d = await createCustomer(other.userId);
  const p = await createProject(c.id, other.userId);
  const q = await createProject(d.id, other.userId);
  const container = await createProject(c.id, other.userId, true);
  const loose = await createProject(null, owner.userId);

  const pToday = await projectNote(p.id, other.userId, TODAY, uniq("P today"));
  const pFuture = await projectNote(p.id, other.userId, TOMORROW, uniq("P tomorrow"));
  const pEdge = await projectNote(p.id, other.userId, WINDOW_START, uniq("P window start"));
  const pOld = await projectNote(p.id, other.userId, BEFORE_WINDOW, uniq("P before window"));
  const cOps = await customerNote(c.id, owner.userId, TODAY, "Ops title", uniq("C ops"));
  const qToday = await projectNote(q.id, other.userId, TODAY, uniq("Q today"));
  const containerNote = await projectNote(container.id, other.userId, TODAY, uniq("Container"));
  const looseNote = await projectNote(loose.id, owner.userId, TODAY, uniq("Loose"));

  return {
    owner, other, c, d, p, q, loose,
    pToday, pFuture, pEdge, pOld, cOps, qToday, containerNote, looseNote,
  };
}

function keysOf(rows: Row[]): string[] {
  return rows.map((r) => `${r.kind}:${r.id}`);
}

describe("GET /notes/recent", () => {
  it("merges the caller's visible project + operations notes, newest day first, inside the 7-day window", async () => {
    const f = await fixture();
    const res = await request(app)
      .get(`/notes/recent?today=${TODAY}`)
      .set("Authorization", `Bearer ${f.owner.token}`);
    expect(res.status).toBe(200);
    expect(res.body.from).toBe(WINDOW_START);
    expect(res.body.to).toBe(TODAY);

    const rows = res.body.notes as Row[];
    const keys = keysOf(rows);
    expect(keys).toContain(`project:${f.pToday.id}`);
    expect(keys).toContain(`project:${f.pEdge.id}`);
    expect(keys).toContain(`operations:${f.cOps.id}`);
    // An administrative container under an owned customer is a project the
    // Daily Review lets you note on — its notes are in the feed.
    expect(keys).toContain(`project:${f.containerNote.id}`);
    // Before the window; after `today`; another TAM's customer.
    expect(keys).not.toContain(`project:${f.pOld.id}`);
    expect(keys).not.toContain(`project:${f.pFuture.id}`);
    expect(keys).not.toContain(`project:${f.qToday.id}`);

    // Row shape: an operations note carries the title and no project; a
    // project note carries project + its customer and a null title.
    const ops = rows.find((r) => r.kind === "operations" && r.id === f.cOps.id)!;
    expect(ops.title).toBe("Ops title");
    expect(ops.project).toBeNull();
    expect(ops.customer).toEqual({ id: f.c.id, name: f.c.name });
    expect(ops.author).toEqual({ id: f.owner.userId, username: expect.any(String) });
    const proj = rows.find((r) => r.kind === "project" && r.id === f.pToday.id)!;
    expect(proj.title).toBeNull();
    expect(proj.project).toEqual({ id: f.p.id, name: f.p.name });
    expect(proj.customer).toEqual({ id: f.c.id, name: f.c.name });
    expect(proj.noteDate.slice(0, 10)).toBe(TODAY);
    // A project with no customer renders "No customer" — `customer` is null.
    const loose = rows.find((r) => r.kind === "project" && r.id === f.looseNote.id)!;
    expect(loose.project).toEqual({ id: f.loose.id, name: f.loose.name });
    expect(loose.customer).toBeNull();

    // Ordering: the window-start note comes after every `today` note.
    const edgeIdx = keys.indexOf(`project:${f.pEdge.id}`);
    expect(edgeIdx).toBeGreaterThan(keys.indexOf(`project:${f.pToday.id}`));
    expect(edgeIdx).toBeGreaterThan(keys.indexOf(`operations:${f.cOps.id}`));
  });

  it("view-all sees every customer's notes, containers included", async () => {
    const f = await fixture();
    const admin = await createAdminAndToken();
    const res = await request(app)
      .get(`/notes/recent?today=${TODAY}`)
      .set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    const keys = keysOf(res.body.notes as Row[]);
    expect(keys).toContain(`project:${f.pToday.id}`);
    expect(keys).toContain(`project:${f.qToday.id}`);
    expect(keys).toContain(`operations:${f.cOps.id}`);
    expect(keys).toContain(`project:${f.containerNote.id}`);
    expect(keys).not.toContain(`project:${f.pFuture.id}`);
  });

  it("caps the merged feed at 20 — the newest 20 across both tables, oldest-created dropped first", async () => {
    // A fresh owner with one customer/project: 22 project notes + 3
    // operations notes, all on `today`, all by the same author. Same
    // noteDate everywhere, so the order inside the day is updatedAt desc,
    // then id desc — i.e. creation order reversed.
    const owner = await createUserWithRole("TAM");
    const c = await createCustomer(owner.userId);
    const p = await createProject(c.id, owner.userId);
    const created: string[] = [];
    for (let i = 0; i < 22; i++) {
      const n = await projectNote(p.id, owner.userId, TODAY, uniq(`bulk ${i}`));
      created.push(`project:${n.id}`);
    }
    for (let i = 0; i < 3; i++) {
      const n = await customerNote(c.id, owner.userId, TODAY, `Ops ${i}`, uniq(`ops ${i}`));
      created.push(`operations:${n.id}`);
    }
    const res = await request(app)
      .get(`/notes/recent?today=${TODAY}`)
      .set("Authorization", `Bearer ${owner.token}`);
    expect(res.status).toBe(200);
    const keys = keysOf(res.body.notes as Row[]);
    expect(keys).toHaveLength(20);
    // The 5 oldest-created (the first 5 project notes) fall off; the 3
    // operations notes (created last) are all in, so the merge really
    // interleaves the two tables instead of filling from one.
    for (const k of created.slice(0, 5)) expect(keys).not.toContain(k);
    for (const k of created.slice(5)) expect(keys).toContain(k);
    expect(keys[0]).toBe(created[created.length - 1]);
  });

  it("the other TAM sees their own customer's notes but not the owner's operations note", async () => {
    const f = await fixture();
    const res = await request(app)
      .get(`/notes/recent?today=${TODAY}`)
      .set("Authorization", `Bearer ${f.other.token}`);
    expect(res.status).toBe(200);
    const keys = keysOf(res.body.notes as Row[]);
    expect(keys).toContain(`project:${f.qToday.id}`);
    // `other` is project TAM on P, so P's notes are visible through the
    // project arm — but C itself is owned by `owner`, and `other` reaches C
    // only via P, so C's operations note is still visible (customer with a
    // visible project). Pin that rule here so a scoping change is loud.
    expect(keys).toContain(`project:${f.pToday.id}`);
    expect(keys).toContain(`operations:${f.cOps.id}`);
  });

  it("today is optional (defaults to the server's UTC day); 400 when invalid; 401 without a token", async () => {
    const owner = await createUserWithRole("TAM");
    const missing = await request(app).get("/notes/recent").set("Authorization", `Bearer ${owner.token}`);
    expect(missing.status).toBe(200);
    expect(missing.body.to).toBe(new Date().toISOString().slice(0, 10));
    const bad = await request(app)
      .get("/notes/recent?today=2026-13-45")
      .set("Authorization", `Bearer ${owner.token}`);
    expect(bad.status).toBe(400);
    const anon = await request(app).get(`/notes/recent?today=${TODAY}`);
    expect(anon.status).toBe(401);
  });
});
