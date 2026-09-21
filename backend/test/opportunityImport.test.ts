import "./env.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { PipelineStage } from "@prisma/client";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { signToken } from "../src/http/auth.js";
import { seedRoles } from "./testAuth.js";

// Covers routes/opportunities.ts's POST /opportunities/import and
// GET /opportunities/imports (M4.17). Oracle:
// ../VeloraApp/app/api/opportunities/import/route.ts (backend) plus its
// companion components/import-excel-dialog.tsx (the client is the real
// source of the required-field / stage-literal / numeric-range validation
// — the reference backend route itself does none of that, trusting the
// client to have already filtered to "valid" rows).
//
// This file shares a DB with opportunities.test.ts / opportunityItems.test.ts
// within a full suite run (globalSetup truncates once per run, not per
// file — vitest.config.ts's fileParallelism:false only serializes files, it
// doesn't reset state between them). So, same discipline as
// opportunities.test.ts: never assert an absolute stageOrder for a stage
// another file might have already touched — read the current count first,
// then assert relative to it.

const app = createApp();

let roleCounter = 0;

async function createUserWithPermissions(
  permissions: string[],
): Promise<{ userId: number; token: string }> {
  roleCounter += 1;
  const role = await prisma.role.create({
    data: { roleName: `test-import-role-${roleCounter}-${Date.now()}`, permissions },
  });
  const user = await prisma.user.create({
    data: {
      username: `test-import-user-${roleCounter}-${Date.now()}`,
      email: `test-import-user-${roleCounter}-${Date.now()}@example.com`,
      passwordHash: null,
      roleId: role.id,
      active: true,
    },
  });
  const token = signToken({ sub: user.id, role: role.roleName, permissions });
  return { userId: user.id, token };
}

async function createImporter(): Promise<{ userId: number; token: string }> {
  return createUserWithPermissions(["pipeline:view", "pipeline:create"]);
}

async function createViewerOnly(): Promise<{ userId: number; token: string }> {
  return createUserWithPermissions(["pipeline:view"]);
}

function importRows(token: string, rows: unknown[]) {
  return request(app)
    .post("/opportunities/import")
    .set("Authorization", `Bearer ${token}`)
    .send({ rows });
}

function getImportHistory(token: string) {
  return request(app).get("/opportunities/imports").set("Authorization", `Bearer ${token}`);
}

async function seedExistingOpportunity(
  overrides: { title?: string; customerName?: string; stage?: PipelineStage } = {},
) {
  return prisma.opportunity.create({
    data: {
      title: overrides.title ?? `Seed ${Date.now()}-${Math.random()}`,
      customerName: overrides.customerName ?? "Seed Co",
      stage: overrides.stage ?? PipelineStage.ASSESSMENT,
    },
  });
}

beforeAll(async () => {
  await seedRoles();
});

describe("POST /opportunities/import — permission gate", () => {
  it("403s a caller without pipeline:create", async () => {
    const viewer = await createViewerOnly();
    const res = await importRows(viewer.token, [
      { title: "ImpTest Gate", customerName: "ImpTest Gate Co", stage: "assessment" },
    ]);
    expect(res.status).toBe(403);
  });
});

describe("GET /opportunities/imports — permission gate", () => {
  it("403s a caller without pipeline:view", async () => {
    const noPerms = await createUserWithPermissions([]);
    const res = await getImportHistory(noPerms.token);
    expect(res.status).toBe(403);
  });

  it("lets a pipeline:view-only holder (no create) read import history", async () => {
    const viewer = await createViewerOnly();
    const res = await getImportHistory(viewer.token);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("POST /opportunities/import — valid rows", () => {
  it("inserts valid rows, appended at the bottom of their stage after any existing siblings", async () => {
    const importer = await createImporter();
    const before = await prisma.opportunity.count({ where: { stage: PipelineStage.RFP } });

    const res = await importRows(importer.token, [
      { title: "ImpTest Order One", customerName: "ImpTest Order Co", stage: "rfp" },
      { title: "ImpTest Order Two", customerName: "ImpTest Order Co", stage: "RFP" },
    ]);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ totalRows: 2, validCount: 2, skipCount: 0, invalidCount: 0 });
    expect(res.body.results[0].status).toBe("valid");
    expect(res.body.results[1].status).toBe("valid");

    const first = await prisma.opportunity.findUnique({ where: { id: res.body.results[0].id } });
    const second = await prisma.opportunity.findUnique({ where: { id: res.body.results[1].id } });
    expect(first?.stage).toBe("RFP");
    expect(first?.stageOrder).toBe(before);
    expect(second?.stageOrder).toBe(before + 1);
  });

  it("stamps wonAt for a row imported directly into won — mirrors POST / create's rule", async () => {
    const importer = await createImporter();
    const res = await importRows(importer.token, [
      { title: "ImpTest Won Deal", customerName: "ImpTest Won Co", stage: "won" },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.validCount).toBe(1);

    const id = res.body.results[0].id as string;
    const created = await prisma.opportunity.findUnique({ where: { id } });
    expect(created?.stage).toBe("WON");
    expect(created?.wonAt).not.toBeNull();
  });

  it("stores an optional activityLog as an OpportunityActivity attributed to the importing user", async () => {
    const importer = await createImporter();
    const res = await importRows(importer.token, [
      {
        title: "ImpTest Activity Deal",
        customerName: "ImpTest Activity Co",
        stage: "assessment",
        activityLog: "Initial note from import",
      },
    ]);
    expect(res.status).toBe(200);
    const id = res.body.results[0].id as string;
    const activities = await prisma.opportunityActivity.findMany({ where: { opportunityId: id } });
    expect(activities).toHaveLength(1);
    expect(activities[0].note).toBe("Initial note from import");
    expect(activities[0].userId).toBe(importer.userId);
  });
});

describe("POST /opportunities/import — invalid rows", () => {
  it("reports a missing-title row as invalid instead of 500ing", async () => {
    const importer = await createImporter();
    const res = await importRows(importer.token, [
      { customerName: "ImpTest No Title Co", stage: "assessment" },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.totalRows).toBe(1);
    expect(res.body.invalidCount).toBe(1);
    expect(res.body.validCount).toBe(0);
    expect(res.body.results[0]).toMatchObject({ row: 1, status: "invalid" });
    expect(res.body.results[0].reason).toMatch(/Title is required/);
  });

  it("reports an unrecognized stage literal as invalid instead of 500ing", async () => {
    const importer = await createImporter();
    const res = await importRows(importer.token, [
      { title: "ImpTest Bad Stage", customerName: "ImpTest Bad Stage Co", stage: "not_a_real_stage" },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.invalidCount).toBe(1);
    expect(res.body.results[0].status).toBe("invalid");
    expect(res.body.results[0].reason).toMatch(/Invalid stage/);
  });

  it("rejects 'hold' as an import stage — reachable only via /move, never a row's starting stage", async () => {
    const importer = await createImporter();
    const res = await importRows(importer.token, [
      { title: "ImpTest Hold Deal", customerName: "ImpTest Hold Co", stage: "hold" },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.results[0].status).toBe("invalid");
  });

  it("accepts a stage literal case- and spacing-insensitively, same as the reference client", async () => {
    const importer = await createImporter();
    const res = await importRows(importer.token, [
      { title: "ImpTest Case Deal", customerName: "ImpTest Case Co", stage: "Deliver Proposal" },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.validCount).toBe(1);
    const id = res.body.results[0].id as string;
    const created = await prisma.opportunity.findUnique({ where: { id } });
    expect(created?.stage).toBe("DELIVER_PROPOSAL");
  });

  it("reports an invalid calendar day deadline as invalid instead of 500ing", async () => {
    const importer = await createImporter();
    const res = await importRows(importer.token, [
      {
        title: "ImpTest Bad Deadline",
        customerName: "ImpTest Bad Deadline Co",
        stage: "assessment",
        deadline: "2026-02-30",
      },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.invalidCount).toBe(1);
    expect(res.body.results[0].status).toBe("invalid");
    expect(res.body.results[0].reason).toMatch(/Deadline must be a valid yyyy-MM-dd date/);
  });

  it("reports an unknown picId as invalid with a clean reason instead of a raw FK error", async () => {
    const importer = await createImporter();
    const res = await importRows(importer.token, [
      {
        title: "ImpTest Unknown Pic",
        customerName: "ImpTest Unknown Pic Co",
        stage: "assessment",
        picId: 999999,
      },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.invalidCount).toBe(1);
    expect(res.body.results[0].status).toBe("invalid");
    expect(res.body.results[0].reason).toMatch(/PIC with id 999999 not found/);
  });

  it("reports a negative dealValue and an out-of-range winProbability as invalid", async () => {
    const importer = await createImporter();
    const res = await importRows(importer.token, [
      { title: "ImpTest Neg Value", customerName: "ImpTest Neg Value Co", stage: "assessment", dealValue: -5 },
      {
        title: "ImpTest High Prob",
        customerName: "ImpTest High Prob Co",
        stage: "assessment",
        winProbability: 150,
      },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.invalidCount).toBe(2);
    expect(res.body.results[0].status).toBe("invalid");
    expect(res.body.results[0].reason).toMatch(/Deal value must be a non-negative number/);
    expect(res.body.results[1].status).toBe("invalid");
    expect(res.body.results[1].reason).toMatch(/Win probability must be an integer between 0 and 100/);
  });

  it("reports an over-length title as invalid instead of truncating (B1)", async () => {
    const importer = await createImporter();
    const longTitle = "A".repeat(201);
    const res = await importRows(importer.token, [
      { title: longTitle, customerName: "ImpTest Long Title Co", stage: "assessment" },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.invalidCount).toBe(1);
    expect(res.body.results[0].status).toBe("invalid");
    expect(res.body.results[0].reason).toBe("Title exceeds 200 characters");

    const stored = await prisma.opportunity.findFirst({ where: { customerName: "ImpTest Long Title Co" } });
    expect(stored).toBeNull();
  });
});

describe("POST /opportunities/import — deadline round-trip", () => {
  it("round-trips a valid deadline through import as an exact yyyy-MM-dd day", async () => {
    const importer = await createImporter();
    const res = await importRows(importer.token, [
      {
        title: "ImpTest Deadline Deal",
        customerName: "ImpTest Deadline Co",
        stage: "assessment",
        deadline: "2026-09-15",
      },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.validCount).toBe(1);
    const id = res.body.results[0].id as string;
    const created = await prisma.opportunity.findUnique({ where: { id } });
    expect(created?.deadline?.toISOString().slice(0, 10)).toBe("2026-09-15");
  });
});

describe("POST /opportunities/import — duplicate skip", () => {
  it("skips a row matching an existing opportunity's title+customer, case-insensitively", async () => {
    await seedExistingOpportunity({
      title: "ImpTest Dup Deal",
      customerName: "ImpTest Dup Co",
      stage: PipelineStage.RFP,
    });
    const importer = await createImporter();

    const res = await importRows(importer.token, [
      { title: "imptest dup deal", customerName: "IMPTEST DUP CO", stage: "assessment" },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.skipCount).toBe(1);
    expect(res.body.validCount).toBe(0);
    expect(res.body.results[0]).toMatchObject({ row: 1, status: "skipped" });
  });

  it("skips the second of two identical rows within the same batch", async () => {
    const importer = await createImporter();
    const res = await importRows(importer.token, [
      { title: "ImpTest Batch Dup", customerName: "ImpTest Batch Dup Co", stage: "assessment" },
      { title: "ImpTest Batch Dup", customerName: "ImpTest Batch Dup Co", stage: "assessment" },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.validCount).toBe(1);
    expect(res.body.skipCount).toBe(1);
    expect(res.body.results[0].status).toBe("valid");
    expect(res.body.results[1].status).toBe("skipped");
  });
});

describe("POST /opportunities/import — PipelineImportLog", () => {
  it("writes one accurate log row per call for a mixed batch", async () => {
    const importer = await createImporter();
    const res = await importRows(importer.token, [
      { title: "ImpTest Mix Valid", customerName: "ImpTest Mix Valid Co", stage: "assessment" },
      { customerName: "ImpTest Mix Invalid Co", stage: "assessment" },
      { title: "ImpTest Mix Valid", customerName: "ImpTest Mix Valid Co", stage: "assessment" },
    ]);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ totalRows: 3, validCount: 1, skipCount: 1, invalidCount: 1 });

    const logs = await prisma.pipelineImportLog.findMany({
      where: { userId: importer.userId },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      totalRows: 3,
      validCount: 1,
      skipCount: 1,
      invalidCount: 1,
      status: "OK",
    });
  });

  it("surfaces in GET /opportunities/imports newest-first with the acting user attached", async () => {
    const importer = await createImporter();
    const imported = await importRows(importer.token, [
      { title: "ImpTest History Deal", customerName: "ImpTest History Co", stage: "assessment" },
    ]);
    expect(imported.status).toBe(200);

    const res = await getImportHistory(importer.token);
    expect(res.status).toBe(200);
    const body = res.body as Array<{
      userId: number | null;
      totalRows: number;
      user: { id: number } | null;
    }>;
    expect(body[0].userId).toBe(importer.userId);
    expect(body[0].totalRows).toBe(1);
    expect(body[0].user).toMatchObject({ id: importer.userId });
  });

  it("GET /opportunities/imports caps the response at 100 rows even when more exist", async () => {
    const importer = await createImporter();
    // Cheap rows straight via prisma — no need to exercise the import
    // endpoint 101 times just to pad the log table.
    await prisma.pipelineImportLog.createMany({
      data: Array.from({ length: 101 }, () => ({
        userId: importer.userId,
        totalRows: 1,
        validCount: 1,
        skipCount: 0,
        invalidCount: 0,
        status: "OK" as const,
      })),
    });

    const res = await getImportHistory(importer.token);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(100);
  });
});

describe("POST /opportunities/import — cap + envelope validation", () => {
  it("400s a batch over the row cap (500)", async () => {
    const importer = await createImporter();
    const rows = Array.from({ length: 501 }, (_, i) => ({
      title: `ImpTest Cap ${i}`,
      customerName: `ImpTest Cap Co ${i}`,
      stage: "assessment",
    }));
    const res = await importRows(importer.token, rows);
    expect(res.status).toBe(400);
  });

  it("400s an empty rows array", async () => {
    const importer = await createImporter();
    const res = await importRows(importer.token, []);
    expect(res.status).toBe(400);
  });
});
