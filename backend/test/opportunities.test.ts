import "./env.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { signToken } from "../src/http/auth.js";
import { seedRoles } from "./testAuth.js";

const app = createApp();

let roleCounter = 0;

// test/testAuth.ts's SA role mirror already carries the pipeline:* grants,
// in sync with prisma/seed.ts. A one-off role per test isn't a workaround
// for a missing grant — it keeps each test exact about which permission
// combination it exercises (e.g. edit_own vs edit_all) rather than coupling
// to testAuth.ts's fixed SA/Manager shape.
async function createUserWithPermissions(
  permissions: string[],
): Promise<{ userId: number; username: string; token: string }> {
  roleCounter += 1;
  const role = await prisma.role.create({
    data: { roleName: `test-opp-role-${roleCounter}-${Date.now()}`, permissions },
  });
  const username = `test-opp-user-${roleCounter}-${Date.now()}`;
  const user = await prisma.user.create({
    data: {
      username,
      email: `test-opp-user-${roleCounter}-${Date.now()}@example.com`,
      passwordHash: null,
      roleId: role.id,
      active: true,
    },
  });
  const token = signToken({ sub: user.id, role: role.roleName, permissions });
  return { userId: user.id, username: user.username, token };
}

// Mirrors the real SA role's pipeline grants (view/create/edit_own/delete_own).
async function createSaLikeUser(): Promise<{ userId: number; username: string; token: string }> {
  return createUserWithPermissions([
    "pipeline:view",
    "pipeline:create",
    "pipeline:edit_own",
    "pipeline:delete_own",
  ]);
}

// Mirrors the plan's "SA Manager" custom role (edit_all/delete_all, granted
// as explicit strings — not the "*" wildcard — so these tests exercise the
// actual permission-string path, not just hasPermission's wildcard shortcut).
async function createManagerLikeUser(): Promise<{ userId: number; username: string; token: string }> {
  return createUserWithPermissions([
    "pipeline:view",
    "pipeline:create",
    "pipeline:edit_all",
    "pipeline:delete_all",
  ]);
}

function createOpportunity(token: string, body: Record<string, unknown> = {}) {
  return request(app)
    .post("/opportunities")
    .set("Authorization", `Bearer ${token}`)
    .send({ title: "Test Deal", customerName: "Acme Corp", ...body });
}

function getOpportunity(token: string, id: string) {
  return request(app).get(`/opportunities/${id}`).set("Authorization", `Bearer ${token}`);
}

function patchOpportunity(token: string, id: string, body: Record<string, unknown>) {
  return request(app)
    .patch(`/opportunities/${id}`)
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

function moveOpportunity(token: string, id: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/opportunities/${id}/move`)
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

function deleteOpportunity(token: string, id: string) {
  return request(app).delete(`/opportunities/${id}`).set("Authorization", `Bearer ${token}`);
}

function assignOpportunity(token: string, id: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/opportunities/${id}/assign`)
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

async function activitiesFor(opportunityId: string) {
  return prisma.opportunityActivity.findMany({
    where: { opportunityId },
    orderBy: { createdAt: "asc" },
  });
}

beforeAll(async () => {
  await seedRoles();
});

describe("POST /opportunities/:id/move — stage transitions", () => {
  it("sets wonAt on a move into WON and logs a human-readable activity", async () => {
    const sa = await createSaLikeUser();
    const created = await createOpportunity(sa.token, { picId: sa.userId, stage: "ASSESSMENT" });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const moved = await moveOpportunity(sa.token, id, { stage: "WON", stageOrder: 0 });
    expect(moved.status).toBe(200);
    expect(moved.body.stage).toBe("WON");
    expect(moved.body.wonAt).not.toBeNull();

    const activities = await activitiesFor(id);
    expect(activities).toHaveLength(1);
    expect(activities[0].note).toBe("Moved from Assessment to Won");
    expect(activities[0].userId).toBe(sa.userId);
  });

  it("clears wonAt on a move out of WON and logs another activity", async () => {
    const sa = await createSaLikeUser();
    const created = await createOpportunity(sa.token, { picId: sa.userId, stage: "ASSESSMENT" });
    const id = created.body.id as string;
    await moveOpportunity(sa.token, id, { stage: "WON", stageOrder: 0 });

    const movedOut = await moveOpportunity(sa.token, id, { stage: "RFP", stageOrder: 0 });
    expect(movedOut.status).toBe(200);
    expect(movedOut.body.stage).toBe("RFP");
    expect(movedOut.body.wonAt).toBeNull();

    const activities = await activitiesFor(id);
    expect(activities).toHaveLength(2);
    expect(activities[1].note).toBe("Moved from Won to RFP");
  });

  it("a same-stage reorder does not touch wonAt and logs no activity", async () => {
    const sa = await createSaLikeUser();
    // POC rather than RFP: RFP already carries residual rows from this
    // describe block's own earlier "clears wonAt" test (it moves an
    // opportunity INTO Rfp and leaves it there) — bottom-append semantics
    // (S6) make a fresh stage's absolute stageOrder assertions the only
    // reliable ones in a suite that shares one DB across `it` blocks.
    const first = await createOpportunity(sa.token, { picId: sa.userId, stage: "POC" });
    const second = await createOpportunity(sa.token, { picId: sa.userId, stage: "POC" });
    const firstId = first.body.id as string;
    const secondId = second.body.id as string;
    // Both created "at the bottom" of POC: first appended first at
    // stageOrder 0, second lands after it at 1 (S6 — append-at-bottom).
    expect((await getOpportunity(sa.token, firstId)).body.stageOrder).toBe(0);
    expect((await getOpportunity(sa.token, secondId)).body.stageOrder).toBe(1);

    const reordered = await moveOpportunity(sa.token, secondId, { stage: "POC", stageOrder: 0 });
    expect(reordered.status).toBe(200);
    expect(reordered.body.stage).toBe("POC");
    expect(reordered.body.wonAt).toBeNull();
    expect(reordered.body.stageOrder).toBe(0);

    const activities = await activitiesFor(secondId);
    expect(activities).toHaveLength(0);

    // The sibling list re-packed dense 0..1 with second now on top and
    // first pushed down.
    expect((await getOpportunity(sa.token, firstId)).body.stageOrder).toBe(1);
  });
});

describe("PATCH /opportunities/:id — edit_own / edit_all gate", () => {
  it("lets an edit_own holder patch their own deal", async () => {
    const sa = await createSaLikeUser();
    const created = await createOpportunity(sa.token, { picId: sa.userId });
    const id = created.body.id as string;

    const res = await patchOpportunity(sa.token, id, { title: "Renamed Deal" });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Renamed Deal");
  });

  it("403s an edit_own holder patching another PIC's deal", async () => {
    const owner = await createSaLikeUser();
    const other = await createSaLikeUser();
    const created = await createOpportunity(owner.token, { picId: owner.userId });
    const id = created.body.id as string;

    const res = await patchOpportunity(other.token, id, { title: "Hijacked" });
    expect(res.status).toBe(403);

    const stillOriginal = await getOpportunity(owner.token, id);
    expect(stillOriginal.body.title).toBe("Test Deal");
  });

  it("lets an edit_all holder patch any deal regardless of PIC", async () => {
    const owner = await createSaLikeUser();
    const manager = await createManagerLikeUser();
    const created = await createOpportunity(owner.token, { picId: owner.userId });
    const id = created.body.id as string;

    const res = await patchOpportunity(manager.token, id, { title: "Manager Edit" });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Manager Edit");
  });

  it("rejects a PATCH body containing stage with a 400 — stage changes only go through /move", async () => {
    const sa = await createSaLikeUser();
    const created = await createOpportunity(sa.token, { picId: sa.userId, stage: "ASSESSMENT" });
    const id = created.body.id as string;

    const res = await patchOpportunity(sa.token, id, { stage: "WON" });
    expect(res.status).toBe(400);

    const unchanged = await getOpportunity(sa.token, id);
    expect(unchanged.body.stage).toBe("ASSESSMENT");
  });
});

describe("DELETE /opportunities/:id — closes the stage-order gap it leaves (S4)", () => {
  it("re-packs the stage densely after deleting a middle sibling, so the next create/import lands last", async () => {
    const sa = await createSaLikeUser();
    // WAITING_RESPONSE: untouched by any earlier test in this file.
    const first = await createOpportunity(sa.token, { picId: sa.userId, stage: "WAITING_RESPONSE" });
    const middle = await createOpportunity(sa.token, { picId: sa.userId, stage: "WAITING_RESPONSE" });
    const last = await createOpportunity(sa.token, { picId: sa.userId, stage: "WAITING_RESPONSE" });
    const firstId = first.body.id as string;
    const middleId = middle.body.id as string;
    const lastId = last.body.id as string;
    // Appended at the bottom in creation order: first=0, middle=1, last=2.
    expect((await getOpportunity(sa.token, firstId)).body.stageOrder).toBe(0);
    expect((await getOpportunity(sa.token, middleId)).body.stageOrder).toBe(1);
    expect((await getOpportunity(sa.token, lastId)).body.stageOrder).toBe(2);

    const deleted = await deleteOpportunity(sa.token, middleId);
    expect(deleted.status).toBe(204);

    // Without the gap-close, `last` would still sit at stageOrder 2 (a hole
    // at 1) and a naive count()-based append would hand the next row that
    // same slot 2, colliding with `last`.
    expect((await getOpportunity(sa.token, firstId)).body.stageOrder).toBe(0);
    expect((await getOpportunity(sa.token, lastId)).body.stageOrder).toBe(1);

    const created = await createOpportunity(sa.token, { picId: sa.userId, stage: "WAITING_RESPONSE" });
    expect(created.status).toBe(201);
    expect(created.body.stageOrder).toBe(2);

    const imported = await request(app)
      .post("/opportunities/import")
      .set("Authorization", `Bearer ${sa.token}`)
      .send({
        rows: [
          {
            title: "ImpTest S4 Gap",
            customerName: "ImpTest S4 Gap Co",
            stage: "waiting_response",
          },
        ],
      });
    expect(imported.status).toBe(200);
    expect(imported.body.validCount).toBe(1);
    const importedId = imported.body.results[0].id as string;
    expect((await getOpportunity(sa.token, importedId)).body.stageOrder).toBe(3);
  });
});

describe("DELETE /opportunities/:id — delete_own / delete_all gate", () => {
  it("lets a delete_own holder delete their own deal", async () => {
    const sa = await createSaLikeUser();
    const created = await createOpportunity(sa.token, { picId: sa.userId });
    const id = created.body.id as string;

    const res = await deleteOpportunity(sa.token, id);
    expect(res.status).toBe(204);

    const gone = await getOpportunity(sa.token, id);
    expect(gone.status).toBe(404);
  });

  it("403s a delete_own holder deleting another PIC's deal", async () => {
    const owner = await createSaLikeUser();
    const other = await createSaLikeUser();
    const created = await createOpportunity(owner.token, { picId: owner.userId });
    const id = created.body.id as string;

    const res = await deleteOpportunity(other.token, id);
    expect(res.status).toBe(403);

    const stillThere = await getOpportunity(owner.token, id);
    expect(stillThere.status).toBe(200);
  });

  it("lets a delete_all holder delete any deal regardless of PIC", async () => {
    const owner = await createSaLikeUser();
    const manager = await createManagerLikeUser();
    const created = await createOpportunity(owner.token, { picId: owner.userId });
    const id = created.body.id as string;

    const res = await deleteOpportunity(manager.token, id);
    expect(res.status).toBe(204);
  });
});

describe("dealValue BigInt round-trip", () => {
  it("a BigInt dealValue survives POST -> GET as a plain JSON number", async () => {
    const sa = await createSaLikeUser();
    const created = await createOpportunity(sa.token, { dealValue: 250_000_000_000 });
    expect(created.status).toBe(201);
    expect(created.body.dealValue).toBe(250_000_000_000);
    expect(typeof created.body.dealValue).toBe("number");

    const fetched = await getOpportunity(sa.token, created.body.id as string);
    expect(fetched.status).toBe(200);
    expect(fetched.body.dealValue).toBe(250_000_000_000);
    expect(typeof fetched.body.dealValue).toBe("number");
  });

  it("defaults dealValue to 0 when omitted", async () => {
    const sa = await createSaLikeUser();
    const created = await createOpportunity(sa.token, {});
    expect(created.status).toBe(201);
    expect(created.body.dealValue).toBe(0);
  });
});

describe("GET /opportunities — list + view gate", () => {
  it("403s a caller without pipeline:view", async () => {
    const noPerms = await createUserWithPermissions([]);
    const res = await request(app).get("/opportunities").set("Authorization", `Bearer ${noPerms.token}`);
    expect(res.status).toBe(403);
  });

  it("lists opportunities ordered by stage then stageOrder, each with its pic", async () => {
    const sa = await createSaLikeUser();
    const a = await createOpportunity(sa.token, { picId: sa.userId, stage: "RFP", title: "A" });
    const b = await createOpportunity(sa.token, { picId: sa.userId, stage: "ASSESSMENT", title: "B" });

    const res = await request(app).get("/opportunities").set("Authorization", `Bearer ${sa.token}`);
    expect(res.status).toBe(200);
    const ids = (res.body as { id: string }[]).map((o) => o.id);
    // ASSESSMENT sorts before RFP per the enum's declared order.
    expect(ids.indexOf(b.body.id as string)).toBeLessThan(ids.indexOf(a.body.id as string));

    const found = (res.body as { id: string; pic: { id: number } | null }[]).find(
      (o) => o.id === (a.body.id as string),
    );
    expect(found?.pic).toEqual({ id: sa.userId, username: expect.any(String), avatarUrl: null });
  });
});

describe("POST /opportunities/:id/move — permission gate", () => {
  it("403s a non-PIC edit_own holder attempting to move another PIC's deal", async () => {
    const owner = await createSaLikeUser();
    const other = await createSaLikeUser();
    const created = await createOpportunity(owner.token, { picId: owner.userId, stage: "ASSESSMENT" });
    const id = created.body.id as string;

    const res = await moveOpportunity(other.token, id, { stage: "RFP", stageOrder: 0 });
    expect(res.status).toBe(403);
  });
});

describe("deadline / requestDate day-string contract", () => {
  it("round-trips deadline and requestDate through create -> GET as exact yyyy-MM-dd strings", async () => {
    const sa = await createSaLikeUser();
    const created = await createOpportunity(sa.token, {
      deadline: "2026-09-15",
      requestDate: "2026-08-01",
    });
    expect(created.status).toBe(201);
    expect(created.body.deadline).toBe("2026-09-15");
    expect(created.body.requestDate).toBe("2026-08-01");

    const fetched = await getOpportunity(sa.token, created.body.id as string);
    expect(fetched.status).toBe(200);
    expect(fetched.body.deadline).toBe("2026-09-15");
    expect(fetched.body.requestDate).toBe("2026-08-01");
  });

  it("400s an invalid calendar day for deadline", async () => {
    const sa = await createSaLikeUser();
    const res = await createOpportunity(sa.token, { deadline: "2026-02-30" });
    expect(res.status).toBe(400);
  });

  it("400s an invalid calendar day for requestDate", async () => {
    const sa = await createSaLikeUser();
    const res = await createOpportunity(sa.token, { requestDate: "2026-02-30" });
    expect(res.status).toBe(400);
  });
});

describe("createOpportunitySchema / updateOpportunitySchema — server-only fields rejected", () => {
  it("400s a PATCH body containing stageOrder — stageOrder changes only go through /move", async () => {
    const sa = await createSaLikeUser();
    const created = await createOpportunity(sa.token, { picId: sa.userId });
    const id = created.body.id as string;

    const res = await patchOpportunity(sa.token, id, { stageOrder: 5 });
    expect(res.status).toBe(400);
  });

  it("400s a create body containing preHoldStage — never client-writable, same as stage on PATCH", async () => {
    const sa = await createSaLikeUser();
    const res = await createOpportunity(sa.token, { preHoldStage: "RFP" });
    expect(res.status).toBe(400);
  });

  it("400s a PATCH body containing preHoldStage", async () => {
    const sa = await createSaLikeUser();
    const created = await createOpportunity(sa.token, { picId: sa.userId });
    const id = created.body.id as string;

    const res = await patchOpportunity(sa.token, id, { preHoldStage: "RFP" });
    expect(res.status).toBe(400);
  });
});

describe("Permission gates on single-opportunity / create routes", () => {
  it("403s GET /opportunities/:id without pipeline:view", async () => {
    const sa = await createSaLikeUser();
    const created = await createOpportunity(sa.token, {});
    const id = created.body.id as string;

    const noPerms = await createUserWithPermissions([]);
    const res = await getOpportunity(noPerms.token, id);
    expect(res.status).toBe(403);
  });

  it("403s POST /opportunities without pipeline:create", async () => {
    const noPerms = await createUserWithPermissions(["pipeline:view"]);
    const res = await createOpportunity(noPerms.token, {});
    expect(res.status).toBe(403);
  });
});

describe("POST /opportunities/:id/move — cross-stage repacking", () => {
  it("repacks the SOURCE stage densely (0..n-1) after a cross-stage move", async () => {
    const sa = await createSaLikeUser();
    // DELIVER_PROPOSAL / WAITING_RESPONSE: untouched by any earlier test in
    // this file, so their sibling counts are exclusively this test's own.
    const a = await createOpportunity(sa.token, { picId: sa.userId, stage: "DELIVER_PROPOSAL" });
    const b = await createOpportunity(sa.token, { picId: sa.userId, stage: "DELIVER_PROPOSAL" });
    const c = await createOpportunity(sa.token, { picId: sa.userId, stage: "DELIVER_PROPOSAL" });
    const aId = a.body.id as string;
    const bId = b.body.id as string;
    const cId = c.body.id as string;
    // Appended at the bottom in creation order: a=0, b=1, c=2.
    expect((await getOpportunity(sa.token, aId)).body.stageOrder).toBe(0);
    expect((await getOpportunity(sa.token, bId)).body.stageOrder).toBe(1);
    expect((await getOpportunity(sa.token, cId)).body.stageOrder).toBe(2);

    // Move the middle one out of DELIVER_PROPOSAL entirely.
    const moved = await moveOpportunity(sa.token, bId, { stage: "WAITING_RESPONSE", stageOrder: 0 });
    expect(moved.status).toBe(200);

    // The remaining DELIVER_PROPOSAL siblings (a, c) are re-packed dense 0..1.
    expect((await getOpportunity(sa.token, aId)).body.stageOrder).toBe(0);
    expect((await getOpportunity(sa.token, cId)).body.stageOrder).toBe(1);
  });
});

describe("POST /opportunities/:id/move — HOLD / preHoldStage bookkeeping", () => {
  it("sets preHoldStage on a move into HOLD and clears it on a move out", async () => {
    const sa = await createSaLikeUser();
    const created = await createOpportunity(sa.token, { picId: sa.userId, stage: "RFP" });
    const id = created.body.id as string;

    const intoHold = await moveOpportunity(sa.token, id, { stage: "HOLD", stageOrder: 0 });
    expect(intoHold.status).toBe(200);
    expect(intoHold.body.stage).toBe("HOLD");
    expect(intoHold.body.preHoldStage).toBe("RFP");

    const outOfHold = await moveOpportunity(sa.token, id, { stage: "POC", stageOrder: 0 });
    expect(outOfHold.status).toBe(200);
    expect(outOfHold.body.stage).toBe("POC");
    expect(outOfHold.body.preHoldStage).toBeNull();
  });

  it("a same-stage reorder within HOLD does not touch preHoldStage", async () => {
    const sa = await createSaLikeUser();
    const first = await createOpportunity(sa.token, { picId: sa.userId, stage: "RFP" });
    const second = await createOpportunity(sa.token, { picId: sa.userId, stage: "RFP" });
    const firstId = first.body.id as string;
    const secondId = second.body.id as string;
    await moveOpportunity(sa.token, firstId, { stage: "HOLD", stageOrder: 0 });
    await moveOpportunity(sa.token, secondId, { stage: "HOLD", stageOrder: 1 });

    const reordered = await moveOpportunity(sa.token, secondId, { stage: "HOLD", stageOrder: 0 });
    expect(reordered.status).toBe(200);
    expect(reordered.body.stage).toBe("HOLD");
    expect(reordered.body.preHoldStage).toBe("RFP");
  });
});

describe("POST /opportunities — create directly into WON / HOLD", () => {
  it("sets wonAt when created with stage WON", async () => {
    const sa = await createSaLikeUser();
    const created = await createOpportunity(sa.token, { stage: "WON" });
    expect(created.status).toBe(201);
    expect(created.body.stage).toBe("WON");
    expect(created.body.wonAt).not.toBeNull();
  });

  it("leaves wonAt and preHoldStage null when created directly into HOLD", async () => {
    const sa = await createSaLikeUser();
    const created = await createOpportunity(sa.token, { stage: "HOLD" });
    expect(created.status).toBe(201);
    expect(created.body.stage).toBe("HOLD");
    expect(created.body.wonAt).toBeNull();
    expect(created.body.preHoldStage).toBeNull();
  });
});

describe("POST /opportunities — append-at-bottom ordering", () => {
  it("appends new opportunities at the bottom of their stage, in creation order", async () => {
    const sa = await createSaLikeUser();
    // DROP: untouched by any earlier test in this file.
    const a = await createOpportunity(sa.token, { stage: "DROP", title: "A" });
    const b = await createOpportunity(sa.token, { stage: "DROP", title: "B" });
    const c = await createOpportunity(sa.token, { stage: "DROP", title: "C" });

    expect((await getOpportunity(sa.token, a.body.id as string)).body.stageOrder).toBe(0);
    expect((await getOpportunity(sa.token, b.body.id as string)).body.stageOrder).toBe(1);
    expect((await getOpportunity(sa.token, c.body.id as string)).body.stageOrder).toBe(2);
  });
});

describe("POST /opportunities/:id/assign", () => {
  it("lets an edit_own holder claim an unassigned deal for themselves, logging one activity", async () => {
    const manager = await createManagerLikeUser();
    const sa = await createSaLikeUser();
    // Created by a manager with no picId — unassigned.
    const created = await createOpportunity(manager.token, {});
    const id = created.body.id as string;
    expect(created.body.pic).toBeNull();

    const res = await assignOpportunity(sa.token, id, { picId: sa.userId });
    expect(res.status).toBe(200);
    expect(res.body.pic.id).toBe(sa.userId);

    const activities = await activitiesFor(id);
    expect(activities).toHaveLength(1);
    expect(activities[0].note).toBe(`Assigned to ${sa.username}`);
    expect(activities[0].userId).toBe(sa.userId);
  });

  it("lets an edit_own holder assign an unassigned deal to another existing user (D4)", async () => {
    const manager = await createManagerLikeUser();
    const sa = await createSaLikeUser();
    const other = await createSaLikeUser();
    const created = await createOpportunity(manager.token, {});
    const id = created.body.id as string;

    const res = await assignOpportunity(sa.token, id, { picId: other.userId });
    expect(res.status).toBe(200);
    expect(res.body.pic.id).toBe(other.userId);
  });

  it("403s an edit_own holder assigning a deal whose PIC is another user", async () => {
    const owner = await createSaLikeUser();
    const other = await createSaLikeUser();
    const created = await createOpportunity(owner.token, { picId: owner.userId });
    const id = created.body.id as string;

    const res = await assignOpportunity(other.token, id, { picId: other.userId });
    expect(res.status).toBe(403);
  });

  it("403s an edit_own holder assigning their own already-assigned deal (Edit covers own deals)", async () => {
    const sa = await createSaLikeUser();
    const created = await createOpportunity(sa.token, { picId: sa.userId });
    const id = created.body.id as string;

    const res = await assignOpportunity(sa.token, id, { picId: sa.userId });
    expect(res.status).toBe(403);
  });

  it("lets an edit_all holder assign an already-assigned deal; repeating the same picId 200s with no second note (D6)", async () => {
    const owner = await createSaLikeUser();
    const manager = await createManagerLikeUser();
    const other = await createSaLikeUser();
    const created = await createOpportunity(owner.token, { picId: owner.userId });
    const id = created.body.id as string;

    const res = await assignOpportunity(manager.token, id, { picId: other.userId });
    expect(res.status).toBe(200);
    expect(res.body.pic.id).toBe(other.userId);
    let activities = await activitiesFor(id);
    expect(activities).toHaveLength(1);
    expect(activities[0].note).toBe(`Assigned to ${other.username}`);

    const again = await assignOpportunity(manager.token, id, { picId: other.userId });
    expect(again.status).toBe(200);
    activities = await activitiesFor(id);
    expect(activities).toHaveLength(1);
    // True no-op (N1 fix): a repeat assign to the same PIC does not write
    // the row at all, so updatedAt stays exactly what the first assign set.
    expect(again.body.updatedAt).toBe(res.body.updatedAt);
  });

  it("403s a pipeline:view-only caller", async () => {
    const manager = await createManagerLikeUser();
    const viewer = await createUserWithPermissions(["pipeline:view"]);
    const created = await createOpportunity(manager.token, {});
    const id = created.body.id as string;

    const res = await assignOpportunity(viewer.token, id, { picId: viewer.userId });
    expect(res.status).toBe(403);
  });

  it("400s an unknown picId with code pic_not_found", async () => {
    const manager = await createManagerLikeUser();
    const created = await createOpportunity(manager.token, {});
    const id = created.body.id as string;

    const res = await assignOpportunity(manager.token, id, { picId: 999_999_999 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("pic_not_found");
  });

  it("400s a missing picId", async () => {
    const manager = await createManagerLikeUser();
    const created = await createOpportunity(manager.token, {});
    const id = created.body.id as string;

    const res = await assignOpportunity(manager.token, id, {});
    expect(res.status).toBe(400);
  });

  it("400s a non-positive picId", async () => {
    const manager = await createManagerLikeUser();
    const created = await createOpportunity(manager.token, {});
    const id = created.body.id as string;

    const res = await assignOpportunity(manager.token, id, { picId: 0 });
    expect(res.status).toBe(400);
  });

  it("400s a malformed :id", async () => {
    const manager = await createManagerLikeUser();

    const res = await request(app)
      .post("/opportunities/not-a-uuid/assign")
      .set("Authorization", `Bearer ${manager.token}`)
      .send({ picId: manager.userId });
    expect(res.status).toBe(400);
  });

  it("404s a well-formed but unknown id", async () => {
    const manager = await createManagerLikeUser();

    const res = await assignOpportunity(manager.token, "00000000-0000-0000-0000-000000000000", {
      picId: manager.userId,
    });
    expect(res.status).toBe(404);
  });

  it("400s a body with an extra key — .strict() (D2)", async () => {
    const manager = await createManagerLikeUser();
    const created = await createOpportunity(manager.token, {});
    const id = created.body.id as string;

    const res = await assignOpportunity(manager.token, id, { picId: manager.userId, title: "x" });
    expect(res.status).toBe(400);
  });

  it("401s without a token", async () => {
    const manager = await createManagerLikeUser();
    const created = await createOpportunity(manager.token, {});
    const id = created.body.id as string;

    const res = await request(app).post(`/opportunities/${id}/assign`).send({ picId: manager.userId });
    expect(res.status).toBe(401);
  });

  it("D1 regression guard: an edit_own holder still can't PATCH or DELETE an unassigned deal", async () => {
    const manager = await createManagerLikeUser();
    const sa = await createSaLikeUser();
    const created = await createOpportunity(manager.token, {});
    const id = created.body.id as string;

    const patched = await patchOpportunity(sa.token, id, { title: "x" });
    expect(patched.status).toBe(403);

    const deleted = await deleteOpportunity(sa.token, id);
    expect(deleted.status).toBe(403);
  });
});
