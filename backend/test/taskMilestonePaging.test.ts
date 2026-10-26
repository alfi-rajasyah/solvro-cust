import "./env.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { createUserWithRole, seedRoles } from "./testAuth.js";

// PATCH /tasks/:id must never leave a milestone without a due date, and
// GET /tasks must be pageable past its 200-row page via ?offset.

const app = createApp();

beforeAll(async () => {
  await seedRoles();
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function fixture() {
  const tam = await createUserWithRole("TAM");
  const project = await prisma.project.create({
    data: { name: `MP ${Date.now()}-${Math.random()}`, tamId: tam.userId, status: "ACTIVE" },
  });
  return { token: tam.token, projectId: project.id };
}

describe("PATCH /tasks/:id milestone needs a due date", () => {
  it("rejects flagging an undated task as a milestone", async () => {
    const { token, projectId } = await fixture();
    const t = await prisma.task.create({ data: { projectId, title: "Undated" } });
    const res = await request(app)
      .patch(`/tasks/${t.id}`)
      .set(auth(token))
      .send({ isMilestone: true });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation_error");
    expect(res.body.error).toBe("A milestone requires a due date");
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).isMilestone).toBe(false);
  });

  it("rejects clearing the due date of a milestone", async () => {
    const { token, projectId } = await fixture();
    const due = new Date("2026-11-05T00:00:00.000Z");
    const t = await prisma.task.create({
      data: { projectId, title: "MS", isMilestone: true, dueDate: due, startDate: due },
    });
    const res = await request(app)
      .patch(`/tasks/${t.id}`)
      .set(auth(token))
      .send({ dueDate: null });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("A milestone requires a due date");
    expect(res.body.details.fieldErrors.dueDate).toEqual(["A milestone requires a due date"]);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).dueDate).toEqual(due);
  });

  it("still allows valid milestone changes", async () => {
    const { token, projectId } = await fixture();
    const dated = await prisma.task.create({
      data: { projectId, title: "Dated", dueDate: new Date("2026-11-05T00:00:00.000Z") },
    });
    expect(
      (await request(app).patch(`/tasks/${dated.id}`).set(auth(token)).send({ isMilestone: true }))
        .status,
    ).toBe(200);
    const undated = await prisma.task.create({ data: { projectId, title: "U2" } });
    expect(
      (
        await request(app)
          .patch(`/tasks/${undated.id}`)
          .set(auth(token))
          .send({ isMilestone: true, dueDate: "2026-12-01" })
      ).status,
    ).toBe(200);
    // Un-flagging while clearing the date, and clearing a non-milestone date.
    expect(
      (
        await request(app)
          .patch(`/tasks/${dated.id}`)
          .set(auth(token))
          .send({ isMilestone: false, dueDate: null })
      ).status,
    ).toBe(200);
    // Unrelated edit of a legacy undated milestone is not blocked.
    const legacy = await prisma.task.create({ data: { projectId, title: "Legacy", isMilestone: true } });
    expect(
      (await request(app).patch(`/tasks/${legacy.id}`).set(auth(token)).send({ title: "Renamed" }))
        .status,
    ).toBe(200);
  });
});

describe("GET /tasks ?offset", () => {
  it("pages past the 200-row cap with stable order and no overlap", async () => {
    const { token, projectId } = await fixture();
    await prisma.task.createMany({
      data: Array.from({ length: 205 }, (_, i) => ({
        projectId,
        title: `T${i}`,
        position: i % 7, // ties force the id tiebreak
      })),
    });
    const page = async (qs: string) => {
      const res = await request(app).get(`/tasks${qs}`).set(auth(token));
      expect(res.status).toBe(200);
      return { ids: (res.body as Array<{ id: number }>).map((t) => t.id), total: res.headers["x-total-count"] };
    };
    const first = await page("");
    const second = await page("?offset=200");
    expect(first.ids).toHaveLength(200);
    expect(second.ids).toHaveLength(5);
    expect(first.total).toBe("205");
    expect(second.total).toBe("205");
    expect(new Set([...first.ids, ...second.ids]).size).toBe(205);
    const all = await prisma.task.findMany({
      where: { projectId },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    expect([...first.ids, ...second.ids]).toEqual(all.map((t) => t.id));
    expect((await page("?offset=205")).ids).toEqual([]);
  });

  it("rejects an invalid offset", async () => {
    const { token } = await fixture();
    for (const bad of ["-1", "abc", "1.5"]) {
      const res = await request(app).get(`/tasks?offset=${bad}`).set(auth(token));
      expect(res.status).toBe(400);
    }
  });
});
