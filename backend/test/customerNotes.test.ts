import "./env.js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { seedRoles, createAdminAndToken, createUserWithRole } from "./testAuth.js";

const app = createApp();

let token: string;
let userId: number;

beforeAll(async () => {
  await seedRoles();
});

beforeEach(async () => {
  const admin = await createAdminAndToken();
  token = admin.token;
  userId = admin.userId;
});

function todayUtcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

async function createCustomer(authToken = token, body: Record<string, unknown> = {}): Promise<number> {
  const res = await request(app)
    .post("/customers")
    .set("Authorization", `Bearer ${authToken}`)
    .send({ name: `Customer ${Date.now()}-${Math.random()}`, description: "d", ...body });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

describe("customer notes", () => {
  it("creates a note with a title and body: 201, noteDate = today's UTC day", async () => {
    const customerId = await createCustomer();
    const res = await request(app)
      .post(`/customers/${customerId}/notes`)
      .set("Authorization", `Bearer ${token}`)
      .send({ body: "Ops issue reported", title: "Oslo edge tunnel outage" });
    expect(res.status).toBe(201);
    expect(res.body.noteDate.slice(0, 10)).toBe(todayUtcDay());
    expect(res.body.title).toBe("Oslo edge tunnel outage");
    expect(res.body.author).toEqual({ id: userId, username: expect.any(String) });
  });

  it("400s when title is missing, empty, or over 120 chars", async () => {
    const customerId = await createCustomer();

    const missing = await request(app)
      .post(`/customers/${customerId}/notes`)
      .set("Authorization", `Bearer ${token}`)
      .send({ body: "No title" });
    expect(missing.status).toBe(400);

    const empty = await request(app)
      .post(`/customers/${customerId}/notes`)
      .set("Authorization", `Bearer ${token}`)
      .send({ body: "Empty title", title: "   " });
    expect(empty.status).toBe(400);

    const tooLong = await request(app)
      .post(`/customers/${customerId}/notes`)
      .set("Authorization", `Bearer ${token}`)
      .send({ body: "Long title", title: "a".repeat(121) });
    expect(tooLong.status).toBe(400);
  });

  it("trims the title", async () => {
    const customerId = await createCustomer();
    const res = await request(app)
      .post(`/customers/${customerId}/notes`)
      .set("Authorization", `Bearer ${token}`)
      .send({ body: "Trimmed title", title: "  Circuit flapping  " });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe("Circuit flapping");
  });

  it("windows notes by from/to inclusive and orders noteDate desc, id desc", async () => {
    const customerId = await createCustomer();

    const day1 = "2026-01-05";
    const day2 = "2026-01-06";
    const day3 = "2026-01-07";

    const n1 = await request(app)
      .post(`/customers/${customerId}/notes`)
      .set("Authorization", `Bearer ${token}`)
      .send({ body: "Day 1 note", title: "Day 1", noteDate: day1 });
    expect(n1.status).toBe(201);
    const n2 = await request(app)
      .post(`/customers/${customerId}/notes`)
      .set("Authorization", `Bearer ${token}`)
      .send({ body: "Day 2 note", title: "Day 2", noteDate: day2 });
    expect(n2.status).toBe(201);
    const n3 = await request(app)
      .post(`/customers/${customerId}/notes`)
      .set("Authorization", `Bearer ${token}`)
      .send({ body: "Day 3 note (outside window)", title: "Day 3", noteDate: day3 });
    expect(n3.status).toBe(201);

    const res = await request(app)
      .get(`/customers/${customerId}/notes`)
      .query({ from: day1, to: day2 })
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    // noteDate desc: day2 before day1.
    expect(res.body[0].id).toBe(n2.body.id);
    expect(res.body[1].id).toBe(n1.body.id);
  });

  it("PATCH by the author succeeds (body and title); PATCH by another admin is 403 not_note_author", async () => {
    const customerId = await createCustomer();
    const note = await request(app)
      .post(`/customers/${customerId}/notes`)
      .set("Authorization", `Bearer ${token}`)
      .send({ body: "Original body", title: "Original title" });
    expect(note.status).toBe(201);

    const selfPatch = await request(app)
      .patch(`/customers/${customerId}/notes/${note.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ body: "Edited by author", title: "Edited title" });
    expect(selfPatch.status).toBe(200);
    expect(selfPatch.body.body).toBe("Edited by author");
    expect(selfPatch.body.title).toBe("Edited title");

    const other = await createAdminAndToken();
    const otherPatch = await request(app)
      .patch(`/customers/${customerId}/notes/${note.body.id}`)
      .set("Authorization", `Bearer ${other.token}`)
      .send({ body: "Hijacked" });
    expect(otherPatch.status).toBe(403);
    expect(otherPatch.body.code).toBe("not_note_author");
  });

  it("DELETE by a non-author admin (wildcard) succeeds: 204", async () => {
    const customerId = await createCustomer();
    const note = await request(app)
      .post(`/customers/${customerId}/notes`)
      .set("Authorization", `Bearer ${token}`)
      .send({ body: "Deletable by wildcard", title: "Deletable" });
    expect(note.status).toBe(201);

    const other = await createAdminAndToken();
    const del = await request(app)
      .delete(`/customers/${customerId}/notes/${note.body.id}`)
      .set("Authorization", `Bearer ${other.token}`);
    expect(del.status).toBe(204);
  });

  it("404s note routes for an unknown customer", async () => {
    const res = await request(app)
      .get("/customers/999999/notes")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("customer_not_found");

    const postRes = await request(app)
      .post("/customers/999999/notes")
      .set("Authorization", `Bearer ${token}`)
      .send({ body: "orphan", title: "Orphan" });
    expect(postRes.status).toBe(404);
    expect(postRes.body.code).toBe("customer_not_found");
  });

  it("STAKEHOLDER gets 403 writing a note", async () => {
    const customerId = await createCustomer();
    const stakeholder = await createUserWithRole("STAKEHOLDER");
    const res = await request(app)
      .post(`/customers/${customerId}/notes`)
      .set("Authorization", `Bearer ${stakeholder.token}`)
      .send({ body: "Should be forbidden", title: "Forbidden" });
    expect(res.status).toBe(403);
  });
});

describe("Customer.tamId", () => {
  it("round-trips tamId through POST and GET (tam.username)", async () => {
    const tam = await createUserWithRole("TAM");
    const customerId = await createCustomer(token, { tamId: tam.userId });

    const res = await request(app)
      .get(`/customers/${customerId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.tam).toEqual({ id: tam.userId, username: expect.any(String) });
  });

  it("round-trips tamId through PATCH and GET, and clears it with null", async () => {
    const tam = await createUserWithRole("TAM");
    const customerId = await createCustomer();

    const patch = await request(app)
      .patch(`/customers/${customerId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ tamId: tam.userId });
    expect(patch.status).toBe(200);

    const res = await request(app)
      .get(`/customers/${customerId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.body.tam.id).toBe(tam.userId);

    const clear = await request(app)
      .patch(`/customers/${customerId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ tamId: null });
    expect(clear.status).toBe(200);
    expect(clear.body.tam).toBeNull();

    const res2 = await request(app)
      .get(`/customers/${customerId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res2.body.tam).toBeNull();
  });

  it("rejects an unknown tamId with 400 tam_not_found on create and patch", async () => {
    const createRes = await request(app)
      .post("/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: `Customer ${Date.now()}`, description: "d", tamId: 999999 });
    expect(createRes.status).toBe(400);
    expect(createRes.body.code).toBe("tam_not_found");

    const customerId = await createCustomer();
    const patchRes = await request(app)
      .patch(`/customers/${customerId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ tamId: 999999 });
    expect(patchRes.status).toBe(400);
    expect(patchRes.body.code).toBe("tam_not_found");
  });
});
