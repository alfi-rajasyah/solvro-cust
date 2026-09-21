import { Router } from "express";
import { z } from "zod";
import { PipelineStage } from "@prisma/client";
import type { Opportunity, Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { hasPermission, requireAuth, requirePermission } from "../http/auth.js";
import { HttpError } from "../http/errors.js";
import { validate } from "../http/validate.js";
import { isValidDayString, utcMidnightOfDayString } from "../lib/dateBoundary.js";
import { isCustomerVisible } from "../lib/visibility.js";
import { assertCanAssignOpportunity, assertCanWriteOpportunity, PIC_SELECT } from "../lib/pipelineAccess.js";
import { logger } from "../logger.js";
// Anti-drift seam (finding S6): the handoff body is byte-for-byte the same
// shape as a plain project create, so this reuses routes/projects.ts's own
// `createProjectSchema` (which already composes `wipLimitsSchema`) instead
// of a hand-duplicated copy — the two schemas had already drifted apart
// once (this file's own `.strict()`-vs-not history) before being caught by
// review. `wipLimitsSchema` isn't imported directly here — it only ever
// appears nested inside `createProjectSchema`.
import { createProjectSchema } from "./projects.js";

// Pipeline module (native port of Velora — docs/plans/pipeline-native-port-plan.md).
// CRUD + the single stage-transition writer for Opportunity. Deal visibility
// is global for any pipeline:view holder (PRD §5) — no per-user list
// scoping, unlike projects/visibility.ts. Ownership (`picId`) gates writes
// only, via the edit_own/edit_all and delete_own/delete_all permission pairs.

const idParamSchema = z.object({ id: z.string().uuid() });

// Plain calendar day ("yyyy-MM-dd", no time/zone) — the `deadline` column is
// `@db.Date` precisely so it never carries instant semantics. Validated with
// the same house day-string helper `routes/tasks.ts` uses for its `today`
// query param (`lib/dateBoundary.ts`), and converted to storage the same way.
const dayStringSchema = z
  .string()
  .refine(isValidDayString, { message: "Must be a valid yyyy-MM-dd date" });

const picIdField = z.number().int().positive().nullable();

// `.strict()` on create too (symmetry with update): `stage` is the one
// writable field this schema exposes (POST /:id/move owns transitions
// thereafter); everything else outside the listed fields — notably
// `stageOrder` and `preHoldStage`, both server-computed/route-owned — 400s
// instead of silently no-op'ing.
const createOpportunitySchema = z
  .object({
    title: z.string().min(1).max(200),
    customerName: z.string().min(1).max(200),
    dealValue: z.number().min(0).optional(),
    picId: picIdField.optional(),
    deadline: dayStringSchema.nullable().optional(),
    requestDate: dayStringSchema.nullable().optional(),
    description: z.string().max(5000).nullable().optional(),
    productSolution: z.string().max(500).optional(),
    leadSource: z.string().max(200).nullable().optional(),
    winProbability: z.number().int().min(0).max(100).optional(),
    stage: z.nativeEnum(PipelineStage).optional(),
  })
  .strict();

// `.strict()`: stage (and stageOrder, preHoldStage) changes are rejected
// here rather than silently dropped — POST /:id/move is the ONLY writer of
// stage changes (and the HOLD/preHoldStage pair that comes with them), so a
// client that sends `stage` in a PATCH body gets a 400, not a no-op.
const updateOpportunitySchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    customerName: z.string().min(1).max(200).optional(),
    dealValue: z.number().min(0).optional(),
    picId: picIdField.optional(),
    deadline: dayStringSchema.nullable().optional(),
    requestDate: dayStringSchema.nullable().optional(),
    description: z.string().max(5000).nullable().optional(),
    productSolution: z.string().max(500).optional(),
    leadSource: z.string().max(200).nullable().optional(),
    winProbability: z.number().int().min(0).max(100).optional(),
  })
  .strict();

const moveOpportunitySchema = z.object({
  stage: z.nativeEnum(PipelineStage),
  stageOrder: z.number().int().min(0),
});

// `.strict()`: the only writable field is the new PIC — this route exists
// specifically to hand a PIC to an unassigned deal (docs/plans/
// claim-unassigned-deals.md D2), not as a partial PATCH.
const assignOpportunitySchema = z.object({ picId: z.number().int().positive() }).strict();

// --- POST /import ----------------------------------------------------------
//
// Bulk-create rows the client already parsed from a spreadsheet (M4.18's
// import dialog, adapted from VeloraApp's Import Excel feature). Field names
// are camelCase on this wire contract (house convention, matching
// createOpportunitySchema above) even though the reference oracle
// (../VeloraApp/app/api/opportunities/import/route.ts and its companion
// components/import-excel-dialog.tsx) uses snake_case.
//
// No cap in the oracle route — it trusts the client to have already
// filtered to "valid" rows before POSTing. This endpoint doesn't extend
// that trust (a spreadsheet-driven API should never 500 on a malformed
// batch), so it re-validates every row server-side and caps the batch at a
// sane size the oracle never bothered to define.
const IMPORT_ROW_CAP = 500;

// The reference client (import-excel-dialog.tsx) normalizes a cell's stage
// text the same way before comparing against VALID_STAGES: trim, lowercase,
// spaces -> underscores — so "Deliver Proposal", "DELIVER_PROPOSAL", and
// " deliver_proposal " all resolve to the same literal. Mirrored here.
//
// Deliberately only 8 entries, not all 9 PipelineStage values: the oracle's
// own VALID_STAGES list excludes "hold" — HOLD is reachable only via
// POST /:id/move from an existing stage (see the schema comment on
// Opportunity.preHoldStage), never a row's starting stage, so it isn't a
// valid import target either.
const IMPORT_STAGE_MAP: Record<string, PipelineStage> = {
  assessment: PipelineStage.ASSESSMENT,
  rfp: PipelineStage.RFP,
  poc: PipelineStage.POC,
  technical_clarification: PipelineStage.TECHNICAL_CLARIFICATION,
  deliver_proposal: PipelineStage.DELIVER_PROPOSAL,
  waiting_response: PipelineStage.WAITING_RESPONSE,
  won: PipelineStage.WON,
  drop: PipelineStage.DROP,
};

function normalizeStageLiteral(raw: string): PipelineStage | undefined {
  return IMPORT_STAGE_MAP[raw.trim().toLowerCase().replace(/ /g, "_")];
}

// Deliberately permissive (not `.strict()`): a malformed row should fail
// gracefully into an "invalid" result entry, not 400 the whole batch. Every
// field is optional/nullable here; the real required-field, stage-literal,
// and numeric-range checks run by hand in the row loop below so each row
// can be judged independently. String bounds DO live here though (finding
// B1) — they mirror createOpportunitySchema's limits exactly (title/
// customerName .max(200), productSolution .max(500), leadSource .max(200))
// plus activityLog at .max(2000), parity with opportunityItems.ts's
// createActivitySchema note limit. An over-length field is reported back as
// a per-row "invalid" reason (see importRowFailureReason below) — never
// silently truncated, since an unbounded import used to create deals whose
// every subsequent UI edit would 400 against the stricter update schema.
const importRowSchema = z
  .object({
    title: z.string().max(200).optional().nullable(),
    customerName: z.string().max(200).optional().nullable(),
    dealValue: z.number().optional().nullable(),
    stage: z.string().optional().nullable(),
    picId: z.number().int().positive().optional().nullable(),
    deadline: z.string().optional().nullable(),
    productSolution: z.string().max(500).optional().nullable(),
    winProbability: z.number().optional().nullable(),
    leadSource: z.string().max(200).optional().nullable(),
    activityLog: z.string().max(2000).optional().nullable(),
  })
  .passthrough();

// Human-readable labels for the length-bounded fields above, keyed by the
// zod issue's single-segment path — used to turn a `too_big` failure into
// the specific reason B1 asks for ("Title exceeds 200 characters") instead
// of the generic "Malformed row data" fallback.
const IMPORT_ROW_LENGTH_LABELS: Record<string, { label: string; max: number }> = {
  title: { label: "Title", max: 200 },
  customerName: { label: "Customer name", max: 200 },
  productSolution: { label: "Product/solution", max: 500 },
  leadSource: { label: "Lead source", max: 200 },
  activityLog: { label: "Activity log", max: 2000 },
};

/**
 * Turns an `importRowSchema.safeParse` failure into a per-row reason. If
 * every issue is a recognized over-length field, the reason names the
 * field(s) and their limit; any other failure shape (wrong type, unknown
 * shape, etc.) keeps the pre-existing generic fallback rather than guessing.
 */
function importRowFailureReason(error: z.ZodError): string {
  const overLength = error.issues
    .filter((issue) => issue.code === "too_big" && issue.path.length === 1)
    .map((issue) => IMPORT_ROW_LENGTH_LABELS[String(issue.path[0])])
    .filter((meta): meta is { label: string; max: number } => meta !== undefined);

  if (overLength.length === error.issues.length && overLength.length > 0) {
    return overLength.map((meta) => `${meta.label} exceeds ${meta.max} characters`).join("; ");
  }
  return "Malformed row data";
}

// The envelope IS strictly validated (and 400s the whole call on failure) —
// unlike a single row, "rows isn't an array" or "rows is empty" isn't a
// row-level concern to report back individually. Mirrors the oracle's own
// "No data to import" 400 for an empty/missing array.
const importBodySchema = z
  .object({
    rows: z
      .array(z.unknown())
      .min(1, "No data to import")
      .max(IMPORT_ROW_CAP, `Cannot import more than ${IMPORT_ROW_CAP} rows in a single call`),
  })
  .strict();

type ImportRowStatus = "valid" | "skipped" | "invalid";

interface ImportRowResult {
  row: number; // 1-based index within this call's `rows` array
  status: ImportRowStatus;
  reason?: string;
  id?: string; // opportunity id — only present when status is "valid"
}

const STAGE_LABELS: Record<PipelineStage, string> = {
  ASSESSMENT: "Assessment",
  RFP: "RFP",
  POC: "PoC",
  TECHNICAL_CLARIFICATION: "Technical Clarification",
  DELIVER_PROPOSAL: "Delivered Proposal",
  WAITING_RESPONSE: "Waiting Response",
  WON: "Won",
  DROP: "Drop",
  HOLD: "Hold",
};

type OpportunityWithPic = Opportunity & {
  pic: { id: number; username: string; avatarUrl: string | null } | null;
};

/**
 * `dealValue` is a Prisma BigInt (IDR values fit in Number.MAX_SAFE_INTEGER,
 * so a plain Number round-trips exactly) and `res.json` throws on a raw
 * BigInt. `deadline`/`requestDate` are plain calendar days (`@db.Date`, "no
 * instant conversion" per the schema comment) — re-deriving the UTC
 * date-part keeps the wire contract a bare "yyyy-MM-dd" day string rather
 * than a full ISO instant. `preHoldStage` needs no conversion (plain enum,
 * already part of `...o`). Every response funnels through this one helper
 * so these conversions never drift out of sync across handlers.
 */
function serializeOpportunity(o: OpportunityWithPic) {
  return {
    ...o,
    dealValue: Number(o.dealValue),
    deadline: o.deadline ? o.deadline.toISOString().slice(0, 10) : null,
    requestDate: o.requestDate ? o.requestDate.toISOString().slice(0, 10) : null,
  };
}

function toDealValue(value: number): bigint {
  return BigInt(Math.round(value));
}

async function findOpportunityOr404(id: string): Promise<Opportunity> {
  const opportunity = await prisma.opportunity.findUnique({ where: { id } });
  if (!opportunity) throw new HttpError(404, "not_found", "Opportunity not found");
  return opportunity;
}

type Tx = Prisma.TransactionClient;

async function stageSiblingIds(tx: Tx, stage: PipelineStage, excludeId: string): Promise<string[]> {
  const rows = await tx.opportunity.findMany({
    where: { stage, id: { not: excludeId } },
    orderBy: [{ stageOrder: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Inserts `oppId` into `stage`'s sibling list at `requestedPosition`
 * (clamped to [0, siblings.length]), then re-packs the whole list to dense
 * 0..n-1 — mirrors `lib/taskOrdering.ts`'s `insertAt`, scoped to `stage`
 * instead of (projectId, parentTaskId). Must run inside a
 * `prisma.$transaction`. Returns the final stageOrder assigned to `oppId`.
 */
async function insertAtStage(
  tx: Tx,
  stage: PipelineStage,
  oppId: string,
  requestedPosition: number,
): Promise<number> {
  const others = await stageSiblingIds(tx, stage, oppId);
  const clamped = Math.max(0, Math.min(requestedPosition, others.length));
  const ordered = [...others];
  ordered.splice(clamped, 0, oppId);
  for (let i = 0; i < ordered.length; i++) {
    await tx.opportunity.update({ where: { id: ordered[i] }, data: { stageOrder: i } });
  }
  return clamped;
}

/**
 * Re-packs `stage`'s remaining siblings to dense 0..n-1 after `oppId` leaves
 * it on a cross-stage move — mirrors `lib/taskOrdering.ts`'s `closeGap`.
 */
async function closeGapInStage(tx: Tx, stage: PipelineStage, oppId: string): Promise<void> {
  const remaining = await stageSiblingIds(tx, stage, oppId);
  for (let i = 0; i < remaining.length; i++) {
    await tx.opportunity.update({ where: { id: remaining[i] }, data: { stageOrder: i } });
  }
}

export const opportunitiesRouter = Router();

// Both this router and opportunityItemsRouter mount at "/opportunities"
// (src/app.ts) and each calls requireAuth at their own router root, so a
// request handled by opportunityItemsRouter (e.g. /:id/activities) runs
// requireAuth twice — once here (no route in this router matches that
// shape, so it just falls through) and once in opportunityItemsRouter.
// Harmless: requireAuth is a pure, idempotent JWT verification against the
// same header each time (just re-sets req.user to the same value) — not
// worth the coupling of hoisting it to app.ts or merging the two routers.
opportunitiesRouter.use(requireAuth);

// Full list, no pagination (SA-team scale — client-side filtering per
// docs/plans/pipeline-native-port-plan.md). Board column order: stage, then
// stageOrder within it.
opportunitiesRouter.get("/", requirePermission("pipeline:view"), async (_req, res) => {
  const opportunities = await prisma.opportunity.findMany({
    orderBy: [{ stage: "asc" }, { stageOrder: "asc" }],
    include: { pic: { select: PIC_SELECT } },
  });
  res.json(opportunities.map((o) => serializeOpportunity(o as OpportunityWithPic)));
});

// Import history for the Admin > Pipeline tab (M4.19). Lives on this
// router (rather than routes/admin.ts) to keep that spine file untouched —
// the consuming UI is admin-only regardless of which router serves it, so
// the gate is still meaningfully restrictive in practice even though the
// permission checked here is the same pipeline:view every board reader
// already holds.
//
// Registered ahead of GET "/:id" — Express matches routes in registration
// order, and "/:id" would otherwise swallow "/imports" as id="imports" and
// 400 on the uuid check.
opportunitiesRouter.get("/imports", requirePermission("pipeline:view"), async (_req, res) => {
  const logs = await prisma.pipelineImportLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { user: { select: PIC_SELECT } },
  });
  res.json(logs);
});

opportunitiesRouter.get(
  "/:id",
  requirePermission("pipeline:view"),
  validate("params", idParamSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const opportunity = await prisma.opportunity.findUnique({
      where: { id },
      include: { pic: { select: PIC_SELECT } },
    });
    if (!opportunity) throw new HttpError(404, "not_found", "Opportunity not found");
    res.json(serializeOpportunity(opportunity as OpportunityWithPic));
  },
);

opportunitiesRouter.post(
  "/",
  requirePermission("pipeline:create"),
  validate("body", createOpportunitySchema),
  async (req, res) => {
    const body = req.body as z.infer<typeof createOpportunitySchema>;
    const stage = body.stage ?? PipelineStage.ASSESSMENT;

    const data: Prisma.OpportunityCreateInput = {
      title: body.title,
      customerName: body.customerName,
      stage,
    };
    if (body.dealValue !== undefined) data.dealValue = toDealValue(body.dealValue);
    // `disconnect` isn't a valid nested-write action on create (there's
    // nothing yet to disconnect from) — an explicit `picId: null` is simply
    // "don't connect a pic", already the default for a brand-new row. A
    // real id goes through a relation `connect`, not a raw FK-scalar write,
    // so a nonexistent user id 404s via Prisma's P2025 mapping instead of
    // 500ing on an unmapped P2003 FK violation (finding S1).
    if (body.picId !== undefined && body.picId !== null) {
      data.pic = { connect: { id: body.picId } };
    }
    if (body.deadline !== undefined) {
      data.deadline = body.deadline === null ? null : utcMidnightOfDayString(body.deadline);
    }
    if (body.requestDate !== undefined) {
      data.requestDate = body.requestDate === null ? null : utcMidnightOfDayString(body.requestDate);
    }
    if (body.description !== undefined) data.description = body.description;
    if (body.productSolution !== undefined) data.productSolution = body.productSolution;
    if (body.leadSource !== undefined) data.leadSource = body.leadSource;
    if (body.winProbability !== undefined) data.winProbability = body.winProbability;
    // Creating directly into WON is a real flow (the PRD's per-column "+"
    // lets an SA add a deal straight into any column, including Won) so it
    // gets the same wonAt bookkeeping POST /:id/move does on a transition
    // into WON (finding S2).
    if (stage === PipelineStage.WON) data.wonAt = new Date();
    // Creating directly into HOLD, by contrast, has no "prior stage" to
    // record — HOLD is normally only reached via /move from an existing
    // stage — so preHoldStage is deliberately left null here (the schema
    // default), same as any other creation path.

    // New card lands at the BOTTOM of its stage (MAX(stageOrder)+1
    // semantics) — matches the reference's
    // `COALESCE(MAX(stage_order), -1) + 1` (VeloraApp's opportunities
    // route) and lib/taskOrdering.ts's append-at-end (finding S6). The
    // stage's existing siblings are already dense 0..n-1, so a plain count
    // is the next slot; wrapped in a transaction so a concurrent create
    // into the same stage can't race to the same stageOrder.
    const created = await prisma.$transaction(async (tx) => {
      const stageOrder = await tx.opportunity.count({ where: { stage } });
      return tx.opportunity.create({
        data: { ...data, stageOrder },
        include: { pic: { select: PIC_SELECT } },
      });
    });

    res.status(201).json(serializeOpportunity(created));
  },
);

// Bulk import (M4.18's dialog). All-or-nothing PER ROW, not per batch: one
// row's failure (bad stage, missing title, unknown PIC, a duplicate) never
// aborts the rest — it's reported back in `results` with a reason instead.
// Each valid row is created inside its own transaction (same
// count-then-create ordering the single-create route above uses), awaited
// sequentially so each row's stageOrder count reflects every row already
// inserted ahead of it in this same call.
opportunitiesRouter.post(
  "/import",
  requirePermission("pipeline:create"),
  validate("body", importBodySchema),
  async (req, res) => {
    const { rows } = req.body as z.infer<typeof importBodySchema>;
    const userId = req.user!.sub;

    const results: ImportRowResult[] = [];
    let validCount = 0;
    let skipCount = 0;
    let invalidCount = 0;

    try {
      // Dedupe key is `${title}||${customerName}` (case-insensitive,
      // trimmed) against every existing opportunity — mirrors the oracle's
      // `LOWER(title)||LOWER(customer_name)` set built once up front. Newly
      // imported rows are added to this same set as they're inserted, so a
      // duplicate WITHIN this batch is skipped too, same as the oracle.
      const existing = await prisma.opportunity.findMany({
        select: { title: true, customerName: true },
      });
      const seen = new Set(
        existing.map((o) => `${o.title.trim().toLowerCase()}||${o.customerName.trim().toLowerCase()}`),
      );

      for (let i = 0; i < rows.length; i++) {
        const rowNum = i + 1;
        const parsed = importRowSchema.safeParse(rows[i]);
        if (!parsed.success) {
          invalidCount++;
          results.push({ row: rowNum, status: "invalid", reason: importRowFailureReason(parsed.error) });
          continue;
        }
        const raw = parsed.data;

        const title = (raw.title ?? "").trim();
        const customerName = (raw.customerName ?? "").trim();
        const stageRaw = (raw.stage ?? "").trim();

        const reasons: string[] = [];
        if (!title) reasons.push("Title is required");
        if (!customerName) reasons.push("Customer name is required");

        const stage = stageRaw ? normalizeStageLiteral(stageRaw) : undefined;
        if (!stage) {
          reasons.push(
            `Invalid stage "${raw.stage ?? ""}" — must be one of: ${Object.keys(IMPORT_STAGE_MAP).join(", ")}`,
          );
        }

        const dealValueRaw = raw.dealValue ?? 0;
        if (typeof dealValueRaw !== "number" || Number.isNaN(dealValueRaw) || dealValueRaw < 0) {
          reasons.push("Deal value must be a non-negative number");
        }

        const winProbabilityRaw = raw.winProbability ?? 50;
        if (
          typeof winProbabilityRaw !== "number" ||
          !Number.isInteger(winProbabilityRaw) ||
          winProbabilityRaw < 0 ||
          winProbabilityRaw > 100
        ) {
          reasons.push("Win probability must be an integer between 0 and 100");
        }

        const deadlineRaw = raw.deadline?.trim() || null;
        if (deadlineRaw && !isValidDayString(deadlineRaw)) {
          reasons.push("Deadline must be a valid yyyy-MM-dd date");
        }

        // Resolved eagerly (rather than left to a Prisma FK error on
        // create) so an unknown picId reports back a clean per-row reason
        // instead of a raw P2025 that would otherwise need catching.
        let picId: number | null = null;
        if (raw.picId !== undefined && raw.picId !== null) {
          const pic = await prisma.user.findUnique({ where: { id: raw.picId }, select: { id: true } });
          if (!pic) {
            reasons.push(`PIC with id ${raw.picId} not found`);
          } else {
            picId = raw.picId;
          }
        }

        // `|| !stage` is logically redundant (an undefined stage already
        // pushed a reason above, so reasons.length > 0 already holds) but
        // lets TS narrow `stage` from `PipelineStage | undefined` to
        // `PipelineStage` for every use below this point.
        if (reasons.length > 0 || !stage) {
          invalidCount++;
          results.push({ row: rowNum, status: "invalid", reason: reasons.join("; ") });
          continue;
        }

        const dupKey = `${title.toLowerCase()}||${customerName.toLowerCase()}`;
        if (seen.has(dupKey)) {
          skipCount++;
          results.push({
            row: rowNum,
            status: "skipped",
            reason: "Duplicate of an existing opportunity (same title + customer)",
          });
          continue;
        }

        const activityLog = raw.activityLog?.trim() || null;

        const created = await prisma.$transaction(async (tx) => {
          // Same bottom-append ordering POST "/" uses (finding S6): next
          // stageOrder is the current sibling count in that stage.
          const stageOrder = await tx.opportunity.count({ where: { stage } });
          const data: Prisma.OpportunityCreateInput = {
            title,
            customerName,
            stage,
            dealValue: toDealValue(dealValueRaw),
            productSolution: raw.productSolution?.trim() ?? "",
            leadSource: raw.leadSource?.trim() || null,
            winProbability: winProbabilityRaw,
            stageOrder,
          };
          if (picId !== null) data.pic = { connect: { id: picId } };
          if (deadlineRaw) data.deadline = utcMidnightOfDayString(deadlineRaw);
          // Same wonAt bookkeeping POST "/" applies when created directly
          // into WON (finding S2) — an import row landing straight in Won
          // is the same real flow as the per-column "+" create.
          if (stage === PipelineStage.WON) data.wonAt = new Date();

          const opportunity = await tx.opportunity.create({ data });

          if (activityLog) {
            await tx.opportunityActivity.create({
              data: { opportunityId: opportunity.id, userId, note: activityLog },
            });
          }

          return opportunity;
        });

        seen.add(dupKey);
        validCount++;
        results.push({ row: rowNum, status: "valid", id: created.id });
      }

      await prisma.pipelineImportLog.create({
        data: { userId, totalRows: rows.length, validCount, skipCount, invalidCount, status: "OK" },
      });

      res.json({ totalRows: rows.length, validCount, skipCount, invalidCount, results });
    } catch (err) {
      // A whole-call failure (e.g. the initial existing-opportunities fetch
      // itself throwing) — per-row failures never reach this catch, they're
      // handled inline as "invalid" results above. `PipelineImportLog.
      // errorMessage` is readable by any pipeline:view holder (GET
      // /opportunities/imports), so the raw error never lands there — it
      // could leak stack traces or other internal detail (finding N7). The
      // real error goes to the shared logger only; the persisted row gets a
      // generic, safe message. Best-effort log write: if the DB is
      // unreachable this insert will fail too, and the original error is
      // what the caller needs to see either way.
      logger.error({ err }, "opportunity import failed before completion");
      await prisma.pipelineImportLog
        .create({
          data: {
            userId,
            totalRows: rows.length,
            validCount,
            skipCount,
            invalidCount,
            status: "ERROR",
            errorMessage: "Import failed before completion",
          },
        })
        .catch((logErr: unknown) => {
          logger.error({ err: logErr }, "failed to write PipelineImportLog after import failure");
        });
      throw err;
    }
  },
);

opportunitiesRouter.patch(
  "/:id",
  validate("params", idParamSchema),
  validate("body", updateOpportunitySchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const body = req.body as z.infer<typeof updateOpportunitySchema>;
    const current = await findOpportunityOr404(id);
    assertCanWriteOpportunity(req.user!, "edit", current);

    const data: Prisma.OpportunityUpdateInput = {};
    if (body.title !== undefined) data.title = body.title;
    if (body.customerName !== undefined) data.customerName = body.customerName;
    if (body.dealValue !== undefined) data.dealValue = toDealValue(body.dealValue);
    // Relation `connect`/`disconnect` instead of a raw FK-scalar write —
    // house pattern (routes/projects.ts's `data.sa` PATCH) — so a
    // nonexistent user id 404s via Prisma's P2025 mapping instead of
    // 500ing on an unmapped P2003 FK violation (finding S1).
    if (body.picId !== undefined) {
      data.pic = body.picId === null ? { disconnect: true } : { connect: { id: body.picId } };
    }
    if (body.deadline !== undefined) {
      data.deadline = body.deadline === null ? null : utcMidnightOfDayString(body.deadline);
    }
    if (body.requestDate !== undefined) {
      data.requestDate = body.requestDate === null ? null : utcMidnightOfDayString(body.requestDate);
    }
    if (body.description !== undefined) data.description = body.description;
    if (body.productSolution !== undefined) data.productSolution = body.productSolution;
    if (body.leadSource !== undefined) data.leadSource = body.leadSource;
    if (body.winProbability !== undefined) data.winProbability = body.winProbability;

    const updated = await prisma.opportunity.update({
      where: { id },
      data,
      include: { pic: { select: PIC_SELECT } },
    });
    res.json(serializeOpportunity(updated));
  },
);

// The ONLY writer of stage changes. One transaction: resequence siblings in
// the old/new stage (dense 0..n-1 each), set/clear `wonAt` on a real
// transition into/out of WON, set/clear `preHoldStage` on a real transition
// into/out of HOLD (mirrors the reference's cron-driven auto-hold/restore —
// VeloraApp/lib/run-auto-hold-cron.ts — except here /move is the single
// writer for both manual and would-be-automated hold transitions, so the
// invariant is enforced on every stage change, not only the cron path), and
// log an OpportunityActivity — but only on an actual stage change, never a
// same-stage reorder.
opportunitiesRouter.post(
  "/:id/move",
  validate("params", idParamSchema),
  validate("body", moveOpportunitySchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const body = req.body as z.infer<typeof moveOpportunitySchema>;
    const current = await findOpportunityOr404(id);
    assertCanWriteOpportunity(req.user!, "edit", current);

    const sameStage = current.stage === body.stage;

    const updated = await prisma.$transaction(async (tx) => {
      if (!sameStage) {
        await closeGapInStage(tx, current.stage, id);
      }
      const finalStageOrder = await insertAtStage(tx, body.stage, id, body.stageOrder);

      const enteringWon = body.stage === PipelineStage.WON && current.stage !== PipelineStage.WON;
      const leavingWon = body.stage !== PipelineStage.WON && current.stage === PipelineStage.WON;
      const enteringHold = body.stage === PipelineStage.HOLD && current.stage !== PipelineStage.HOLD;
      const leavingHold = body.stage !== PipelineStage.HOLD && current.stage === PipelineStage.HOLD;

      const data: Prisma.OpportunityUncheckedUpdateInput = {
        stage: body.stage,
        stageOrder: finalStageOrder,
      };
      if (enteringWon) data.wonAt = new Date();
      if (leavingWon) data.wonAt = null;
      if (enteringHold) data.preHoldStage = current.stage;
      if (leavingHold) data.preHoldStage = null;

      const result = await tx.opportunity.update({
        where: { id },
        data,
        include: { pic: { select: PIC_SELECT } },
      });

      if (!sameStage) {
        await tx.opportunityActivity.create({
          data: {
            opportunityId: id,
            userId: req.user!.sub,
            note: `Moved from ${STAGE_LABELS[current.stage]} to ${STAGE_LABELS[body.stage]}`,
          },
        });
      }

      return result;
    });

    res.json(serializeOpportunity(updated));
  },
);

// The one writer of a PIC on an unassigned deal for `pipeline:edit_own`
// holders (docs/plans/claim-unassigned-deals.md D1/D2/D4) — PATCH keeps
// serving `edit_all` holders (any deal, any time) and a deal's own PIC
// (their own deal only); an unassigned deal stays locked for every other
// write (drag, edit, stage change, link, delete) until this route gives it
// a PIC. Logs the same kind of activity note POST /:id/move logs for a
// stage change, but only when the PIC actually changes (D6) — repeating the
// same picId on an already-assigned deal is a true no-op (no write, no
// note, `updatedAt` untouched), same idempotence POST /:id/move gives a
// same-stage reorder.
opportunitiesRouter.post(
  "/:id/assign",
  validate("params", idParamSchema),
  validate("body", assignOpportunitySchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const body = req.body as z.infer<typeof assignOpportunitySchema>;
    const current = await findOpportunityOr404(id);
    assertCanAssignOpportunity(req.user!, current);

    // Relation `connect` (not a raw FK-scalar write), same as PATCH/POST — a
    // nonexistent user id would otherwise 500 on an unmapped P2003 FK
    // violation instead of a clean 400. Fetched up front (rather than
    // caught from Prisma) because the username is needed for the activity
    // note either way (finding S1's pattern, reused here).
    const pic = await prisma.user.findUnique({
      where: { id: body.picId },
      select: { id: true, username: true },
    });
    if (!pic) throw new HttpError(400, "pic_not_found", "User not found");

    // D6: assigning a deal to its already-current PIC is a true no-op — no
    // write at all, not just a suppressed activity note. A plain
    // `tx.opportunity.update` with the same `pic.connect` would still bump
    // `updatedAt` even though nothing actually changed, so this short-circuits
    // before the transaction and re-serves the current row with the same
    // `pic` include the write path uses.
    if (current.picId === pic.id) {
      const unchanged = await prisma.opportunity.findUniqueOrThrow({
        where: { id },
        include: { pic: { select: PIC_SELECT } },
      });
      res.json(serializeOpportunity(unchanged as OpportunityWithPic));
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.opportunity.update({
        where: { id },
        data: { pic: { connect: { id: pic.id } } },
        include: { pic: { select: PIC_SELECT } },
      });

      await tx.opportunityActivity.create({
        data: {
          opportunityId: id,
          userId: req.user!.sub,
          note: `Assigned to ${pic.username}`,
        },
      });

      return result;
    });

    res.json(serializeOpportunity(updated));
  },
);

// Wrapped in a transaction so the delete and the sibling re-pack are atomic
// (finding S4): without closeGapInStage, a deleted middle-of-stage row left
// its stage's stageOrder sequence with a hole (e.g. 0, 2 after deleting the
// row at 1), and the count()-based "append at the bottom" logic both POST
// "/" and POST "/import" use would then hand that same slot to the next
// created/imported row, colliding with the sibling still sitting there.
opportunitiesRouter.delete("/:id", validate("params", idParamSchema), async (req, res) => {
  const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
  const current = await findOpportunityOr404(id);
  assertCanWriteOpportunity(req.user!, "delete", current);
  await prisma.$transaction(async (tx) => {
    await tx.opportunity.delete({ where: { id } });
    await closeGapInStage(tx, current.stage, id);
  });
  res.status(204).end();
});

// --- POST /:id/handoff ------------------------------------------------------
//
// Won-deal -> Solvro project handoff, ONE server transaction. Native-port
// simplification over the PRD's §2.10/§4.4 "frontend-orchestrated" flow
// (POST /projects then PATCH the deal's solvro_project_id from the browser,
// with a compensating "unlink" if the second call failed): with Pipeline
// now living inside this same backend and database, there's no second
// service to coordinate with, so the whole handoff — create the project,
// link the deal, log the activity — is one atomic unit. Either it all
// happens or none of it does; the PRD's compensating unlink has nothing
// left to compensate for.
//
// No unlink endpoint in v1 (deliberate): the only way `Opportunity.projectId`
// gets set is this route, and it only ever sets it once (see the
// already_linked guard below), so there's no "undo a bad automatic link"
// case to build for. If a link ever needs reversing by hand, that's an
// admin DB operation until a real product need for a route surfaces.

opportunitiesRouter.post(
  "/:id/handoff",
  validate("params", idParamSchema),
  validate("body", createProjectSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const body = req.body as z.infer<typeof createProjectSchema>;
    const current = await findOpportunityOr404(id);

    // Two gates compose here — the act both edits the deal (linking it) AND
    // creates a project. Deal-edit gate first, matching PATCH/:id and
    // /move's check order (a caller who can't touch this deal at all gets
    // that 403 before anything else); project:write checked explicitly
    // second since assertCanWriteOpportunity only ever covers the
    // pipeline:* half.
    assertCanWriteOpportunity(req.user!, "edit", current);
    if (!hasPermission(req.user!, "project:write")) {
      throw new HttpError(403, "forbidden", "Missing permission: project:write");
    }

    if (current.stage !== PipelineStage.WON) {
      throw new HttpError(409, "not_won", "Only a deal in stage WON can be handed off to a project");
    }
    if (current.projectId !== null) {
      throw new HttpError(409, "already_linked", "This deal is already linked to a project");
    }

    // Same default POST /projects applies when the body omits tamId: the
    // caller becomes the project's TAM.
    const tamId = body.tamId ?? req.user!.sub;

    // Customer Visibility (docs/plans/customer-visibility-spec.md §5.5,
    // Decision 7): same rule routes/projects.ts applies on POST / and
    // PATCH /:id — a customerId the caller can't see 400s before the deal
    // or any project row is touched.
    if (!(await isCustomerVisible(req.user!, body.customerId))) {
      throw new HttpError(400, "customer_not_found", "Customer not found");
    }

    const { project, opportunity } = await prisma.$transaction(async (tx) => {
      // Field-for-field mirror of POST /projects's `prisma.project.create`
      // call (routes/projects.ts) — that handler's only side effect beyond
      // the create itself is the tamId default applied above; it does no
      // baseline locking, section bootstrapping, or any other setup to
      // replicate here.
      const project = await tx.project.create({
        data: {
          name: body.name,
          description: body.description,
          saId: body.saId,
          tamId,
          customerId: body.customerId,
          status: body.status ?? "PLANNING",
          wipLimits: body.wipLimits ?? undefined,
          excludeFromPortfolio: body.excludeFromPortfolio ?? false,
        },
      });

      // Conditional update, not a plain `.update`: closes the race where
      // two handoff calls for the same deal both pass the pre-transaction
      // not_won/already_linked checks above before either commits. If
      // another request won that race, this updates 0 rows and throwing
      // here rolls back the whole transaction — including the project just
      // created above — so no orphaned, unlinked project is left behind.
      const linked = await tx.opportunity.updateMany({
        where: { id, projectId: null, stage: PipelineStage.WON },
        data: { projectId: project.id },
      });
      if (linked.count === 0) {
        // The pre-transaction not_won/already_linked checks above raced
        // with another request that committed in between (finding N7):
        // re-read the row inside this same transaction to report which
        // guard actually lost the race, rather than always assuming
        // already_linked — a concurrent move OUT of WON is just as
        // possible as a concurrent handoff by another caller, and the two
        // deserve their own distinct 409 codes same as the eager checks do.
        const latest = await tx.opportunity.findUniqueOrThrow({ where: { id } });
        if (latest.stage !== PipelineStage.WON) {
          throw new HttpError(409, "not_won", "Only a deal in stage WON can be handed off to a project");
        }
        throw new HttpError(409, "already_linked", "This deal was handed off by another request");
      }

      await tx.opportunityActivity.create({
        data: {
          opportunityId: id,
          userId: req.user!.sub,
          note: `Handed off to project "${project.name}"`,
        },
      });

      const opportunity = await tx.opportunity.findUniqueOrThrow({
        where: { id },
        include: { pic: { select: PIC_SELECT } },
      });

      return { project, opportunity };
    });

    res.status(201).json({ project, opportunity: serializeOpportunity(opportunity as OpportunityWithPic) });
  },
);
