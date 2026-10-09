// Outline links, Phase A (docs/archive/plans/outline-integration.md): the admin
// base-URL setting, GET /outline/config, the shared URL rule on
// Customer/Project.outlineUrl, and the guarantee that the guest payload never
// carries a link. No Outline API is involved.
import "./env.js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { outlineUrlSchema } from "../src/lib/outlineUrl.js";
import { publicShareRateLimiter } from "../src/routes/publicShare.js";
import { createAdminAndToken, createUserWithRole, seedRoles } from "./testAuth.js";

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const uniq = (label: string) => `${label} ${Date.now()}-${Math.random()}`;

beforeAll(async () => {
  await seedRoles();
});

beforeEach(async () => {
  // The outline_config singleton is exclusively this feature's table.
  await prisma.outlineConfig.deleteMany();
  publicShareRateLimiter.reset();
});

describe("outlineUrlSchema", () => {
  it("trims, clears on empty/null, and accepts http(s) only", () => {
    expect(outlineUrlSchema.parse("  https://a.b/c ")).toBe("https://a.b/c");
    expect(outlineUrlSchema.parse("http://a.b")).toBe("http://a.b");
    expect(outlineUrlSchema.parse("")).toBeNull();
    expect(outlineUrlSchema.parse("   ")).toBeNull();
    expect(outlineUrlSchema.parse(null)).toBeNull();
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,x",
      "ftp://x",
      "not a url",
      "//a.b/c",
      "/relative",
      "\u0000https://a.b",
      "https://a.b/\u0001",
    ]) {
      expect(outlineUrlSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("caps the length at 2048", () => {
    const base = "https://a.b/";
    expect(outlineUrlSchema.safeParse(base + "x".repeat(2048 - base.length)).success).toBe(true);
    expect(outlineUrlSchema.safeParse(base + "x".repeat(2049 - base.length)).success).toBe(false);
  });
});

describe("admin settings /admin/settings/outline", () => {
  it("round-trips and clears the base URL", async () => {
    const admin = await createAdminAndToken();

    const initial = await request(app).get("/admin/settings/outline").set(auth(admin.token));
    expect(initial.status).toBe(200);
    expect(initial.body).toMatchObject({ baseUrl: null, updatedBy: null });
    expect(typeof initial.body.updatedAt).toBe("string");

    const saved = await request(app)
      .patch("/admin/settings/outline")
      .set(auth(admin.token))
      .send({ baseUrl: " https://docs.example.com/ " });
    expect(saved.status).toBe(200);
    expect(saved.body.baseUrl).toBe("https://docs.example.com");
    expect(saved.body.updatedBy).toEqual({ id: admin.userId, username: expect.any(String) });

    const read = await request(app).get("/admin/settings/outline").set(auth(admin.token));
    expect(read.body.baseUrl).toBe("https://docs.example.com");

    const cleared = await request(app)
      .patch("/admin/settings/outline")
      .set(auth(admin.token))
      .send({ baseUrl: "" });
    expect(cleared.status).toBe(200);
    expect(cleared.body.baseUrl).toBeNull();
  });

  it("rejects unsafe or malformed base URLs", async () => {
    const admin = await createAdminAndToken();
    for (const baseUrl of [
      "javascript:alert(1)",
      "ftp://x",
      "docs.example.com",
      5,
      "https://user:pw@docs.example.com",
      "https://docs.example.com/?a=b",
      "https://docs.example.com/#c",
    ]) {
      const res = await request(app)
        .patch("/admin/settings/outline")
        .set(auth(admin.token))
        .send({ baseUrl });
      expect(res.status, String(baseUrl)).toBe(400);
    }
    const missing = await request(app).patch("/admin/settings/outline").set(auth(admin.token)).send({});
    expect(missing.status).toBe(400);
  });

  it("is admin-only: a TAM gets 403 on GET and PATCH, no token gets 401", async () => {
    const tam = await createUserWithRole("TAM");
    const patch = await request(app)
      .patch("/admin/settings/outline")
      .set(auth(tam.token))
      .send({ baseUrl: "https://docs.example.com" });
    expect(patch.status).toBe(403);
    expect((await request(app).get("/admin/settings/outline").set(auth(tam.token))).status).toBe(403);
    expect((await request(app).get("/admin/settings/outline")).status).toBe(401);
    // The refused PATCH changed nothing.
    expect(await prisma.outlineConfig.findUnique({ where: { id: "default" } })).toBeNull();
  });
});

describe("GET /outline/config", () => {
  it("returns the base URL to any authenticated user, null when unset", async () => {
    const tam = await createUserWithRole("TAM");
    const pending = await createUserWithRole("PENDING");
    const admin = await createAdminAndToken();

    const unset = await request(app).get("/outline/config").set(auth(tam.token));
    expect(unset.status).toBe(200);
    expect(unset.body).toEqual({ baseUrl: null });

    await request(app)
      .patch("/admin/settings/outline")
      .set(auth(admin.token))
      .send({ baseUrl: "https://docs.example.com" })
      .expect(200);

    for (const user of [tam, pending]) {
      const res = await request(app).get("/outline/config").set(auth(user.token));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ baseUrl: "https://docs.example.com" });
    }
    expect((await request(app).get("/outline/config")).status).toBe(401);
  });
});

describe("Customer.outlineUrl", () => {
  it("saves, shows on list and detail, trims, and clears", async () => {
    const tam = await createUserWithRole("TAM");
    const created = await request(app)
      .post("/customers")
      .set(auth(tam.token))
      .send({ name: uniq("Cust"), description: "d", outlineUrl: " https://docs.example.com/c/1 " });
    expect(created.status).toBe(201);
    expect(created.body.outlineUrl).toBe("https://docs.example.com/c/1");
    const id = created.body.id as number;

    const detail = await request(app).get(`/customers/${id}`).set(auth(tam.token));
    expect(detail.body.outlineUrl).toBe("https://docs.example.com/c/1");
    const list = await request(app).get("/customers").set(auth(tam.token));
    expect((list.body as Array<{ id: number; outlineUrl: string | null }>).find((c) => c.id === id)?.outlineUrl).toBe(
      "https://docs.example.com/c/1",
    );

    const untouched = await request(app).patch(`/customers/${id}`).set(auth(tam.token)).send({ name: uniq("Renamed") });
    expect(untouched.body.outlineUrl).toBe("https://docs.example.com/c/1");

    // Trailing-slash stripping applies to the admin base URL only.
    const withSlash = await request(app)
      .patch(`/customers/${id}`)
      .set(auth(tam.token))
      .send({ outlineUrl: "https://docs.example.com/c/" });
    expect(withSlash.body.outlineUrl).toBe("https://docs.example.com/c/");

    const cleared = await request(app).patch(`/customers/${id}`).set(auth(tam.token)).send({ outlineUrl: "" });
    expect(cleared.status).toBe(200);
    expect(cleared.body.outlineUrl).toBeNull();
  });

  it("applies the URL rule on create and update", async () => {
    const tam = await createUserWithRole("TAM");
    const customer = await prisma.customer.create({
      data: { name: uniq("Cust"), description: "d", tamId: tam.userId },
    });
    const tooLong = "https://a.b/" + "x".repeat(2049 - "https://a.b/".length);
    for (const outlineUrl of ["javascript:alert(1)", "ftp://x", tooLong]) {
      const patch = await request(app)
        .patch(`/customers/${customer.id}`)
        .set(auth(tam.token))
        .send({ outlineUrl });
      expect(patch.status, outlineUrl.slice(0, 30)).toBe(400);
      const post = await request(app)
        .post("/customers")
        .set(auth(tam.token))
        .send({ name: uniq("Cust"), description: "d", outlineUrl });
      expect(post.status, outlineUrl.slice(0, 30)).toBe(400);
    }
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).outlineUrl).toBeNull();
  });

  it("keeps the permission and visibility checks: PENDING gets 403, a stranger gets 404", async () => {
    const tam = await createUserWithRole("TAM");
    const stranger = await createUserWithRole("TAM");
    const pending = await createUserWithRole("PENDING");
    const customer = await prisma.customer.create({
      data: { name: uniq("Cust"), description: "d", tamId: tam.userId },
    });
    const body = { outlineUrl: "https://docs.example.com/c" };
    expect((await request(app).patch(`/customers/${customer.id}`).set(auth(pending.token)).send(body)).status).toBe(403);
    expect((await request(app).patch(`/customers/${customer.id}`).set(auth(stranger.token)).send(body)).status).toBe(404);
  });
});

describe("Project.outlineUrl", () => {
  async function projectFixture() {
    const tam = await createUserWithRole("TAM");
    const member = await createUserWithRole("TAM");
    const stranger = await createUserWithRole("TAM");
    const pending = await createUserWithRole("PENDING");
    const customer = await prisma.customer.create({
      data: { name: uniq("Cust"), description: "d", tamId: tam.userId, outlineUrl: "https://docs.example.com/cust" },
    });
    const project = await prisma.project.create({
      data: { name: uniq("Proj"), tamId: tam.userId, customerId: customer.id, status: "ACTIVE" },
    });
    await prisma.projectMember.create({ data: { projectId: project.id, userId: member.userId } });
    return { tam, member, stranger, pending, customer, project };
  }

  it("saves on create, shows on list and detail, never inherits the customer's link", async () => {
    const { tam, customer, project } = await projectFixture();
    const created = await request(app)
      .post("/projects")
      .set(auth(tam.token))
      .send({ name: uniq("New"), customerId: customer.id, outlineUrl: "  https://docs.example.com/p/1 " });
    expect(created.status).toBe(201);
    expect(created.body.outlineUrl).toBe("https://docs.example.com/p/1");

    const detail = await request(app).get(`/projects/${project.id}`).set(auth(tam.token));
    expect(detail.status).toBe(200);
    expect(detail.body.outlineUrl).toBeNull();
    const list = await request(app).get("/projects").set(auth(tam.token));
    const rows = list.body as Array<{ id: number; outlineUrl: string | null }>;
    expect(rows.find((p) => p.id === created.body.id)?.outlineUrl).toBe("https://docs.example.com/p/1");
    expect(rows.find((p) => p.id === project.id)?.outlineUrl).toBeNull();
  });

  it("the TAM and a member can set and clear it; a stranger gets 404 and PENDING 403", async () => {
    const { tam, member, stranger, pending, project } = await projectFixture();

    const byTam = await request(app)
      .patch(`/projects/${project.id}`)
      .set(auth(tam.token))
      .send({ outlineUrl: " https://docs.example.com/p " });
    expect(byTam.status).toBe(200);
    expect(byTam.body.outlineUrl).toBe("https://docs.example.com/p");

    const byMember = await request(app)
      .patch(`/projects/${project.id}`)
      .set(auth(member.token))
      .send({ outlineUrl: "https://docs.example.com/p2" });
    expect(byMember.status).toBe(200);
    expect(byMember.body.outlineUrl).toBe("https://docs.example.com/p2");

    expect(
      (await request(app).patch(`/projects/${project.id}`).set(auth(stranger.token)).send({ outlineUrl: "https://x.y" })).status,
    ).toBe(404);
    expect(
      (await request(app).patch(`/projects/${project.id}`).set(auth(pending.token)).send({ outlineUrl: "https://x.y" })).status,
    ).toBe(403);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).outlineUrl).toBe(
      "https://docs.example.com/p2",
    );

    const cleared = await request(app).patch(`/projects/${project.id}`).set(auth(tam.token)).send({ outlineUrl: "" });
    expect(cleared.status).toBe(200);
    expect(cleared.body.outlineUrl).toBeNull();
  });

  it("applies the URL rule on create and update", async () => {
    const { tam, customer, project } = await projectFixture();
    const tooLong = "https://a.b/" + "x".repeat(2049 - "https://a.b/".length);
    for (const outlineUrl of ["javascript:alert(1)", "ftp://x", tooLong]) {
      const patch = await request(app)
        .patch(`/projects/${project.id}`)
        .set(auth(tam.token))
        .send({ outlineUrl });
      expect(patch.status, outlineUrl.slice(0, 30)).toBe(400);
      const post = await request(app)
        .post("/projects")
        .set(auth(tam.token))
        .send({ name: uniq("New"), customerId: customer.id, outlineUrl });
      expect(post.status, outlineUrl.slice(0, 30)).toBe(400);
    }
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).outlineUrl).toBeNull();
  });

  it("never reaches the guest share payload", async () => {
    const { tam, customer, project } = await projectFixture();
    await prisma.project.update({
      where: { id: project.id },
      data: { outlineUrl: "https://docs.example.com/secret-project-link" },
    });
    const link = await request(app).post(`/projects/${project.id}/share-links`).set(auth(tam.token)).send({});
    expect(link.status).toBe(201);
    const token = (link.body as { url: string }).url.replace("/share/", "");
    const guest = await request(app).get(`/public/share/${token}`);
    expect(guest.status).toBe(200);
    expect(JSON.stringify(guest.body)).not.toMatch(/outline/i);
    expect(JSON.stringify(guest.body)).not.toContain(customer.outlineUrl ?? "never");
    expect(guest.body.project).not.toHaveProperty("outlineUrl");
  });
});
