import "../env.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/prisma.js";
import { open } from "../../src/lib/secretBox.js";
import { hashInboundToken } from "../../src/lib/inbound/token.js";
import { createUserWithRole, seedRoles } from "../testAuth.js";

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const uniq = (label: string) => `${label} ${Date.now()}-${Math.random()}`;

beforeAll(async () => {
  await seedRoles();
});

async function fixture() {
  const tam = await createUserWithRole("TAM");
  const member = await createUserWithRole("TAM");
  const stakeholder = await createUserWithRole("STAKEHOLDER");
  const project = await prisma.project.create({
    data: { name: uniq("Project"), tamId: tam.userId, status: "ACTIVE" },
  });
  await prisma.projectMember.create({ data: { projectId: project.id, userId: member.userId, addedById: tam.userId } });
  await prisma.projectMember.create({ data: { projectId: project.id, userId: stakeholder.userId, addedById: tam.userId } });
  return { tam, member, stakeholder, project, base: `/projects/${project.id}/inbound-hooks` };
}

async function createHook(base: string, token: string, name = "GitLab") {
  const res = await request(app).post(base).set(auth(token)).send({ name });
  expect(res.status).toBe(201);
  return res.body as { hook: { id: number }; url: string | null; token?: string };
}

describe("inbound hook management", () => {
  it("lets the owner create, list, rename, disable, enable and delete", async () => {
    const { tam, base } = await fixture();
    const created = await createHook(base, tam.token);
    expect(created.url).toMatch(/^http:\/\/localhost:5173\/api\/webhook\/in\/[A-Za-z0-9_-]{43}$/);
    expect(created.token).toBeUndefined();
    expect(created.hook).toMatchObject({
      name: "GitLab",
      active: true,
      disabledReason: null,
      lastReceivedAt: null,
      hasSigningSecret: false,
      createdBy: { id: tam.userId },
    });
    const id = created.hook.id;

    const list = await request(app).get(base).set(auth(tam.token));
    expect(list.status).toBe(200);
    expect(list.body.hooks).toHaveLength(1);

    const renamed = await request(app).patch(`${base}/${id}`).set(auth(tam.token)).send({ name: "CI", active: false });
    expect(renamed.status).toBe(200);
    expect(renamed.body.hook).toMatchObject({ name: "CI", active: false });

    await prisma.inboundHook.update({ where: { id }, data: { active: false, disabledReason: "The author lost access" } });
    const enabled = await request(app).patch(`${base}/${id}`).set(auth(tam.token)).send({ active: true });
    expect(enabled.body.hook).toMatchObject({ active: true, disabledReason: null });

    expect((await request(app).delete(`${base}/${id}`).set(auth(tam.token))).status).toBe(204);
    expect((await request(app).get(base).set(auth(tam.token))).body.hooks).toHaveLength(0);
  });

  it("returns the token once and never in a read, storing only its hash", async () => {
    const { tam, base } = await fixture();
    const created = await createHook(base, tam.token);
    const token = created.url!.split("/").pop()!;
    const row = await prisma.inboundHook.findUniqueOrThrow({ where: { id: created.hook.id } });
    expect(row.tokenHash).toBe(hashInboundToken(token));
    expect(row.tokenPreview).toBe(token.slice(0, 4));

    const list = await request(app).get(base).set(auth(tam.token));
    const text = JSON.stringify(list.body);
    expect(text).not.toContain(token);
    expect(text).not.toContain(row.tokenHash);
    expect(text).not.toMatch(/tokenHash|signingSecretEnc|"url"/);
    expect(list.body.hooks[0].tokenPreview).toBe(token.slice(0, 4));
  });

  it("rotating the token changes the hash and invalidates the old one", async () => {
    const { tam, base } = await fixture();
    const created = await createHook(base, tam.token);
    const before = await prisma.inboundHook.findUniqueOrThrow({ where: { id: created.hook.id } });
    const rotated = await request(app).post(`${base}/${created.hook.id}/rotate-token`).set(auth(tam.token));
    expect(rotated.status).toBe(200);
    const newToken = (rotated.body.url as string).split("/").pop()!;
    const after = await prisma.inboundHook.findUniqueOrThrow({ where: { id: created.hook.id } });
    expect(after.tokenHash).not.toBe(before.tokenHash);
    expect(after.tokenHash).toBe(hashInboundToken(newToken));
    expect(JSON.stringify((await request(app).get(base).set(auth(tam.token))).body)).not.toContain(newToken);
  });

  it("allows 5 per project and answers 409 on the 6th", async () => {
    const { tam, base } = await fixture();
    for (let i = 0; i < 5; i++) await createHook(base, tam.token, `Hook ${i}`);
    const over = await request(app).post(base).set(auth(tam.token)).send({ name: "Sixth" });
    expect(over.status).toBe(409);
    expect(over.body.code).toBe("inbound_hook_limit");
    expect(over.body.error).toMatch(/at most 5/);
    const other = await fixture();
    await createHook(other.base, other.tam.token);
  });

  it("sets and clears the signing secret, sealed, returned once", async () => {
    const { tam, base } = await fixture();
    const { hook } = await createHook(base, tam.token);
    const set = await request(app).post(`${base}/${hook.id}/signing-secret`).set(auth(tam.token));
    expect(set.status).toBe(200);
    expect(set.body.secret).toMatch(/^whsec_/);
    expect(set.body.hook.hasSigningSecret).toBe(true);
    const row = await prisma.inboundHook.findUniqueOrThrow({ where: { id: hook.id } });
    expect(row.signingSecretEnc).not.toContain(set.body.secret);
    expect(open(row.signingSecretEnc!)).toBe(set.body.secret);

    const list = await request(app).get(base).set(auth(tam.token));
    expect(list.body.hooks[0].hasSigningSecret).toBe(true);
    expect(JSON.stringify(list.body)).not.toContain(set.body.secret);

    const cleared = await request(app).delete(`${base}/${hook.id}/signing-secret`).set(auth(tam.token));
    expect(cleared.status).toBe(200);
    expect(cleared.body.hook.hasSigningSecret).toBe(false);
    expect((await prisma.inboundHook.findUniqueOrThrow({ where: { id: hook.id } })).signingSecretEnc).toBeNull();
  });

  it("answers 403 owner_only to a member who is not an owner, on every route", async () => {
    const { tam, member, base } = await fixture();
    const { hook } = await createHook(base, tam.token);
    const calls = [
      request(app).get(base),
      request(app).post(base).send({ name: "x" }),
      request(app).patch(`${base}/${hook.id}`).send({ name: "x" }),
      request(app).delete(`${base}/${hook.id}`),
      request(app).post(`${base}/${hook.id}/rotate-token`),
      request(app).post(`${base}/${hook.id}/signing-secret`),
      request(app).delete(`${base}/${hook.id}/signing-secret`),
    ];
    for (const call of calls) {
      const res = await call.set(auth(member.token));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("owner_only");
    }
    expect(await prisma.inboundHook.count({ where: { id: hook.id } })).toBe(1);
  });

  it("answers 403 without project:write and 404 for a project the caller cannot see", async () => {
    const { tam, stakeholder, base } = await fixture();
    const { hook } = await createHook(base, tam.token);
    expect((await request(app).get(base).set(auth(stakeholder.token))).status).toBe(403);
    expect((await request(app).post(base).set(auth(stakeholder.token)).send({ name: "x" })).status).toBe(403);
    expect((await request(app).delete(`${base}/${hook.id}`).set(auth(stakeholder.token))).status).toBe(403);

    const outsider = await createUserWithRole("TAM");
    expect((await request(app).get(base).set(auth(outsider.token))).status).toBe(404);
    expect((await request(app).get(base)).status).toBe(401);
  });

  it("answers 404 for a hook id from another project", async () => {
    const a = await fixture();
    const b = await fixture();
    const { hook } = await createHook(b.base, b.tam.token);
    const foreign = `${a.base}/${hook.id}`;
    const t = auth(a.tam.token);
    expect((await request(app).patch(foreign).set(t).send({ name: "x" })).status).toBe(404);
    expect((await request(app).delete(foreign).set(t)).status).toBe(404);
    expect((await request(app).post(`${foreign}/rotate-token`).set(t)).status).toBe(404);
    expect((await request(app).post(`${foreign}/signing-secret`).set(t)).status).toBe(404);
    expect((await request(app).delete(`${foreign}/signing-secret`).set(t)).status).toBe(404);
    expect(await prisma.inboundHook.count({ where: { id: hook.id } })).toBe(1);
  });

  it("rejects an empty or oversized name", async () => {
    const { tam, base } = await fixture();
    expect((await request(app).post(base).set(auth(tam.token)).send({ name: "  " })).status).toBe(400);
    expect((await request(app).post(base).set(auth(tam.token)).send({ name: "x".repeat(81) })).status).toBe(400);
  });
});
