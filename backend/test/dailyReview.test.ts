// GET /daily-review — one payload for the Daily Review page (spec §5.1,
// §9). Fixtures write directly via `prisma` rather than through
// routes/projects.ts / routes/customers.ts, both of which are being built
// out in parallel by sibling tasks this suite must not depend on.
import "./env.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { ProjectStatus } from "@prisma/client";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { createAdminAndToken, createUserWithRole, seedRoles } from "./testAuth.js";

const app = createApp();

beforeAll(async () => {
  await seedRoles();
});

const WEEK = "2026-W35"; // Mon 2026-08-24 .. Sun 2026-08-30
const TODAY = "2026-08-28";
// The wire contract for `@db.Date` columns: Prisma serialises them as
// UTC-midnight instants (docs/plans/date-contract-utc-midnight.md), while
// `week.days`/`week.start`/`today` are plain "yyyy-MM-dd" day strings — the
// two shapes must never be confused by a frontend consumer.
const DAY_STRING_RE = /^\d{4}-\d{2}-\d{2}$/;
function dayInstant(day: string): string {
  return `${day}T00:00:00.000Z`;
}

function uniq(label: string): string {
  return `${label} ${Date.now()}-${Math.random()}`;
}

async function createCustomer(overrides: { name?: string; tamId?: number | null } = {}) {
  return prisma.customer.create({
    data: {
      name: overrides.name ?? uniq("Customer"),
      description: "d",
      tamId: overrides.tamId ?? null,
    },
  });
}

async function createProject(overrides: {
  tamId: number;
  customerId?: number | null;
  status?: ProjectStatus;
  name?: string;
  baselineLockedAt?: Date | null;
}) {
  return prisma.project.create({
    data: {
      name: overrides.name ?? uniq("Project"),
      tamId: overrides.tamId,
      customerId: overrides.customerId ?? null,
      status: overrides.status ?? "ACTIVE",
      baselineLockedAt: overrides.baselineLockedAt ?? null,
    },
  });
}

function get(token: string, query: Record<string, string>) {
  return request(app)
    .get("/daily-review")
    .query(query)
    .set("Authorization", `Bearer ${token}`);
}

function allProjectDtos(body: any): any[] {
  return [
    ...body.unassignedProjects,
    ...body.customers.flatMap((c: any) => c.projects),
  ];
}

describe("GET /daily-review — scope (Decisions 8-10)", () => {
  it("TAM sees, under an OWNED customer, every ACTIVE project including one whose project tamId is another user", async () => {
    const tam = await createUserWithRole("TAM");
    const otherTam = await createUserWithRole("TAM");
    const customer = await createCustomer({ tamId: tam.userId, name: uniq("Owned Customer") });
    const mine = await createProject({ tamId: tam.userId, customerId: customer.id, status: "ACTIVE", name: uniq("Owned Mine") });
    const theirs = await createProject({ tamId: otherTam.userId, customerId: customer.id, status: "ACTIVE", name: uniq("Owned Theirs") });

    const res = await get(tam.token, { week: WEEK, today: TODAY });
    expect(res.status).toBe(200);

    const cust = res.body.customers.find((c: any) => c.id === customer.id);
    expect(cust).toBeDefined();
    const projectIds = cust.projects.map((p: any) => p.id);
    expect(projectIds).toContain(mine.id);
    expect(projectIds).toContain(theirs.id);
  });

  it("TAM sees, under an ATTACHED customer (caller is project TAM, customer owned by another TAM), only the caller's ACTIVE projects", async () => {
    const tam = await createUserWithRole("TAM");
    const otherTam = await createUserWithRole("TAM");
    const customer = await createCustomer({ tamId: otherTam.userId, name: uniq("Attached Customer") });
    const mine = await createProject({ tamId: tam.userId, customerId: customer.id, status: "ACTIVE", name: uniq("Attached Mine") });
    const theirs = await createProject({ tamId: otherTam.userId, customerId: customer.id, status: "ACTIVE", name: uniq("Attached Theirs") });

    const res = await get(tam.token, { week: WEEK, today: TODAY });
    expect(res.status).toBe(200);

    const cust = res.body.customers.find((c: any) => c.id === customer.id);
    expect(cust).toBeDefined();
    const projectIds = cust.projects.map((p: any) => p.id);
    expect(projectIds).toContain(mine.id);
    expect(projectIds).not.toContain(theirs.id);
  });

  it("an unrelated customer (owned by another TAM, no project of the caller) is absent", async () => {
    const tam = await createUserWithRole("TAM");
    const otherTam = await createUserWithRole("TAM");
    const customer = await createCustomer({ tamId: otherTam.userId, name: uniq("Unrelated Customer") });
    await createProject({ tamId: otherTam.userId, customerId: customer.id, status: "ACTIVE", name: uniq("Unrelated Project") });

    const res = await get(tam.token, { week: WEEK, today: TODAY });
    expect(res.status).toBe(200);
    expect(res.body.customers.some((c: any) => c.id === customer.id)).toBe(false);
  });

  it("an unowned customer with no active project is absent, and appears once it has an ACTIVE project of the caller", async () => {
    const tam = await createUserWithRole("TAM");
    const customer = await createCustomer({ tamId: null, name: uniq("Unowned Customer") });

    let res = await get(tam.token, { week: WEEK, today: TODAY });
    expect(res.status).toBe(200);
    expect(res.body.customers.some((c: any) => c.id === customer.id)).toBe(false);

    const project = await createProject({ tamId: tam.userId, customerId: customer.id, status: "ACTIVE", name: uniq("Unowned Now Active") });

    res = await get(tam.token, { week: WEEK, today: TODAY });
    expect(res.status).toBe(200);
    const cust = res.body.customers.find((c: any) => c.id === customer.id);
    expect(cust).toBeDefined();
    expect(cust.projects.map((p: any) => p.id)).toContain(project.id);
  });

  it("customerId: null projects land in unassignedProjects only when Project.tamId is the caller", async () => {
    const tam = await createUserWithRole("TAM");
    const otherTam = await createUserWithRole("TAM");
    const mine = await createProject({ tamId: tam.userId, status: "ACTIVE", customerId: null, name: uniq("No Customer Mine") });
    const theirs = await createProject({ tamId: otherTam.userId, status: "ACTIVE", customerId: null, name: uniq("No Customer Theirs") });

    const res = await get(tam.token, { week: WEEK, today: TODAY });
    expect(res.status).toBe(200);
    const ids = res.body.unassignedProjects.map((p: any) => p.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
  });

  it("excludes a PLANNING project from an owned customer's group", async () => {
    const tam = await createUserWithRole("TAM");
    const customer = await createCustomer({ tamId: tam.userId, name: uniq("Planning Owner Customer") });
    const planning = await createProject({ tamId: tam.userId, customerId: customer.id, status: "PLANNING", name: uniq("Planning Proj") });

    const res = await get(tam.token, { week: WEEK, today: TODAY });
    expect(res.status).toBe(200);
    // The customer still shows (owned via tamId, independent of any active
    // project), but the PLANNING project itself never appears.
    const cust = res.body.customers.find((c: any) => c.id === customer.id);
    expect(cust).toBeDefined();
    expect(cust.projects.map((p: any) => p.id)).not.toContain(planning.id);
  });

  it("a PLANNING project alone does not surface an otherwise-invisible customer", async () => {
    const tam = await createUserWithRole("TAM");
    const otherTam = await createUserWithRole("TAM");
    const customer = await createCustomer({ tamId: otherTam.userId, name: uniq("Planning Only Customer") });
    await createProject({ tamId: tam.userId, customerId: customer.id, status: "PLANNING", name: uniq("Planning Attached") });

    const res = await get(tam.token, { week: WEEK, today: TODAY });
    expect(res.status).toBe(200);
    expect(res.body.customers.some((c: any) => c.id === customer.id)).toBe(false);
  });

  it("an unowned customer whose only ACTIVE project belongs to a different TAM is absent, and does not inflate coverage total", async () => {
    const tam = await createUserWithRole("TAM");
    const otherTam = await createUserWithRole("TAM");
    const customer = await createCustomer({ tamId: null, name: uniq("Unowned Foreign-Project Customer") });
    // The customer itself is visible (unowned, tamId: null), but its only
    // ACTIVE project belongs to a different TAM, which the caller can't
    // see via projectVisibilityFilter — so the customer must not surface
    // as an empty group and must not inflate coverage.total.
    await createProject({ tamId: otherTam.userId, customerId: customer.id, status: "ACTIVE", name: uniq("Foreign Active") });

    const res = await get(tam.token, { week: WEEK, today: TODAY });
    expect(res.status).toBe(200);
    expect(res.body.customers.some((c: any) => c.id === customer.id)).toBe(false);
    expect(res.body.coverage[TODAY].total).toBe(0);
  });

  it("coverage total equals the number of customer groups on the page (owned + attached)", async () => {
    const tam = await createUserWithRole("TAM");
    const otherTam = await createUserWithRole("TAM");
    const owned = await createCustomer({ tamId: tam.userId, name: uniq("Coverage Owned") });
    await createProject({ tamId: tam.userId, customerId: owned.id, status: "ACTIVE", name: uniq("Owned Active") });
    const attached = await createCustomer({ tamId: otherTam.userId, name: uniq("Coverage Attached") });
    await createProject({ tamId: tam.userId, customerId: attached.id, status: "ACTIVE", name: uniq("Attached Active") });

    const res = await get(tam.token, { week: WEEK, today: TODAY });
    expect(res.status).toBe(200);
    expect(res.body.customers).toHaveLength(2);
    expect(res.body.coverage[TODAY].total).toBe(2);
  });

  it("a project the caller is a member of (not TAM) surfaces under its customer, and stops when removed", async () => {
    const member = await createUserWithRole("TAM");
    const otherTam = await createUserWithRole("TAM");
    const customer = await createCustomer({ tamId: otherTam.userId, name: uniq("Member Customer") });
    const project = await createProject({ tamId: otherTam.userId, customerId: customer.id, status: "ACTIVE", name: uniq("Member Proj") });
    await prisma.projectMember.create({ data: { projectId: project.id, userId: member.userId } });

    const res = await get(member.token, { week: WEEK, today: TODAY });
    expect(res.status).toBe(200);
    const cust = res.body.customers.find((c: any) => c.id === customer.id);
    expect(cust).toBeDefined();
    expect(cust.projects.map((p: any) => p.id)).toEqual([project.id]);
    expect(res.body.coverage[TODAY].total).toBe(1);

    await prisma.projectMember.deleteMany({ where: { projectId: project.id } });
    const after = await get(member.token, { week: WEEK, today: TODAY });
    expect(after.body.customers.some((c: any) => c.id === customer.id)).toBe(false);
  });

  it("a customerless project the caller is a member of lands in the No customer group; a PLANNING one does not", async () => {
    const member = await createUserWithRole("TAM");
    const otherTam = await createUserWithRole("TAM");
    const active = await createProject({ tamId: otherTam.userId, status: "ACTIVE", name: uniq("Member No Customer") });
    const planning = await createProject({ tamId: otherTam.userId, status: "PLANNING", name: uniq("Member Planning") });
    await prisma.projectMember.createMany({
      data: [
        { projectId: active.id, userId: member.userId },
        { projectId: planning.id, userId: member.userId },
      ],
    });

    const res = await get(member.token, { week: WEEK, today: TODAY });
    expect(res.status).toBe(200);
    const ids = res.body.unassignedProjects.map((p: any) => p.id);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(planning.id);
  });

  it("a member's other projects of the same customer that they are not on stay out", async () => {
    const member = await createUserWithRole("TAM");
    const otherTam = await createUserWithRole("TAM");
    const customer = await createCustomer({ tamId: otherTam.userId, name: uniq("Member Partial Customer") });
    const mine = await createProject({ tamId: otherTam.userId, customerId: customer.id, status: "ACTIVE", name: uniq("Mine") });
    const notMine = await createProject({ tamId: otherTam.userId, customerId: customer.id, status: "ACTIVE", name: uniq("Not Mine") });
    await prisma.projectMember.create({ data: { projectId: mine.id, userId: member.userId } });

    const res = await get(member.token, { week: WEEK, today: TODAY });
    const ids = allProjectDtos(res.body).map((p: any) => p.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(notMine.id);
  });

  it("ADMIN (wildcard) sees every ACTIVE project", async () => {
    const admin = await createAdminAndToken();
    const tam = await createUserWithRole("TAM");
    await createProject({ tamId: tam.userId, status: "ACTIVE", name: "Visible To Admin" });

    const res = await get(admin.token, { week: WEEK, today: TODAY });
    expect(res.status).toBe(200);
    expect(allProjectDtos(res.body).map((p) => p.name)).toContain("Visible To Admin");
  });

  it("AUDITOR (project:view-all) sees all ACTIVE projects and every tamId-set customer", async () => {
    const stakeholder = await createUserWithRole("AUDITOR");
    const tam = await createUserWithRole("TAM");
    const customer = await createCustomer({ tamId: tam.userId, name: uniq("Stakeholder Customer") });
    await createProject({ tamId: tam.userId, status: "ACTIVE", customerId: customer.id, name: "Stakeholder Visible" });
    // A customer with a TAM set but no active project must still show for a
    // view-all user (Decision 8's "union every customer with tamId set").
    const orphanCustomer = await createCustomer({ tamId: tam.userId, name: uniq("Orphan Customer") });

    const res = await get(stakeholder.token, { week: WEEK, today: TODAY });
    expect(res.status).toBe(200);
    const customerIds = res.body.customers.map((c: any) => c.id);
    expect(customerIds).toContain(customer.id);
    expect(customerIds).toContain(orphanCustomer.id);
    expect(allProjectDtos(res.body).map((p: any) => p.name)).toContain("Stakeholder Visible");
  });
});

describe("GET /daily-review — week/today validation", () => {
  it.each(["2025-W53", "2026-W00", "2026-W54", "2026-35"])(
    "400 invalid_week for %s",
    async (week) => {
      const tam = await createUserWithRole("TAM");
      const res = await get(tam.token, { week, today: TODAY });
      expect(res.status).toBe(400);
    },
  );

  it("400 when today is missing", async () => {
    const tam = await createUserWithRole("TAM");
    const res = await request(app)
      .get("/daily-review")
      .query({ week: WEEK })
      .set("Authorization", `Bearer ${tam.token}`);
    expect(res.status).toBe(400);
  });

  it("400 when today is invalid", async () => {
    const tam = await createUserWithRole("TAM");
    const res = await get(tam.token, { week: WEEK, today: "not-a-day" });
    expect(res.status).toBe(400);
  });

  it("accepts 2026-W53 (a valid 53rd ISO week)", async () => {
    const tam = await createUserWithRole("TAM");
    const res = await get(tam.token, { week: "2026-W53", today: "2026-12-29" });
    expect(res.status).toBe(200);
    expect(res.body.week.key).toBe("2026-W53");
    expect(res.body.week.days).toHaveLength(7);
  });

  it("week.days, week.start, and today are bare yyyy-MM-dd day strings, not instants", async () => {
    const tam = await createUserWithRole("TAM");
    const res = await get(tam.token, { week: WEEK, today: TODAY });
    expect(res.status).toBe(200);
    expect(res.body.today).toBe(TODAY);
    expect(res.body.today).toMatch(DAY_STRING_RE);
    expect(res.body.week.start).toMatch(DAY_STRING_RE);
    expect(res.body.week.days).toHaveLength(7);
    for (const day of res.body.week.days) {
      expect(day).toMatch(DAY_STRING_RE);
    }
  });
});

describe("GET /daily-review — unassigned projects", () => {
  it("a customerId:null project lands in unassignedProjects, not under any customer", async () => {
    const tam = await createUserWithRole("TAM");
    const project = await createProject({ tamId: tam.userId, status: "ACTIVE", customerId: null, name: "No Customer Proj" });

    const res = await get(tam.token, { week: WEEK, today: TODAY });
    expect(res.status).toBe(200);
    expect(res.body.unassignedProjects.some((p: any) => p.id === project.id)).toBe(true);
    for (const c of res.body.customers) {
      expect(c.projects.some((p: any) => p.id === project.id)).toBe(false);
    }
  });
});

describe("GET /daily-review — coverage (Decision 20: per customer)", () => {
  it("counts a customer once even when two of its projects are noted the same day, and emits all 7 days", async () => {
    const tam = await createUserWithRole("TAM");
    const customer = await createCustomer({ tamId: tam.userId, name: uniq("Coverage Customer") });
    const p1 = await createProject({ tamId: tam.userId, customerId: customer.id, status: "ACTIVE", name: uniq("P1") });
    const p2 = await createProject({ tamId: tam.userId, customerId: customer.id, status: "ACTIVE", name: uniq("P2") });
    const day = "2026-08-25";
    await prisma.projectNote.create({
      data: { projectId: p1.id, authorId: tam.userId, body: "n1", noteDate: new Date(dayInstant(day)) },
    });
    await prisma.projectNote.create({
      data: { projectId: p1.id, authorId: tam.userId, body: "n1b", noteDate: new Date(dayInstant(day)) },
    });
    await prisma.projectNote.create({
      data: { projectId: p2.id, authorId: tam.userId, body: "n2", noteDate: new Date(dayInstant(day)) },
    });

    const res = await get(tam.token, { week: WEEK, today: TODAY });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.coverage)).toHaveLength(7);
    // One customer, both projects noted the same day → counts once, not twice.
    expect(res.body.coverage[day]).toEqual({ withNote: 1, total: 1 });
    expect(res.body.coverage["2026-08-24"]).toEqual({ withNote: 0, total: 1 });

    // Pin the wire shape: a ProjectNote's `noteDate` ships as the
    // UTC-midnight instant of the day it was written for, not the bare day
    // string used for `week.days`/`today`.
    const cust = res.body.customers.find((c: any) => c.id === customer.id);
    const p1Dto = cust.projects.find((p: any) => p.id === p1.id);
    expect(p1Dto.notes).toHaveLength(2);
    for (const note of p1Dto.notes) {
      expect(note.noteDate).toBe(dayInstant(day));
    }
  });

  it("counts a customer via an operations note alone, with no project note", async () => {
    const tam = await createUserWithRole("TAM");
    const customer = await createCustomer({ tamId: tam.userId, name: uniq("Ops Only Customer") });
    const day = "2026-08-26";
    await prisma.customerNote.create({
      data: {
        customerId: customer.id,
        authorId: tam.userId,
        body: "ops",
        title: "Ops issue",
        noteDate: new Date(dayInstant(day)),
      },
    });

    const res = await get(tam.token, { week: WEEK, today: TODAY });
    expect(res.status).toBe(200);
    expect(res.body.coverage[day]).toEqual({ withNote: 1, total: 1 });
  });

  it("does not count a note on an unassigned (customerId: null) project", async () => {
    const tam = await createUserWithRole("TAM");
    const day = "2026-08-27";
    const project = await createProject({ tamId: tam.userId, status: "ACTIVE", customerId: null, name: uniq("Unassigned") });
    await prisma.projectNote.create({
      data: { projectId: project.id, authorId: tam.userId, body: "n", noteDate: new Date(dayInstant(day)) },
    });

    const res = await get(tam.token, { week: WEEK, today: TODAY });
    expect(res.status).toBe(200);
    // No customer at all in this TAM's scope, so total is 0 and the
    // unassigned project's note contributes nothing to withNote.
    expect(res.body.coverage[day]).toEqual({ withNote: 0, total: 0 });
  });

  it("total is the number of customers on the page, not the number of projects", async () => {
    const tam = await createUserWithRole("TAM");
    const c1 = await createCustomer({ tamId: tam.userId, name: uniq("C1") });
    const c2 = await createCustomer({ tamId: tam.userId, name: uniq("C2") });
    // c1 gets two projects, c2 gets none — c2 still counts toward total
    // (Decision 20: total is customers on the page, not customers with
    // projects).
    await createProject({ tamId: tam.userId, customerId: c1.id, status: "ACTIVE", name: uniq("P1") });
    await createProject({ tamId: tam.userId, customerId: c1.id, status: "ACTIVE", name: uniq("P2") });

    const res = await get(tam.token, { week: WEEK, today: TODAY });
    expect(res.status).toBe(200);
    expect(res.body.coverage[TODAY].total).toBe(2);
  });
});

describe("GET /daily-review — overdue boundary", () => {
  it("uses `today`: due yesterday is overdue, due today is not, DONE is never overdue", async () => {
    const tam = await createUserWithRole("TAM");
    const project = await createProject({ tamId: tam.userId, status: "ACTIVE", name: "Overdue Proj" });
    const yesterdayTask = await prisma.task.create({
      data: { projectId: project.id, title: "Yesterday", status: "TODO", dueDate: new Date("2026-08-27T00:00:00.000Z") },
    });
    const todayTask = await prisma.task.create({
      data: { projectId: project.id, title: "Today", status: "TODO", dueDate: new Date("2026-08-28T00:00:00.000Z") },
    });
    const doneYesterdayTask = await prisma.task.create({
      data: { projectId: project.id, title: "DoneYesterday", status: "DONE", dueDate: new Date("2026-08-27T00:00:00.000Z") },
    });

    const res = await get(tam.token, { week: WEEK, today: TODAY });
    expect(res.status).toBe(200);
    const dto = res.body.unassignedProjects.find((p: any) => p.id === project.id);
    const overdueIds = dto.overdueTasks.map((t: any) => t.id);
    expect(overdueIds).toContain(yesterdayTask.id);
    expect(overdueIds).not.toContain(todayTask.id);
    expect(overdueIds).not.toContain(doneYesterdayTask.id);
  });
});

describe("GET /daily-review — phase, progress, slipDays", () => {
  it("phase is the lowest-position unfinished section; slipDays is null without a baseline lock, then the day delta once locked", async () => {
    const tam = await createUserWithRole("TAM");
    const project = await createProject({ tamId: tam.userId, status: "ACTIVE", name: "Phase Proj" });
    const design = await prisma.section.create({ data: { projectId: project.id, name: "Design", position: 0 } });
    const build = await prisma.section.create({ data: { projectId: project.id, name: "Build", position: 1 } });
    await prisma.task.create({ data: { projectId: project.id, sectionId: design.id, title: "t1", status: "DONE" } });
    const t2 = await prisma.task.create({ data: { projectId: project.id, sectionId: build.id, title: "t2", status: "TODO" } });
    await prisma.task.create({ data: { projectId: project.id, sectionId: build.id, title: "t3", status: "DONE" } });

    let res = await get(tam.token, { week: WEEK, today: TODAY });
    let dto = res.body.unassignedProjects.find((p: any) => p.id === project.id);
    expect(dto.phase).toBe("Build");
    expect(dto.progress).toEqual({ done: 2, total: 3 });
    expect(dto.slipDays).toBeNull();

    await prisma.project.update({ where: { id: project.id }, data: { baselineLockedAt: new Date() } });
    await prisma.task.update({
      where: { id: t2.id },
      data: {
        baselineDueDate: new Date("2026-08-20T00:00:00.000Z"),
        dueDate: new Date("2026-08-25T00:00:00.000Z"),
      },
    });

    res = await get(tam.token, { week: WEEK, today: TODAY });
    dto = res.body.unassignedProjects.find((p: any) => p.id === project.id);
    expect(dto.slipDays).toBe(5);
  });

  it("phase is 'All phases complete' when every section is done, and '—' when there are no sections", async () => {
    const tam = await createUserWithRole("TAM");
    const noSections = await createProject({ tamId: tam.userId, status: "ACTIVE", name: "No Sections" });
    await prisma.task.create({ data: { projectId: noSections.id, title: "loose", status: "TODO" } });

    const allDone = await createProject({ tamId: tam.userId, status: "ACTIVE", name: "All Done" });
    const onlySection = await prisma.section.create({ data: { projectId: allDone.id, name: "Only", position: 0 } });
    await prisma.task.create({ data: { projectId: allDone.id, sectionId: onlySection.id, title: "t", status: "DONE" } });

    const res = await get(tam.token, { week: WEEK, today: TODAY });
    const noSectionsDto = res.body.unassignedProjects.find((p: any) => p.id === noSections.id);
    const allDoneDto = res.body.unassignedProjects.find((p: any) => p.id === allDone.id);
    expect(noSectionsDto.phase).toBe("—");
    expect(allDoneDto.phase).toBe("All phases complete");
  });
});

describe("GET /daily-review — weeklyUpdate", () => {
  it("is null when no row exists for the week, and reflects the row once saved", async () => {
    const tam = await createUserWithRole("TAM");
    const customer = await createCustomer({ tamId: tam.userId, name: uniq("WU Customer") });
    await createProject({ tamId: tam.userId, status: "ACTIVE", customerId: customer.id, name: "WU Proj" });

    let res = await get(tam.token, { week: WEEK, today: TODAY });
    let cust = res.body.customers.find((c: any) => c.id === customer.id);
    expect(cust.weeklyUpdate).toBeNull();

    await prisma.weeklyUpdate.create({
      data: {
        customerId: customer.id,
        weekStart: new Date("2026-08-24T00:00:00.000Z"),
        authorId: tam.userId,
        category: "Weekly text",
        status: "DRAFT",
      },
    });

    res = await get(tam.token, { week: WEEK, today: TODAY });
    cust = res.body.customers.find((c: any) => c.id === customer.id);
    expect(cust.weeklyUpdate).not.toBeNull();
    expect(cust.weeklyUpdate.category).toBe("Weekly text");
    expect(cust.weeklyUpdate.status).toBe("DRAFT");
    // Pin the wire shape: weekStart ships as the UTC-midnight instant of
    // week.start's day, not the bare "yyyy-MM-dd" string week.start itself is.
    expect(cust.weeklyUpdate.weekStart).toBe(dayInstant(res.body.week.start));
  });

  it("weeklyUpdate carries every Mid-week field with the stored values, and no removed Reflection key", async () => {
    const tam = await createUserWithRole("TAM");
    const customer = await createCustomer({ tamId: tam.userId, name: uniq("WU Full Customer") });
    await createProject({ tamId: tam.userId, status: "ACTIVE", customerId: customer.id, name: "WU Full Proj" });
    const midweekSavedAt = new Date("2026-08-26T09:00:00.000Z");

    await prisma.weeklyUpdate.create({
      data: {
        customerId: customer.id,
        weekStart: new Date("2026-08-24T00:00:00.000Z"),
        authorId: tam.userId,
        health: "GREEN",
        status: "DONE",
        category: "Onboarding",
        midweekSavedAt,
      },
    });

    const res = await get(tam.token, { week: WEEK, today: TODAY });
    const cust = res.body.customers.find((c: any) => c.id === customer.id);
    expect(cust.weeklyUpdate).toMatchObject({
      health: "GREEN",
      status: "DONE",
      category: "Onboarding",
      highlights: [],
      achievements: [],
      midweekSavedAt: midweekSavedAt.toISOString(),
    });
    expect(cust.weeklyUpdate.body).toBeUndefined();
    // The five old Reflection free-text columns are gone from the wire
    // shape — a Reflection achievement is a WeeklyAchievement row now, not
    // a field on the week.
    expect(cust.weeklyUpdate.achievement).toBeUndefined();
    expect(cust.weeklyUpdate.outstandingIssue).toBeUndefined();
    expect(cust.weeklyUpdate.lessonLearned).toBeUndefined();
    expect(cust.weeklyUpdate.nextWeekFocus).toBeUndefined();
    expect(cust.weeklyUpdate.managerDecision).toBeUndefined();
    // The old Mid-week free-text columns are also gone — a highlight is a
    // `WeeklyHighlight` row now, not a field on the week.
    expect(cust.weeklyUpdate.highlight).toBeUndefined();
    expect(cust.weeklyUpdate.risk).toBeUndefined();
    expect(cust.weeklyUpdate.action).toBeUndefined();
  });

  it("previousWeeklyUpdate is null when no row exists for the previous week", async () => {
    const tam = await createUserWithRole("TAM");
    const customer = await createCustomer({ tamId: tam.userId, name: uniq("No Prev WU Customer") });
    await createProject({ tamId: tam.userId, status: "ACTIVE", customerId: customer.id, name: "No Prev WU Proj" });

    const res = await get(tam.token, { week: WEEK, today: TODAY });
    const cust = res.body.customers.find((c: any) => c.id === customer.id);
    expect(cust.previousWeeklyUpdate).toBeNull();
  });

  it("previousWeeklyUpdate carries weekStart and an empty achievements list from the row 7 days back, and ignores a row two weeks back", async () => {
    const tam = await createUserWithRole("TAM");
    const customer = await createCustomer({ tamId: tam.userId, name: uniq("Prev WU Customer") });
    await createProject({ tamId: tam.userId, status: "ACTIVE", customerId: customer.id, name: "Prev WU Proj" });

    // WEEK's Monday is 2026-08-24, so the previous week's Monday is
    // 2026-08-17 and two weeks back is 2026-08-10.
    await prisma.weeklyUpdate.create({
      data: {
        customerId: customer.id,
        weekStart: new Date("2026-08-17T00:00:00.000Z"),
        authorId: tam.userId,
        status: "DONE",
        health: "AMBER",
      },
    });
    await prisma.weeklyUpdate.create({
      data: {
        customerId: customer.id,
        weekStart: new Date("2026-08-10T00:00:00.000Z"),
        authorId: tam.userId,
        status: "DONE",
        health: "GREEN",
      },
    });

    const res = await get(tam.token, { week: WEEK, today: TODAY });
    const cust = res.body.customers.find((c: any) => c.id === customer.id);
    expect(cust.previousWeeklyUpdate).toEqual({
      weekStart: dayInstant("2026-08-17"),
      achievements: [],
    });
    expect(Object.keys(cust.previousWeeklyUpdate).sort()).toEqual(["achievements", "weekStart"]);
  });

  it("previousWeeklyUpdate.achievements is [] when last week's row has an achievement, but it carries none of the three carry-over texts", async () => {
    const tam = await createUserWithRole("TAM");
    const customer = await createCustomer({ tamId: tam.userId, name: uniq("Prev WU No Carryover Customer") });
    await createProject({ tamId: tam.userId, status: "ACTIVE", customerId: customer.id, name: "Prev WU No Carryover Proj" });
    const prevWeek = await prisma.weeklyUpdate.create({
      data: {
        customerId: customer.id,
        weekStart: new Date("2026-08-17T00:00:00.000Z"),
        authorId: tam.userId,
        status: "DONE",
        health: "GREEN",
      },
    });
    // Only a lesson learned — none of outstandingIssue/nextWeekFocus/
    // managerDecision — so this row must be filtered out.
    await prisma.weeklyAchievement.create({
      data: {
        weeklyUpdateId: prevWeek.id,
        position: 0,
        title: "Lesson only",
        lessonLearned: "Learned something",
      },
    });

    const res = await get(tam.token, { week: WEEK, today: TODAY });
    const cust = res.body.customers.find((c: any) => c.id === customer.id);
    expect(cust.previousWeeklyUpdate).toEqual({
      weekStart: dayInstant("2026-08-17"),
      achievements: [],
    });
  });

  it("previousWeeklyUpdate.achievements keeps only the rows with an outstanding issue, next-week focus, or decision, in position order, with exactly four keys each", async () => {
    const tam = await createUserWithRole("TAM");
    const customer = await createCustomer({ tamId: tam.userId, name: uniq("Prev WU Carryover Customer") });
    await createProject({ tamId: tam.userId, status: "ACTIVE", customerId: customer.id, name: "Prev WU Carryover Proj" });
    const prevWeek = await prisma.weeklyUpdate.create({
      data: {
        customerId: customer.id,
        weekStart: new Date("2026-08-17T00:00:00.000Z"),
        authorId: tam.userId,
        status: "DONE",
        health: "GREEN",
      },
    });
    // Position 0: lesson learned only — excluded.
    await prisma.weeklyAchievement.create({
      data: {
        weeklyUpdateId: prevWeek.id,
        position: 0,
        title: "Excluded",
        lessonLearned: "Learned something",
      },
    });
    // Position 1: an outstanding issue — included.
    await prisma.weeklyAchievement.create({
      data: {
        weeklyUpdateId: prevWeek.id,
        position: 1,
        title: "Has issue",
        outstandingIssue: "Still open",
      },
    });
    // Position 2: a manager decision — included.
    await prisma.weeklyAchievement.create({
      data: {
        weeklyUpdateId: prevWeek.id,
        position: 2,
        title: "Needs decision",
        managerDecision: "Pick a vendor",
      },
    });

    const res = await get(tam.token, { week: WEEK, today: TODAY });
    const cust = res.body.customers.find((c: any) => c.id === customer.id);
    expect(cust.previousWeeklyUpdate.achievements).toEqual([
      {
        title: "Has issue",
        outstandingIssue: "Still open",
        nextWeekFocus: null,
        managerDecision: null,
      },
      {
        title: "Needs decision",
        outstandingIssue: null,
        nextWeekFocus: null,
        managerDecision: "Pick a vendor",
      },
    ]);
    for (const a of cust.previousWeeklyUpdate.achievements) {
      expect(Object.keys(a).sort()).toEqual(
        ["title", "outstandingIssue", "nextWeekFocus", "managerDecision"].sort(),
      );
    }
  });
});

describe("GET /daily-review — weeklyUpdate.highlights", () => {
  it("comes back ordered by position (not insertion order), with exactly the six fields per item", async () => {
    const tam = await createUserWithRole("TAM");
    const customer = await createCustomer({ tamId: tam.userId, name: uniq("Highlights Customer") });
    await createProject({ tamId: tam.userId, status: "ACTIVE", customerId: customer.id, name: "Highlights Proj" });
    const weeklyUpdate = await prisma.weeklyUpdate.create({
      data: {
        customerId: customer.id,
        weekStart: new Date("2026-08-24T00:00:00.000Z"),
        authorId: tam.userId,
        status: "DRAFT",
      },
    });
    // Inserted out of order (position 1 first, then 0) to prove the response
    // is sorted by `position`, not by creation/insertion order.
    await prisma.weeklyHighlight.create({
      data: {
        weeklyUpdateId: weeklyUpdate.id,
        position: 1,
        title: "Second highlight",
        detail: "Detail two",
        risk: "Risk two",
        action: "Action two",
      },
    });
    const first = await prisma.weeklyHighlight.create({
      data: {
        weeklyUpdateId: weeklyUpdate.id,
        position: 0,
        title: "First highlight",
        detail: null,
        risk: null,
        action: null,
      },
    });

    const res = await get(tam.token, { week: WEEK, today: TODAY });
    const cust = res.body.customers.find((c: any) => c.id === customer.id);
    expect(cust.weeklyUpdate.highlights.map((h: any) => h.title)).toEqual([
      "First highlight",
      "Second highlight",
    ]);
    expect(cust.weeklyUpdate.highlights[0]).toEqual({
      id: first.id,
      position: 0,
      title: "First highlight",
      detail: null,
      risk: null,
      action: null,
    });
    expect(Object.keys(cust.weeklyUpdate.highlights[0]).sort()).toEqual(
      ["id", "position", "title", "detail", "risk", "action"].sort(),
    );
  });

  it("a customer without a weekly update still gives weeklyUpdate: null", async () => {
    const tam = await createUserWithRole("TAM");
    const withHighlights = await createCustomer({ tamId: tam.userId, name: uniq("Has Highlights") });
    await createProject({ tamId: tam.userId, status: "ACTIVE", customerId: withHighlights.id, name: "Has Highlights Proj" });
    const weeklyUpdate = await prisma.weeklyUpdate.create({
      data: {
        customerId: withHighlights.id,
        weekStart: new Date("2026-08-24T00:00:00.000Z"),
        authorId: tam.userId,
        status: "DRAFT",
      },
    });
    await prisma.weeklyHighlight.create({
      data: { weeklyUpdateId: weeklyUpdate.id, position: 0, title: "Only highlight" },
    });
    const noUpdate = await createCustomer({ tamId: tam.userId, name: uniq("No Weekly Update") });
    await createProject({ tamId: tam.userId, status: "ACTIVE", customerId: noUpdate.id, name: "No WU Proj" });

    const res = await get(tam.token, { week: WEEK, today: TODAY });
    const custWithHighlights = res.body.customers.find((c: any) => c.id === withHighlights.id);
    const custNoUpdate = res.body.customers.find((c: any) => c.id === noUpdate.id);
    expect(custWithHighlights.weeklyUpdate.highlights).toHaveLength(1);
    expect(custNoUpdate.weeklyUpdate).toBeNull();
  });
});

describe("GET /daily-review — weeklyUpdate.achievements", () => {
  it("comes back ordered by position (not insertion order), with exactly the eight fields per item and none of the old top-level keys", async () => {
    const tam = await createUserWithRole("TAM");
    const customer = await createCustomer({ tamId: tam.userId, name: uniq("Achievements Customer") });
    await createProject({ tamId: tam.userId, status: "ACTIVE", customerId: customer.id, name: "Achievements Proj" });
    const weeklyUpdate = await prisma.weeklyUpdate.create({
      data: {
        customerId: customer.id,
        weekStart: new Date("2026-08-24T00:00:00.000Z"),
        authorId: tam.userId,
        status: "DRAFT",
      },
    });
    // Inserted out of order (position 1 first, then 0) to prove the response
    // is sorted by `position`, not by creation/insertion order.
    await prisma.weeklyAchievement.create({
      data: {
        weeklyUpdateId: weeklyUpdate.id,
        position: 1,
        title: "Second achievement",
        detail: "Detail two",
        outstandingIssue: "Issue two",
        lessonLearned: "Lesson two",
        nextWeekFocus: "Focus two",
        managerDecision: "Decision two",
      },
    });
    const first = await prisma.weeklyAchievement.create({
      data: {
        weeklyUpdateId: weeklyUpdate.id,
        position: 0,
        title: "First achievement",
        detail: null,
        outstandingIssue: null,
        lessonLearned: null,
        nextWeekFocus: null,
        managerDecision: null,
      },
    });

    const res = await get(tam.token, { week: WEEK, today: TODAY });
    const cust = res.body.customers.find((c: any) => c.id === customer.id);
    expect(cust.weeklyUpdate.achievements.map((a: any) => a.title)).toEqual([
      "First achievement",
      "Second achievement",
    ]);
    expect(cust.weeklyUpdate.achievements[0]).toEqual({
      id: first.id,
      position: 0,
      title: "First achievement",
      detail: null,
      outstandingIssue: null,
      lessonLearned: null,
      nextWeekFocus: null,
      managerDecision: null,
    });
    expect(Object.keys(cust.weeklyUpdate.achievements[0]).sort()).toEqual(
      ["id", "position", "title", "detail", "outstandingIssue", "lessonLearned", "nextWeekFocus", "managerDecision"].sort(),
    );
    // The five removed top-level Reflection columns never resurface on the
    // week itself — they live only on each achievement row now.
    expect(cust.weeklyUpdate.achievement).toBeUndefined();
    expect(cust.weeklyUpdate.outstandingIssue).toBeUndefined();
    expect(cust.weeklyUpdate.lessonLearned).toBeUndefined();
    expect(cust.weeklyUpdate.nextWeekFocus).toBeUndefined();
    expect(cust.weeklyUpdate.managerDecision).toBeUndefined();
  });

  it("a customer without a weekly update still gives weeklyUpdate: null", async () => {
    const tam = await createUserWithRole("TAM");
    const withAchievements = await createCustomer({ tamId: tam.userId, name: uniq("Has Achievements") });
    await createProject({ tamId: tam.userId, status: "ACTIVE", customerId: withAchievements.id, name: "Has Achievements Proj" });
    const weeklyUpdate = await prisma.weeklyUpdate.create({
      data: {
        customerId: withAchievements.id,
        weekStart: new Date("2026-08-24T00:00:00.000Z"),
        authorId: tam.userId,
        status: "DRAFT",
      },
    });
    await prisma.weeklyAchievement.create({
      data: { weeklyUpdateId: weeklyUpdate.id, position: 0, title: "Only achievement" },
    });
    const noUpdate = await createCustomer({ tamId: tam.userId, name: uniq("No Weekly Update For Achievements") });
    await createProject({ tamId: tam.userId, status: "ACTIVE", customerId: noUpdate.id, name: "No WU Achievements Proj" });

    const res = await get(tam.token, { week: WEEK, today: TODAY });
    const custWithAchievements = res.body.customers.find((c: any) => c.id === withAchievements.id);
    const custNoUpdate = res.body.customers.find((c: any) => c.id === noUpdate.id);
    expect(custWithAchievements.weeklyUpdate.achievements).toHaveLength(1);
    expect(custNoUpdate.weeklyUpdate).toBeNull();
  });
});

describe("GET /daily-review — operationsNotes", () => {
  it("carry the note's title, and the customer DTO has no services key", async () => {
    const tam = await createUserWithRole("TAM");
    const customer = await createCustomer({ tamId: tam.userId, name: uniq("Ops Customer") });
    const noteDay = "2026-08-26";
    await prisma.customerNote.create({
      data: {
        customerId: customer.id,
        authorId: tam.userId,
        noteDate: new Date(dayInstant(noteDay)),
        body: "ops note",
        title: "Backup restore ticket",
      },
    });

    const res = await get(tam.token, { week: WEEK, today: TODAY });
    const cust = res.body.customers.find((c: any) => c.id === customer.id);
    expect(cust.operationsNotes).toHaveLength(1);
    expect(cust.operationsNotes[0].title).toBe("Backup restore ticket");
    // Pin the wire shape: noteDate ships as the UTC-midnight instant of the
    // day the note was written for.
    expect(cust.operationsNotes[0].noteDate).toBe(dayInstant(noteDay));
    // The service select is gone (Decision 4) — the customer DTO no longer
    // carries a `services` list at all.
    expect(cust.services).toBeUndefined();
  });
});

describe("GET /daily-review — reviews", () => {
  it("only include the requesting user's own review rows for the week", async () => {
    const tam = await createUserWithRole("TAM");
    const otherTam = await createUserWithRole("TAM");
    const project = await createProject({ tamId: tam.userId, status: "ACTIVE", name: "Review Proj" });
    const reviewDay = "2026-08-26";
    await prisma.projectReview.create({
      data: { projectId: project.id, userId: tam.userId, reviewDate: new Date(dayInstant(reviewDay)) },
    });
    await prisma.projectReview.create({
      data: { projectId: project.id, userId: otherTam.userId, reviewDate: new Date(dayInstant(reviewDay)) },
    });

    const res = await get(tam.token, { week: WEEK, today: TODAY });
    const dto = res.body.unassignedProjects.find((p: any) => p.id === project.id);
    expect(dto.reviews).toHaveLength(1);
    // Pin the wire shape: reviewDate ships as the UTC-midnight instant of
    // the day reviewed, not a bare "yyyy-MM-dd" string.
    expect(dto.reviews[0].reviewDate).toBe(dayInstant(reviewDay));
  });
});

describe("GET /daily-review — customer ordering", () => {
  it("sorts customers by name ascending", async () => {
    const tam = await createUserWithRole("TAM");
    const custB = await createCustomer({ tamId: tam.userId, name: uniq("B-Customer") });
    const custA = await createCustomer({ tamId: tam.userId, name: uniq("A-Customer") });
    await createProject({ tamId: tam.userId, status: "ACTIVE", customerId: custB.id, name: "P-B" });
    await createProject({ tamId: tam.userId, status: "ACTIVE", customerId: custA.id, name: "P-A" });

    const res = await get(tam.token, { week: WEEK, today: TODAY });
    const names: string[] = res.body.customers.map((c: any) => c.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });
});
