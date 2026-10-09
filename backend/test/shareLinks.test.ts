// Guest links (docs/archive/plans/collaboration-and-sharing.md, L4): the owner
// API on /projects/:id/share-links and the unauthenticated /public/share/:token
// view. Fixtures write via `prisma` directly.
import "./env.js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { publicShareRateLimiter, PUBLIC_SHARE_RATE_LIMIT } from "../src/routes/publicShare.js";
import { derivePhase, generateShareToken, hashShareToken } from "../src/lib/shareLinks.js";
import { createUserWithRole, seedRoles } from "./testAuth.js";

const app = createApp();

beforeAll(async () => {
  await seedRoles();
});

// The limiter is process-wide and every supertest request shares one address.
beforeEach(() => {
  publicShareRateLimiter.reset();
});

function uniq(label: string): string {
  return `${label} ${Date.now()}-${Math.random()}`;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

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
  await prisma.projectMember.create({ data: { projectId: project.id, userId: member.userId } });
  return { tam, member, outsider, customer, project };
}

async function createLink(
  projectId: number,
  token: string,
  body: Record<string, unknown> = {},
): Promise<{ id: number; url: string; token: string }> {
  const res = await request(app)
    .post(`/projects/${projectId}/share-links`)
    .set(auth(token))
    .send(body);
  expect(res.status).toBe(201);
  const url = (res.body as { url: string }).url;
  return { id: (res.body as { id: number }).id, url, token: url.replace("/share/", "") };
}

let taskPos = 0;
function makeTask(
  projectId: number,
  data: Partial<{
    title: string;
    description: string;
    status: "TODO" | "IN_PROGRESS" | "DONE";
    startDate: Date | null;
    dueDate: Date | null;
    sectionId: number | null;
    isMilestone: boolean;
    assignedToId: number | null;
  }> = {},
) {
  taskPos += 1;
  return prisma.task.create({
    data: {
      projectId,
      title: data.title ?? uniq("Task"),
      description: data.description,
      status: data.status ?? "TODO",
      priority: "MEDIUM",
      position: taskPos,
      startDate: data.startDate ?? null,
      dueDate: data.dueDate ?? null,
      sectionId: data.sectionId ?? null,
      isMilestone: data.isMilestone ?? false,
      assignedToId: data.assignedToId ?? null,
    },
  });
}

describe("owner API", () => {
  it("the TAM creates, lists and revokes a link; the token is shown only on create", async () => {
    const { tam, project } = await fixture();
    const before = Date.now();
    const res = await request(app)
      .post(`/projects/${project.id}/share-links`)
      .set(auth(tam.token))
      .send({ label: "  For Nusantara IT  ", expiresInDays: 7 });
    expect(res.status).toBe(201);
    const body = res.body as {
      id: number;
      label: string;
      url: string;
      expiresAt: string;
      createdAt: string;
    };
    expect(Object.keys(body).sort()).toEqual(["createdAt", "expiresAt", "id", "label", "url"]);
    expect(body.label).toBe("For Nusantara IT");
    expect(body.url).toMatch(/^\/share\/[A-Za-z0-9_-]{43}$/);
    const days = (new Date(body.expiresAt).getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);

    const token = body.url.replace("/share/", "");
    // Only the hash is stored — never the token.
    const row = await prisma.shareLink.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.tokenHash).toBe(hashShareToken(token));
    expect(row.tokenHash).not.toBe(token);
    expect(JSON.stringify(row)).not.toContain(token);

    const list = await request(app).get(`/projects/${project.id}/share-links`).set(auth(tam.token));
    expect(list.status).toBe(200);
    const rows = list.body as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual([
      "createdAt",
      "createdBy",
      "expiresAt",
      "id",
      "label",
      "lastUsedAt",
      "revokedAt",
    ]);
    expect(rows[0].createdBy).toEqual({ id: tam.userId, username: expect.any(String) });
    expect(rows[0].revokedAt).toBeNull();
    expect(JSON.stringify(list.body)).not.toContain(token);
    expect(JSON.stringify(list.body)).not.toContain(row.tokenHash);

    const del = await request(app)
      .delete(`/projects/${project.id}/share-links/${body.id}`)
      .set(auth(tam.token));
    expect(del.status).toBe(204);
    const again = await request(app)
      .delete(`/projects/${project.id}/share-links/${body.id}`)
      .set(auth(tam.token));
    expect(again.status).toBe(204); // idempotent

    const after = await request(app).get(`/projects/${project.id}/share-links`).set(auth(tam.token));
    expect((after.body as Array<{ revokedAt: string | null }>)[0].revokedAt).not.toBeNull();
  });

  it("defaults to 30 days, allows a missing label, and validates the body", async () => {
    const { tam, project } = await fixture();
    const res = await request(app)
      .post(`/projects/${project.id}/share-links`)
      .set(auth(tam.token))
      .send({});
    expect(res.status).toBe(201);
    expect((res.body as { label: string | null }).label).toBeNull();
    const days =
      (new Date((res.body as { expiresAt: string }).expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.99);
    expect(days).toBeLessThan(30.01);

    for (const bad of [{ expiresInDays: 0 }, { expiresInDays: 91 }, { expiresInDays: 1.5 }, { label: "x".repeat(81) }]) {
      const r = await request(app)
        .post(`/projects/${project.id}/share-links`)
        .set(auth(tam.token))
        .send(bad);
      expect(r.status).toBe(400);
    }
  });

  it("a customer owner who is not the TAM counts as an owner", async () => {
    const { customer, project } = await fixture();
    const owner = await createUserWithRole("TAM");
    await prisma.customer.update({ where: { id: customer.id }, data: { tamId: owner.userId } });
    const res = await request(app)
      .post(`/projects/${project.id}/share-links`)
      .set(auth(owner.token))
      .send({});
    expect(res.status).toBe(201);
  });

  it("a view-all user who has project:write can manage links", async () => {
    const { project } = await fixture();
    const admin = await createUserWithRole("ADMIN");
    const res = await request(app)
      .post(`/projects/${project.id}/share-links`)
      .set(auth(admin.token))
      .send({});
    expect(res.status).toBe(201);
  });

  it("a read-only view-all role (AUDITOR) can list but not create or revoke", async () => {
    const { tam, project } = await fixture();
    const stakeholder = await createUserWithRole("AUDITOR");
    const link = await createLink(project.id, tam.token);

    const get = await request(app)
      .get(`/projects/${project.id}/share-links`)
      .set(auth(stakeholder.token));
    expect(get.status).toBe(200);
    expect((get.body as unknown[]).length).toBe(1);

    const post = await request(app)
      .post(`/projects/${project.id}/share-links`)
      .set(auth(stakeholder.token))
      .send({});
    const del = await request(app)
      .delete(`/projects/${project.id}/share-links/${link.id}`)
      .set(auth(stakeholder.token));
    for (const r of [post, del]) {
      expect(r.status).toBe(403);
      expect((r.body as { code: string }).code).toBe("forbidden");
    }
    const row = await prisma.shareLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(row.revokedAt).toBeNull();
    expect(await prisma.shareLink.count({ where: { projectId: project.id } })).toBe(1);
  });

  it("a member gets 403 owner_only on all three routes", async () => {
    const { tam, member, project } = await fixture();
    const link = await createLink(project.id, tam.token);
    const post = await request(app)
      .post(`/projects/${project.id}/share-links`)
      .set(auth(member.token))
      .send({});
    const get = await request(app).get(`/projects/${project.id}/share-links`).set(auth(member.token));
    const del = await request(app)
      .delete(`/projects/${project.id}/share-links/${link.id}`)
      .set(auth(member.token));
    for (const r of [post, get, del]) {
      expect(r.status).toBe(403);
      expect((r.body as { code: string }).code).toBe("owner_only");
    }
    // The failed delete did not revoke.
    const row = await prisma.shareLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(row.revokedAt).toBeNull();
  });

  it("a non-member gets 404 on all three routes (before any body validation)", async () => {
    const { tam, outsider, project } = await fixture();
    const link = await createLink(project.id, tam.token);
    const post = await request(app)
      .post(`/projects/${project.id}/share-links`)
      .set(auth(outsider.token))
      .send({ expiresInDays: 9999 });
    const get = await request(app).get(`/projects/${project.id}/share-links`).set(auth(outsider.token));
    const del = await request(app)
      .delete(`/projects/${project.id}/share-links/${link.id}`)
      .set(auth(outsider.token));
    expect([post.status, get.status, del.status]).toEqual([404, 404, 404]);
  });

  it("requires sign-in, and revoking a link of another project is 404", async () => {
    const { tam, project } = await fixture();
    const other = await fixture();
    const noAuth = await request(app).get(`/projects/${project.id}/share-links`);
    expect(noAuth.status).toBe(401);
    const link = await createLink(other.project.id, other.tam.token);
    const wrong = await request(app)
      .delete(`/projects/${project.id}/share-links/${link.id}`)
      .set(auth(tam.token));
    expect(wrong.status).toBe(404);
  });

  it("records created/removed activity with the label and never the token", async () => {
    const { tam, project } = await fixture();
    const link = await createLink(project.id, tam.token, { label: "For Acme" });
    await request(app).delete(`/projects/${project.id}/share-links/${link.id}`).set(auth(tam.token));
    await request(app).delete(`/projects/${project.id}/share-links/${link.id}`).set(auth(tam.token));

    const events = await prisma.activityEvent.findMany({
      where: { projectId: project.id, entityType: "share_link" },
      orderBy: { id: "asc" },
    });
    expect(events.map((e) => [e.action, e.entityLabel, e.entityId, e.actorId])).toEqual([
      ["created", "For Acme", link.id, tam.userId],
      ["removed", "For Acme", link.id, tam.userId], // the idempotent repeat records nothing
    ]);
    const raw = JSON.stringify(events);
    expect(raw).not.toContain(link.token);
    expect(raw).not.toContain(hashShareToken(link.token));
  });
});

describe("public view", () => {
  it("returns exactly the contract shape for a valid link, with no-store / noindex", async () => {
    const { tam, customer, project } = await fixture();
    const link = await createLink(project.id, tam.token);
    const section = await prisma.section.create({
      data: { projectId: project.id, name: "Discovery", position: 0 },
    });
    await makeTask(project.id, {
      sectionId: section.id,
      status: "DONE",
      startDate: day("2026-10-01"),
      dueDate: day("2026-10-05"),
    });
    await makeTask(project.id, {
      title: "Go-live",
      isMilestone: true,
      status: "TODO",
      dueDate: day("2026-12-01"),
    });

    const res = await request(app).get(`/public/share/${link.token}`);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-robots-tag"]).toBe("noindex");
    const body = res.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["generatedAt", "milestones", "phases", "project"]);
    expect(body.project).toEqual({
      name: project.name,
      customerName: customer.name,
      status: "ACTIVE",
    });
    expect(body.phases).toEqual([
      { name: "Discovery", startDate: "2026-10-01", endDate: "2026-10-05", status: "done" },
    ]);
    expect(body.milestones).toEqual([{ title: "Go-live", date: "2026-12-01", done: false }]);
    expect(new Date(body.generatedAt as string).toISOString()).toBe(body.generatedAt);
  });

  it("needs no auth and works with a project that has no customer", async () => {
    const { tam } = await fixture();
    const project = await prisma.project.create({
      data: { name: uniq("Solo"), tamId: tam.userId, status: "PLANNING" },
    });
    const link = await createLink(project.id, tam.token);
    const res = await request(app).get(`/public/share/${link.token}`);
    expect(res.status).toBe(200);
    expect((res.body as { project: { customerName: null } }).project.customerName).toBeNull();
  });

  it("unknown, expired and revoked tokens return the identical 404 (with the same headers)", async () => {
    const { tam, project } = await fixture();
    const expired = await createLink(project.id, tam.token);
    await prisma.shareLink.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const revoked = await createLink(project.id, tam.token);
    await request(app).delete(`/projects/${project.id}/share-links/${revoked.id}`).set(auth(tam.token));

    const unknownWellFormed = generateShareToken(); // right shape, never issued
    const responses = await Promise.all(
      [expired.token, revoked.token, unknownWellFormed, "not-a-real-token", "x".repeat(500)].map((t) =>
        request(app).get(`/public/share/${t}`),
      ),
    );
    for (const r of responses) {
      expect(r.status).toBe(404);
      expect(r.body).toEqual(responses[0].body);
      expect(r.headers["cache-control"]).toBe("no-store");
      expect(r.headers["x-robots-tag"]).toBe("noindex");
    }
  });

  it("a malformed percent-escape in the path is the same uniform 404, not a 500", async () => {
    const { tam, project } = await fixture();
    const link = await createLink(project.id, tam.token);
    await prisma.shareLink.update({
      where: { id: link.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await request(app).get(`/public/share/${link.token}`);
    const res = await request(app).get("/public/share/%E0%A4%A");
    expect(res.status).toBe(404);
    expect(res.body).toEqual(expired.body);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-robots-tag"]).toBe("noindex");
  });

  it("a token that is not 43 base64url characters never reaches the database", async () => {
    const { tam, project } = await fixture();
    const link = await createLink(project.id, tam.token);
    // A valid token with one character appended or removed is rejected on shape.
    for (const bad of [`${link.token}A`, link.token.slice(0, -1), `${link.token.slice(0, -1)}!`]) {
      const res = await request(app).get(`/public/share/${encodeURIComponent(bad)}`);
      expect(res.status).toBe(404);
    }
    expect((await request(app).get(`/public/share/${link.token}`)).status).toBe(200);
  });

  it("deleting the project makes the link 404 (cascade)", async () => {
    const { tam, project } = await fixture();
    const link = await createLink(project.id, tam.token);
    await prisma.project.delete({ where: { id: project.id } });
    const res = await request(app).get(`/public/share/${link.token}`);
    expect(res.status).toBe(404);
  });

  it("updates lastUsedAt at most once per hour", async () => {
    const { tam, project } = await fixture();
    const link = await createLink(project.id, tam.token);
    const read = () => prisma.shareLink.findUniqueOrThrow({ where: { id: link.id } });
    expect((await read()).lastUsedAt).toBeNull();

    await request(app).get(`/public/share/${link.token}`);
    const first = (await read()).lastUsedAt;
    expect(first).not.toBeNull();

    await request(app).get(`/public/share/${link.token}`);
    expect((await read()).lastUsedAt?.getTime()).toBe(first!.getTime()); // within the hour: untouched

    const stale = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await prisma.shareLink.update({ where: { id: link.id }, data: { lastUsedAt: stale } });
    await request(app).get(`/public/share/${link.token}`);
    expect((await read()).lastUsedAt!.getTime()).toBeGreaterThan(stale.getTime() + 60 * 60 * 1000);
  });

  it("rate-limits per IP: 429 after the limit, other IPs unaffected", async () => {
    const { tam, project } = await fixture();
    const link = await createLink(project.id, tam.token);
    const get = (ip: string) =>
      request(app).get(`/public/share/${link.token}`).set("X-Forwarded-For", ip);

    for (let i = 0; i < PUBLIC_SHARE_RATE_LIMIT; i++) {
      expect((await get("203.0.113.7")).status).toBe(200);
    }
    const limited = await get("203.0.113.7");
    expect(limited.status).toBe(429);
    expect((limited.body as { code: string }).code).toBe("rate_limited");
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    expect(limited.headers["cache-control"]).toBe("no-store");
    expect(limited.headers["x-robots-tag"]).toBe("noindex");

    expect((await get("203.0.113.8")).status).toBe(200);
    // One nginx hop is trusted: a spoofed leading entry does not evade the limit.
    expect((await get("198.51.100.1, 203.0.113.7")).status).toBe(429);
  });

  it("unknown tokens count against the limit too", async () => {
    for (let i = 0; i < PUBLIC_SHARE_RATE_LIMIT; i++) {
      expect((await request(app).get("/public/share/nope")).status).toBe(404);
    }
    expect((await request(app).get("/public/share/nope")).status).toBe(429);
  });
});

describe("phase dates and status", () => {
  it("derives start/end/status per section, in section order, from its tasks only", async () => {
    const { tam, project } = await fixture();
    const link = await createLink(project.id, tam.token);
    const mk = (name: string, position: number) =>
      prisma.section.create({ data: { projectId: project.id, name, position } });
    // Created out of order on purpose: output follows `position`.
    const s3 = await mk("Empty phase", 2);
    const s2 = await mk("Build", 1);
    const s1 = await mk("Discovery", 0);
    const s4 = await mk("Rollout", 3);

    // Discovery: all done -> done; start = earliest start, end = latest due.
    await makeTask(project.id, { sectionId: s1.id, status: "DONE", startDate: day("2026-10-05"), dueDate: day("2026-10-09") });
    await makeTask(project.id, { sectionId: s1.id, status: "DONE", startDate: day("2026-10-01"), dueDate: day("2026-10-03") });
    // Build: mixed -> in progress; a task with only a due date falls back for start; only a start for end.
    await makeTask(project.id, { sectionId: s2.id, status: "DONE", dueDate: day("2026-11-02") });
    await makeTask(project.id, { sectionId: s2.id, status: "TODO", startDate: day("2026-11-20") });
    // Rollout: nothing started -> not started.
    await makeTask(project.id, { sectionId: s4.id, status: "TODO", startDate: day("2027-01-05"), dueDate: day("2027-01-10") });
    // Tasks without a section are not a phase and do not leak into one.
    await makeTask(project.id, { sectionId: null, status: "IN_PROGRESS", startDate: day("2020-01-01"), dueDate: day("2030-01-01") });

    const res = await request(app).get(`/public/share/${link.token}`);
    expect((res.body as { phases: unknown[] }).phases).toEqual([
      { name: "Discovery", startDate: "2026-10-01", endDate: "2026-10-09", status: "done" },
      { name: "Build", startDate: "2026-11-02", endDate: "2026-11-20", status: "in_progress" },
      { name: "Empty phase", startDate: null, endDate: null, status: "not_started" },
      { name: "Rollout", startDate: "2027-01-05", endDate: "2027-01-10", status: "not_started" },
    ]);
    void s3;
  });

  it("a project with no sections has no phases", async () => {
    const { tam, project } = await fixture();
    await makeTask(project.id, { status: "IN_PROGRESS", startDate: day("2026-10-01") });
    const link = await createLink(project.id, tam.token);
    const res = await request(app).get(`/public/share/${link.token}`);
    expect((res.body as { phases: unknown[] }).phases).toEqual([]);
  });

  it("derivePhase status rules", () => {
    const t = (status: "TODO" | "IN_PROGRESS" | "DONE") => ({ status, startDate: null, dueDate: null });
    expect(derivePhase("a", []).status).toBe("not_started");
    expect(derivePhase("a", [t("TODO"), t("TODO")]).status).toBe("not_started");
    expect(derivePhase("a", [t("DONE"), t("DONE")]).status).toBe("done");
    expect(derivePhase("a", [t("DONE"), t("TODO")]).status).toBe("in_progress");
    expect(derivePhase("a", [t("IN_PROGRESS")]).status).toBe("in_progress");
  });
});

describe("milestones", () => {
  it("lists only isMilestone tasks, by date, with done from the status", async () => {
    const { tam, project } = await fixture();
    const link = await createLink(project.id, tam.token);
    await makeTask(project.id, { title: "Later", isMilestone: true, dueDate: day("2026-12-15") });
    await makeTask(project.id, { title: "Signed off", isMilestone: true, status: "DONE", dueDate: day("2026-10-20") });
    await makeTask(project.id, { title: "Start-only", isMilestone: true, startDate: day("2026-11-01") });
    await makeTask(project.id, { title: "Undated milestone", isMilestone: true });
    await makeTask(project.id, { title: "Just a task", dueDate: day("2026-11-11") });

    const res = await request(app).get(`/public/share/${link.token}`);
    expect((res.body as { milestones: unknown[] }).milestones).toEqual([
      { title: "Signed off", date: "2026-10-20", done: true },
      { title: "Start-only", date: "2026-11-01", done: false },
      { title: "Later", date: "2026-12-15", done: false },
    ]);
  });
});

describe("guardrail: nothing internal reaches the guest payload", () => {
  it("no note, comment, risk, task detail, person or activity text appears anywhere", async () => {
    const { tam, project, customer } = await fixture();
    await prisma.project.update({
      where: { id: project.id },
      data: { description: "SECRET-PROJECT-DESCRIPTION" },
    });
    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        description: "SECRET-CUSTOMER-DESCRIPTION",
        accountManager: "SECRET-ACCOUNT-MANAGER",
        solutionArchitect: "SECRET-SOLUTION-ARCHITECT",
      },
    });
    const assignee = await createUserWithRole("TAM");
    const assigneeRow = await prisma.user.findUniqueOrThrow({ where: { id: assignee.userId } });
    const tamRow = await prisma.user.findUniqueOrThrow({ where: { id: tam.userId } });

    await prisma.projectNote.create({
      data: {
        projectId: project.id,
        authorId: tam.userId,
        body: "SECRET-INTERNAL-NOTE-BODY",
        visibility: "INTERNAL",
        noteDate: day("2026-10-01"),
      },
    });
    await prisma.projectNote.create({
      data: {
        projectId: project.id,
        authorId: tam.userId,
        body: "SECRET-CUSTOMER-NOTE-BODY",
        visibility: "CUSTOMER_FACING",
        noteDate: day("2026-10-01"),
      },
    });
    await prisma.risk.create({
      data: {
        projectId: project.id,
        description: "SECRET-RISK-DESCRIPTION",
        mitigationPlan: "SECRET-RISK-MITIGATION",
        contingencyPlan: "SECRET-RISK-CONTINGENCY",
      },
    });

    const section = await prisma.section.create({
      data: { projectId: project.id, name: "Phase One", position: 0 },
    });
    const secretTask = await makeTask(project.id, {
      title: "SECRET-TASK-TITLE",
      description: "SECRET-TASK-DESCRIPTION",
      sectionId: section.id,
      status: "IN_PROGRESS",
      startDate: day("2026-10-01"),
      dueDate: day("2026-10-31"),
      assignedToId: assignee.userId,
    });
    await prisma.task.update({
      where: { id: secretTask.id },
      data: { itopTicketRef: "SECRET-ITOP-REF" },
    });
    await prisma.comment.create({
      data: { taskId: secretTask.id, authorId: tam.userId, body: "SECRET-COMMENT-BODY" },
    });
    await makeTask(project.id, {
      title: "Public milestone",
      description: "SECRET-MILESTONE-DESCRIPTION",
      isMilestone: true,
      dueDate: day("2026-11-30"),
      assignedToId: assignee.userId,
    });
    await prisma.activityEvent.create({
      data: {
        projectId: project.id,
        actorId: tam.userId,
        entityType: "task",
        entityId: secretTask.id,
        action: "created",
        entityLabel: "SECRET-ACTIVITY-LABEL",
        changes: { title: { from: "SECRET-ACTIVITY-FROM", to: "SECRET-ACTIVITY-TO" } },
      },
    });
    // A real event too: the link's own creation is logged, with its label.
    const link = await createLink(project.id, tam.token, { label: "SECRET-LINK-LABEL" });

    const res = await request(app).get(`/public/share/${link.token}`);
    expect(res.status).toBe(200);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain("SECRET");
    expect(raw).not.toContain(assigneeRow.email);
    expect(raw).not.toContain(assigneeRow.username);
    expect(raw).not.toContain(tamRow.email);
    expect(raw).not.toContain(tamRow.username);
    expect(raw).not.toContain(assignee.token);
    expect(raw).not.toContain(link.token);
    expect(raw).not.toContain(hashShareToken(link.token));

    // Only section names, milestone titles and the project/customer identity appear.
    expect(res.body).toEqual({
      project: { name: project.name, customerName: customer.name, status: "ACTIVE" },
      phases: [{ name: "Phase One", startDate: "2026-10-01", endDate: "2026-10-31", status: "in_progress" }],
      milestones: [{ title: "Public milestone", date: "2026-11-30", done: false }],
      generatedAt: expect.any(String),
    });
    for (const key of ["notes", "comments", "risks", "activity", "tasks", "members", "assignee"]) {
      expect(raw).not.toContain(`"${key}"`);
    }
  });
});
