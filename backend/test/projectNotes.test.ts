import "./env.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { seedRoles, createAdminAndToken, createUserWithRole } from "./testAuth.js";

// Daily Review v2 §5.2 — GET/POST/PATCH/DELETE /projects/:id/notes.
// Covers: noteDate default + explicit day, the from/to window, PATCH
// author-only, DELETE author-or-wildcard, and the 404-for-hidden-project
// guard shared by every route in this file (ensureProjectVisible).

const app = createApp();

let adminToken: string;
let adminId: number;

beforeAll(async () => {
  await seedRoles();
});

beforeEach(async () => {
  const admin = await createAdminAndToken();
  adminToken = admin.token;
  adminId = admin.userId;
});

afterEach(() => {
  vi.useRealTimers();
});

async function createCustomer(token: string): Promise<number> {
  const res = await request(app)
    .post("/customers")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: `Customer ${Date.now()}-${Math.random()}`, description: "d" });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

async function createProject(
  token: string,
  customerId: number,
  extra: Record<string, unknown> = {},
): Promise<number> {
  const res = await request(app)
    .post("/projects")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: `Project ${Date.now()}-${Math.random()}`, customerId, ...extra });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

describe("GET/POST /projects/:id/notes", () => {
  let customerId: number;
  let projectId: number;

  beforeEach(async () => {
    customerId = await createCustomer(adminToken);
    projectId = await createProject(adminToken, customerId);
  });

  it("defaults noteDate to today's UTC day when omitted", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-15T18:45:00.000Z"));

    const res = await request(app)
      .post(`/projects/${projectId}/notes`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ body: "no date given" });

    expect(res.status).toBe(201);
    expect(res.body.noteDate).toBe("2026-08-15T00:00:00.000Z");
  });

  it("accepts an explicit noteDate day string", async () => {
    const res = await request(app)
      .post(`/projects/${projectId}/notes`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ body: "backfilled note", noteDate: "2026-08-10" });

    expect(res.status).toBe(201);
    expect(res.body.noteDate).toBe("2026-08-10T00:00:00.000Z");
  });

  it("rejects an invalid noteDate with 400", async () => {
    const res = await request(app)
      .post(`/projects/${projectId}/notes`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ body: "bad date", noteDate: "2026-02-30" });

    expect(res.status).toBe(400);
  });

  it("defaults visibility to INTERNAL when the body omits it", async () => {
    const res = await request(app)
      .post(`/projects/${projectId}/notes`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ body: "internal by default" });

    expect(res.status).toBe(201);
    expect(res.body.visibility).toBe("INTERNAL");
  });

  it("from/to window returns only notes inside it, inclusive at both ends, ordered noteDate desc", async () => {
    const days = ["2026-08-01", "2026-08-05", "2026-08-10", "2026-08-15"];
    for (const noteDate of days) {
      const res = await request(app)
        .post(`/projects/${projectId}/notes`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ body: `note for ${noteDate}`, noteDate });
      expect(res.status).toBe(201);
    }

    const res = await request(app)
      .get(`/projects/${projectId}/notes`)
      .query({ from: "2026-08-05", to: "2026-08-10" })
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const returnedDates = res.body.map((n: { noteDate: string }) => n.noteDate);
    expect(returnedDates).toEqual([
      "2026-08-10T00:00:00.000Z",
      "2026-08-05T00:00:00.000Z",
    ]);
  });

  it("a from/to window is not truncated by the default 50 cap; without a window the default 50 still applies", async () => {
    for (let i = 0; i < 60; i++) {
      const day = i + 1; // 2026-06-01 .. 2026-06-60 overflow is fine — Date rolls into July
      const noteDate = new Date(Date.UTC(2026, 5, day)).toISOString().slice(0, 10);
      const res = await request(app)
        .post(`/projects/${projectId}/notes`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ body: `note ${i}`, noteDate });
      expect(res.status).toBe(201);
    }

    const windowed = await request(app)
      .get(`/projects/${projectId}/notes`)
      .query({ from: "2026-06-01", to: "2026-08-01" })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(windowed.status).toBe(200);
    expect(windowed.body).toHaveLength(60);

    const unwindowed = await request(app)
      .get(`/projects/${projectId}/notes`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(unwindowed.status).toBe(200);
    expect(unwindowed.body).toHaveLength(50);
  });
});

describe("PATCH /projects/:id/notes/:noteId", () => {
  let customerId: number;
  let projectId: number;
  let noteId: number;

  beforeEach(async () => {
    customerId = await createCustomer(adminToken);
    projectId = await createProject(adminToken, customerId);
    const noteRes = await request(app)
      .post(`/projects/${projectId}/notes`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ body: "original body" });
    expect(noteRes.status).toBe(201);
    noteId = noteRes.body.id as number;
  });

  it("lets the author edit their note: 200 with the new body and a bumped updatedAt", async () => {
    const originalUpdatedAt = (
      await request(app)
        .get(`/projects/${projectId}/notes`)
        .set("Authorization", `Bearer ${adminToken}`)
    ).body.find((n: { id: number }) => n.id === noteId).updatedAt;

    await new Promise((r) => setTimeout(r, 20));

    const res = await request(app)
      .patch(`/projects/${projectId}/notes/${noteId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ body: "edited body" });

    expect(res.status).toBe(200);
    expect(res.body.body).toBe("edited body");
    expect(new Date(res.body.updatedAt).getTime()).toBeGreaterThan(
      new Date(originalUpdatedAt).getTime(),
    );
  });

  it("403s not_note_author when a different admin edits it", async () => {
    const other = await createAdminAndToken();
    const res = await request(app)
      .patch(`/projects/${projectId}/notes/${noteId}`)
      .set("Authorization", `Bearer ${other.token}`)
      .send({ body: "hijacked" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("not_note_author");
  });

  it("404s a note from another project", async () => {
    const otherCustomerId = await createCustomer(adminToken);
    const otherProjectId = await createProject(adminToken, otherCustomerId);

    const res = await request(app)
      .patch(`/projects/${otherProjectId}/notes/${noteId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ body: "wrong project" });

    expect(res.status).toBe(404);
  });
});

describe("DELETE /projects/:id/notes/:noteId", () => {
  it("204s a non-author admin (wildcard) deleting a TAM's note", async () => {
    const customerId = await createCustomer(adminToken);
    const tam = await createUserWithRole("TAM");
    const projectId = await createProject(adminToken, customerId, { tamId: tam.userId });

    const noteRes = await request(app)
      .post(`/projects/${projectId}/notes`)
      .set("Authorization", `Bearer ${tam.token}`)
      .send({ body: "TAM's note" });
    expect(noteRes.status).toBe(201);

    const otherAdmin = await createAdminAndToken();
    const res = await request(app)
      .delete(`/projects/${projectId}/notes/${noteRes.body.id}`)
      .set("Authorization", `Bearer ${otherAdmin.token}`);

    expect(res.status).toBe(204);
  });

  it("403s a non-author TAM who can see the project but didn't write the note", async () => {
    const customerId = await createCustomer(adminToken);
    const tam = await createUserWithRole("TAM");
    const projectId = await createProject(adminToken, customerId, { tamId: tam.userId });

    const noteRes = await request(app)
      .post(`/projects/${projectId}/notes`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ body: "admin's note" });
    expect(noteRes.status).toBe(201);

    const res = await request(app)
      .delete(`/projects/${projectId}/notes/${noteRes.body.id}`)
      .set("Authorization", `Bearer ${tam.token}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("not_note_author");
  });
});

describe("hidden project → 404 for every notes route", () => {
  it("returns 404 for GET/POST/PATCH/DELETE when the caller has no visibility", async () => {
    const customerId = await createCustomer(adminToken);
    // Project stays owned by the admin (tamId defaults to the creator); a
    // plain TAM with neither tamId nor saId on this project has no
    // project:view-all, so ensureProjectVisible must 404 every route below.
    const projectId = await createProject(adminToken, customerId);
    const outsider = await createUserWithRole("TAM");

    const noteRes = await request(app)
      .post(`/projects/${projectId}/notes`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ body: "visible only to admin" });
    expect(noteRes.status).toBe(201);
    const noteId = noteRes.body.id as number;

    const getRes = await request(app)
      .get(`/projects/${projectId}/notes`)
      .set("Authorization", `Bearer ${outsider.token}`);
    expect(getRes.status).toBe(404);

    const postRes = await request(app)
      .post(`/projects/${projectId}/notes`)
      .set("Authorization", `Bearer ${outsider.token}`)
      .send({ body: "should not land" });
    expect(postRes.status).toBe(404);

    const patchRes = await request(app)
      .patch(`/projects/${projectId}/notes/${noteId}`)
      .set("Authorization", `Bearer ${outsider.token}`)
      .send({ body: "should not land" });
    expect(patchRes.status).toBe(404);

    const deleteRes = await request(app)
      .delete(`/projects/${projectId}/notes/${noteId}`)
      .set("Authorization", `Bearer ${outsider.token}`);
    expect(deleteRes.status).toBe(404);
  });
});
