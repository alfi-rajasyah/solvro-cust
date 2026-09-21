import { fileURLToPath } from "node:url";
import { PrismaClient, PipelineStage } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { utcMidnightOfDayString } from "../src/lib/dateBoundary.js";

/**
 * M6.25 — one-time data copy from the standalone Velora opportunity tracker
 * (`../VeloraApp`, READ-ONLY reference; schema source of truth:
 * `VeloraApp/scripts/migrate.mjs`) into this repo's native Pipeline tables
 * (`schema.prisma`'s `Opportunity` / `OpportunityActivity` / `OpportunityLink`
 * models — see root CLAUDE.md's "Pipeline module is a NATIVE PORT" guardrail).
 *
 * Scope (decision, dispatch M6.25):
 *   - `profiles`         -> matched to an existing Solvro `User` by
 *                           case-insensitive email (via the linked
 *                           `users.email`). NEVER creates a user — an
 *                           unmatched profile maps to `null`, and every
 *                           opportunity/activity that referenced it imports
 *                           PIC-less / author-less. Collected in the report.
 *   - `opportunities`    -> `Opportunity` verbatim (same id, stage literals
 *                           mapped onto the PipelineStage enum, BigInt-safe
 *                           deal_value, createdAt/updatedAt preserved,
 *                           stage_order preserved as-is — never resequenced).
 *   - `activity_logs`    -> `OpportunityActivity` verbatim.
 *   - `opportunity_links`-> `OpportunityLink` verbatim.
 *   - Everything else in the source schema (Velora's `documents`,
 *     `settings`, `notification_rules`, `role_permissions`, `import_logs`,
 *     `cron_logs`, and any other table this run finds) is intentionally
 *     skipped. `collectSkippedTableCounts` enumerates and counts whatever
 *     else actually exists in the source rather than hardcoding a guess, so
 *     the report stays accurate as Velora's own schema drifts.
 *
 * Idempotent: every write is an upsert keyed on the source row's own UUID
 * (Velora and Solvro deliberately share the same id space). Re-running this
 * script updates existing rows instead of duplicating them — but note that
 * makes it a full-overwrite sync, not a merge: a deal a Solvro user has
 * since edited would be stomped by a re-run. That's the intended shape for
 * a one-time pre-launch cutover (plus dev-loop re-runs against an empty or
 * `*_test` target), not an ongoing sync after go-live.
 *
 * Schema drift on the source: this script never issues DDL against Velora
 * (it's READ-ONLY, full stop — see the guardrail above), so it can't assume
 * the live source has fully caught up to `migrate.mjs`'s final shape.
 * `opportunities.pre_hold_stage`, `opportunities.request_date`, and the
 * `opportunity_links` table are probed via `information_schema` at runtime;
 * when absent, they're treated as empty rather than erroring the run (with
 * a console note either way).
 *
 * Usage:
 *   docker compose exec backend npx tsx scripts/import-velora.ts --yes
 *
 * Env:
 *   DATABASE_URL         Target (Solvro) — required, already set in every
 *                         backend container. Refused unless its database
 *                         name is exactly "solvro" or ends in "_test" (see
 *                         `checkTargetSafety`) — this writes
 *                         production-shaped pipeline data.
 *   VELORA_DATABASE_URL  Source (Velora) — optional, defaults to the dev
 *                         compose network's `velora` database. At cutover,
 *                         pass the prod-restored Velora DB's URL instead:
 *                           VELORA_DATABASE_URL=postgresql://... \
 *                             npx tsx scripts/import-velora.ts --yes
 *
 * Confirmation: pass `--yes` on the command line, or set `CONFIRM=1`.
 */

const DEFAULT_VELORA_DATABASE_URL = "postgresql://velora:velora_dev@postgres:5432/velora";

// --- pure helpers (no DB) ---------------------------------------------------
// Kept free of any PrismaClient/env access so `test/importVelora.test.ts` can
// import them without ever opening a DB connection — same discipline
// scripts/normalize-day-dates.ts follows for `roundToUtcMidnight`.

// Velora's current schema (migrate.mjs) is a 9-literal lowercase CHECK
// constraint; this mirrors routes/opportunities.ts's IMPORT_STAGE_MAP but
// includes "hold" (that map deliberately excludes it — HOLD isn't a valid
// *import target* for the spreadsheet importer, but it's a perfectly normal
// row state in a live Velora export, so this migration script must handle
// it).
const STAGE_MAP: Record<string, PipelineStage> = {
  assessment: PipelineStage.ASSESSMENT,
  rfp: PipelineStage.RFP,
  poc: PipelineStage.POC,
  technical_clarification: PipelineStage.TECHNICAL_CLARIFICATION,
  deliver_proposal: PipelineStage.DELIVER_PROPOSAL,
  waiting_response: PipelineStage.WAITING_RESPONSE,
  won: PipelineStage.WON,
  drop: PipelineStage.DROP,
  hold: PipelineStage.HOLD,
};

// Velora's own migrate.mjs (scripts/migrate.mjs, lines ~62-74) carries a
// one-time UPDATE from these five pre-rename literals to their current
// equivalents. A source DB caught mid-migration, or restored from a backup
// taken before that UPDATE ran, could still hand us the old spelling —
// mapped here defensively so a stale snapshot doesn't hard-fail the row.
const LEGACY_STAGE_ALIASES: Record<string, string> = {
  lead: "assessment",
  qualified: "rfp",
  proposal: "deliver_proposal",
  negotiation: "waiting_response",
  lost: "drop",
};

export function mapStageLiteral(raw: string): PipelineStage | undefined {
  const normalized = raw.trim().toLowerCase();
  const canonical = LEGACY_STAGE_ALIASES[normalized] ?? normalized;
  return STAGE_MAP[canonical];
}

/** UTC-midnight `Date` for a "yyyy-MM-dd" day string, or `null` through. */
export function toDaySemanticDate(day: string | null): Date | null {
  if (!day) return null;
  return utcMidnightOfDayString(day);
}

/**
 * `stage_order` is meant to be dense (0..n-1) within each stage — the app
 * never resequences on read, it trusts the stored value (see
 * routes/opportunities.ts's stageSiblingIds/insertAtPosition). A source
 * export with gaps or duplicates would just... work oddly in the board, so
 * this flags it rather than silently repacking data we don't own.
 */
export function findNonDenseStageOrders(
  rows: { stage: string; stage_order: number }[],
): { stage: string; orders: number[] }[] {
  const byStage = new Map<string, number[]>();
  for (const r of rows) {
    const arr = byStage.get(r.stage) ?? [];
    arr.push(r.stage_order);
    byStage.set(r.stage, arr);
  }
  const problems: { stage: string; orders: number[] }[] = [];
  for (const [stage, orders] of byStage) {
    const sorted = [...orders].sort((a, b) => a - b);
    const isDense = sorted.every((value, index) => value === index);
    if (!isDense) problems.push({ stage, orders: sorted });
  }
  return problems.sort((a, b) => a.stage.localeCompare(b.stage));
}

export function buildEmailIndex(users: { id: number; email: string }[]): Map<string, number> {
  return new Map(users.map((u) => [u.email.trim().toLowerCase(), u.id]));
}

export function matchProfileToUser(email: string, index: Map<string, number>): number | null {
  return index.get(email.trim().toLowerCase()) ?? null;
}

/**
 * Safety valve (dispatch M6.25 requirement): refuses to run unless the
 * target names an obviously-intended database AND the caller explicitly
 * confirmed. Pure — takes its inputs as arguments rather than reading
 * process.env/argv directly — so it's unit-testable without a DB.
 */
export function checkTargetSafety(
  databaseUrl: string | undefined,
  confirmed: boolean,
): { ok: true } | { ok: false; reason: string } {
  if (!databaseUrl) {
    return { ok: false, reason: "DATABASE_URL is not set." };
  }
  let dbName: string;
  try {
    dbName = new URL(databaseUrl).pathname.replace(/^\//, "");
  } catch {
    return { ok: false, reason: `DATABASE_URL is not a valid URL: ${databaseUrl}` };
  }
  const allowedName = dbName === "solvro" || dbName.endsWith("_test");
  if (!allowedName) {
    return {
      ok: false,
      reason:
        `Refusing to run: target database "${dbName}" is neither "solvro" nor a "*_test" database. ` +
        "This script writes production-shaped pipeline data — point DATABASE_URL at the intended target.",
    };
  }
  if (!confirmed) {
    return {
      ok: false,
      reason:
        `Refusing to run without explicit confirmation. Pass --yes or set CONFIRM=1 to proceed against ` +
        `database "${dbName}".`,
    };
  }
  return { ok: true };
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "(unparseable URL)";
  }
}

// --- source row shapes -------------------------------------------------------

interface SourceProfileRow {
  id: string;
  full_name: string;
  role: string;
  email: string;
}

interface SourceOpportunityRow {
  id: string;
  title: string;
  customer_name: string;
  deal_value: string; // ::text cast — BigInt-safe regardless of driver bigint handling
  stage: string;
  pic_id: string | null;
  deadline: string | null; // ::text cast — "yyyy-MM-dd" or null
  description: string | null;
  product_solution: string;
  lead_source: string | null;
  win_probability: number;
  stage_order: number;
  created_at: Date;
  updated_at: Date;
  pre_hold_stage: string | null;
  request_date: string | null; // ::text cast — "yyyy-MM-dd" or null
}

interface SourceActivityRow {
  id: string;
  opportunity_id: string;
  user_id: string;
  note: string;
  created_at: Date;
}

interface SourceLinkRow {
  id: string;
  opportunity_id: string;
  label: string;
  url: string;
  created_at: Date;
}

// --- report shape -------------------------------------------------------------

interface EntityCounts {
  read: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}

function emptyCounts(): EntityCounts {
  return { read: 0, created: 0, updated: 0, skipped: 0, failed: 0 };
}

interface ImportReport {
  profiles: { read: number; matched: number; unmatched: number };
  unmatchedProfiles: { id: string; fullName: string; email: string; role: string }[];
  opportunities: EntityCounts;
  failedOpportunities: { id: string; title: string; reason: string }[];
  nonDenseStageOrders: { stage: string; orders: number[] }[];
  holdWarnings: { id: string; title: string; issue: string }[];
  // Velora's columns are unbounded TEXT while every Solvro write path caps
  // them (title/customerName 200, productSolution 500, leadSource 200,
  // description 5000). An over-length value still imports VERBATIM — never
  // truncated — but is reported here so the operator can shorten it
  // post-cutover; otherwise the deal 400s on its first UI edit.
  lengthWarnings: { id: string; title: string; issue: string }[];
  activities: EntityCounts;
  links: EntityCounts;
  skippedTables: Record<string, number>;
  hasHardFailure: boolean;
}

function emptyReport(): ImportReport {
  return {
    profiles: { read: 0, matched: 0, unmatched: 0 },
    unmatchedProfiles: [],
    opportunities: emptyCounts(),
    failedOpportunities: [],
    nonDenseStageOrders: [],
    holdWarnings: [],
    lengthWarnings: [],
    activities: emptyCounts(),
    links: emptyCounts(),
    skippedTables: {},
    hasHardFailure: false,
  };
}

// --- source introspection (READ-ONLY — never DDL against Velora) -------------

async function sourceHasColumn(velora: PrismaClient, table: string, column: string): Promise<boolean> {
  const rows = await velora.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     ) AS exists`,
    table,
    column,
  );
  return rows[0]?.exists === true;
}

async function sourceHasTable(velora: PrismaClient, table: string): Promise<boolean> {
  const rows = await velora.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    table,
  );
  return rows[0]?.exists === true;
}

const IMPORTED_TABLES = new Set(["users", "profiles", "opportunities", "activity_logs", "opportunity_links"]);

/**
 * Enumerates every other base table the source actually has and counts its
 * rows, rather than hardcoding the skip list the dispatch brief names
 * (`documents`, `settings`, `notification_rules`, `role_permissions`,
 * `import_logs`, `cron_logs`, ...) — Velora's own schema has already drifted
 * once (see the module doc comment), so a hardcoded list would silently go
 * stale the next time it does.
 */
async function collectSkippedTableCounts(velora: PrismaClient): Promise<Record<string, number>> {
  const tables = await velora.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );
  const skipped: Record<string, number> = {};
  for (const { table_name } of tables) {
    if (IMPORTED_TABLES.has(table_name)) continue;
    // table_name is enumerated from the catalog itself, never user input —
    // safe to interpolate into an identifier position.
    const countRows = await velora.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::bigint AS count FROM "${table_name}"`,
    );
    skipped[table_name] = Number(countRows[0]?.count ?? 0n);
  }
  return skipped;
}

// --- profiles -> Solvro users --------------------------------------------------

async function fetchSourceProfiles(velora: PrismaClient): Promise<SourceProfileRow[]> {
  return velora.$queryRawUnsafe<SourceProfileRow[]>(
    `SELECT p.id::text AS id, p.full_name, p.role, u.email
     FROM profiles p
     JOIN users u ON u.id = p.id
     ORDER BY p.created_at`,
  );
}

async function buildProfileMap(
  prisma: PrismaClient,
  velora: PrismaClient,
  report: ImportReport,
): Promise<Map<string, number | null>> {
  const profiles = await fetchSourceProfiles(velora);
  report.profiles.read = profiles.length;

  const targetUsers = await prisma.user.findMany({ select: { id: true, email: true } });
  const emailIndex = buildEmailIndex(targetUsers);

  const map = new Map<string, number | null>();
  for (const p of profiles) {
    const userId = matchProfileToUser(p.email, emailIndex);
    map.set(p.id, userId);
    if (userId === null) {
      report.unmatchedProfiles.push({ id: p.id, fullName: p.full_name, email: p.email, role: p.role });
    }
  }
  report.profiles.unmatched = report.unmatchedProfiles.length;
  report.profiles.matched = profiles.length - report.profiles.unmatched;
  return map;
}

// --- opportunities --------------------------------------------------------------

const OPP_BATCH_SIZE = 100;

async function fetchSourceOpportunities(velora: PrismaClient): Promise<SourceOpportunityRow[]> {
  const hasPreHold = await sourceHasColumn(velora, "opportunities", "pre_hold_stage");
  const hasRequestDate = await sourceHasColumn(velora, "opportunities", "request_date");
  if (!hasPreHold) {
    console.log('  note: source "opportunities" has no pre_hold_stage column yet — importing null for every row.');
  }
  if (!hasRequestDate) {
    console.log('  note: source "opportunities" has no request_date column yet — importing null for every row.');
  }
  const preHoldSelect = hasPreHold ? "pre_hold_stage" : "NULL";
  const requestDateSelect = hasRequestDate ? "request_date::text" : "NULL";
  return velora.$queryRawUnsafe<SourceOpportunityRow[]>(`
    SELECT
      id::text AS id,
      title,
      customer_name,
      deal_value::text AS deal_value,
      stage,
      pic_id::text AS pic_id,
      deadline::text AS deadline,
      description,
      product_solution,
      lead_source,
      win_probability,
      stage_order,
      created_at,
      updated_at,
      ${preHoldSelect} AS pre_hold_stage,
      ${requestDateSelect} AS request_date
    FROM opportunities
    ORDER BY stage, stage_order, created_at
  `);
}

/**
 * Shared scalar fields for both create and update. Deliberately the
 * "Unchecked" input shape (plain `picId: number | null`) rather than the
 * relation `pic: { connect/disconnect }` form routes/opportunities.ts's
 * interactive PATCH handler uses: verified empirically (two isolated
 * `solvro_test` runs, see M6.25 dispatch report) that Prisma 5's query
 * engine silently re-stamps `@updatedAt` to "now" — ignoring this script's
 * explicit `updatedAt` value entirely — whenever an `update`'s data
 * includes a relation `disconnect`, while a plain scalar FK write in the
 * same call does not. Since every `picId`/`userId` here already comes from
 * a live target `User.id` (built off `prisma.user.findMany()` — see
 * `buildProfileMap`), the P2025-vs-P2003 error-mapping benefit that
 * connect/disconnect buys an interactive route doesn't apply to this
 * internal batch script, so there's no downside to the scalar form here.
 */
function buildOpportunityData(
  row: SourceOpportunityRow,
  stage: PipelineStage,
  picId: number | null,
  preHoldStage: PipelineStage | null,
): Prisma.OpportunityUncheckedCreateInput {
  // Velora has no won_at column (confirmed against both
  // VeloraApp/scripts/migrate.mjs and VeloraApp/docker/init.sql —
  // VeloraApp's own components/kanban/kpi-bar.tsx documents the same gap:
  // "uses updated_at as proxy for won_at ... Acceptable until a won_at
  // field is added"). Mirrored here for historical WON deals so Solvro's
  // "Won this month" KPI has something to work with; same caveat the
  // source app already accepts (a deal edited after being won carries the
  // later updatedAt). Flagged in the dispatch report as an explicit call.
  const wonAt = stage === PipelineStage.WON ? row.updated_at : null;
  return {
    id: row.id,
    title: row.title,
    customerName: row.customer_name,
    dealValue: BigInt(row.deal_value),
    stage,
    picId,
    deadline: toDaySemanticDate(row.deadline),
    requestDate: toDaySemanticDate(row.request_date),
    description: row.description,
    productSolution: row.product_solution,
    leadSource: row.lead_source,
    winProbability: row.win_probability,
    stageOrder: row.stage_order,
    preHoldStage,
    wonAt,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function existingOpportunityIds(prisma: PrismaClient, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await prisma.opportunity.findMany({ where: { id: { in: ids } }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

async function importOpportunities(
  prisma: PrismaClient,
  velora: PrismaClient,
  profileMap: Map<string, number | null>,
  report: ImportReport,
): Promise<Set<string>> {
  const rows = await fetchSourceOpportunities(velora);
  report.opportunities.read = rows.length;
  report.nonDenseStageOrders = findNonDenseStageOrders(rows);

  const successfulIds = new Set<string>();

  for (const batch of chunk(rows, OPP_BATCH_SIZE)) {
    const existingIds = await existingOpportunityIds(prisma, batch.map((r) => r.id));

    const valid: { row: SourceOpportunityRow; stage: PipelineStage; picId: number | null; preHoldStage: PipelineStage | null }[] =
      [];
    for (const row of batch) {
      const stage = mapStageLiteral(row.stage);
      if (!stage) {
        report.opportunities.failed += 1;
        report.hasHardFailure = true;
        report.failedOpportunities.push({
          id: row.id,
          title: row.title,
          reason: `unrecognized stage literal "${row.stage}"`,
        });
        continue;
      }

      let preHoldStage: PipelineStage | null = null;
      if (row.pre_hold_stage) {
        const mapped = mapStageLiteral(row.pre_hold_stage);
        if (mapped) {
          preHoldStage = mapped;
        } else {
          report.holdWarnings.push({
            id: row.id,
            title: row.title,
            issue: `unmapped pre_hold_stage literal "${row.pre_hold_stage}"`,
          });
        }
      }
      if (stage === PipelineStage.HOLD && preHoldStage === null) {
        report.holdWarnings.push({ id: row.id, title: row.title, issue: "HOLD deal missing pre_hold_stage" });
      }

      // Field-length audit (see ImportReport.lengthWarnings): report, never
      // truncate — bounds mirror routes/opportunities.ts's update schema.
      const FIELD_LIMITS: [field: string, value: string | null, max: number][] = [
        ["title", row.title, 200],
        ["customerName", row.customer_name, 200],
        ["productSolution", row.product_solution, 500],
        ["leadSource", row.lead_source, 200],
        ["description", row.description, 5000],
      ];
      for (const [field, value, max] of FIELD_LIMITS) {
        if (value && value.length > max) {
          report.lengthWarnings.push({
            id: row.id,
            title: row.title,
            issue: `${field} is ${value.length} chars (Solvro limit ${max}) — edit will fail until shortened`,
          });
        }
      }

      const picId = row.pic_id ? profileMap.get(row.pic_id) ?? null : null;
      valid.push({ row, stage, picId, preHoldStage });
    }

    if (valid.length === 0) continue;

    try {
      await prisma.$transaction(
        valid.map(({ row, stage, picId, preHoldStage }) => {
          const { id, ...update } = buildOpportunityData(row, stage, picId, preHoldStage);
          return prisma.opportunity.upsert({
            where: { id: row.id },
            create: { id, ...update },
            update,
          });
        }),
      );
      for (const { row } of valid) {
        successfulIds.add(row.id);
        if (existingIds.has(row.id)) report.opportunities.updated += 1;
        else report.opportunities.created += 1;
      }
    } catch (err) {
      report.hasHardFailure = true;
      const message = errorMessage(err);
      console.error(`  ! opportunity batch of ${valid.length} failed: ${message}`);
      for (const { row } of valid) {
        report.opportunities.failed += 1;
        report.failedOpportunities.push({ id: row.id, title: row.title, reason: `batch write failed: ${message}` });
      }
    }
  }

  return successfulIds;
}

// --- activity_logs ----------------------------------------------------------------

const ACTIVITY_BATCH_SIZE = 200;

async function fetchSourceActivities(velora: PrismaClient): Promise<SourceActivityRow[]> {
  return velora.$queryRawUnsafe<SourceActivityRow[]>(`
    SELECT id::text AS id, opportunity_id::text AS opportunity_id, user_id::text AS user_id, note, created_at
    FROM activity_logs
    ORDER BY created_at
  `);
}

async function existingActivityIds(prisma: PrismaClient, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await prisma.opportunityActivity.findMany({ where: { id: { in: ids } }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

async function importActivities(
  prisma: PrismaClient,
  velora: PrismaClient,
  profileMap: Map<string, number | null>,
  importedOpportunityIds: Set<string>,
  report: ImportReport,
): Promise<void> {
  const rows = await fetchSourceActivities(velora);
  report.activities.read = rows.length;

  for (const batch of chunk(rows, ACTIVITY_BATCH_SIZE)) {
    const eligible = batch.filter((row) => {
      const ok = importedOpportunityIds.has(row.opportunity_id);
      if (!ok) report.activities.skipped += 1;
      return ok;
    });
    if (eligible.length === 0) continue;

    const existingIds = await existingActivityIds(prisma, eligible.map((r) => r.id));

    try {
      await prisma.$transaction(
        eligible.map((row) => {
          const userId = profileMap.get(row.user_id) ?? null;
          // Scalar `userId` (Unchecked input), not relation
          // connect/disconnect — same `@updatedAt`-stomping bug as
          // Opportunity.picId above (buildOpportunityData's doc comment),
          // and OpportunityActivity has no updatedAt column so there's
          // nothing to lose by using the plain scalar form here either.
          const create: Prisma.OpportunityActivityUncheckedCreateInput = {
            id: row.id,
            opportunityId: row.opportunity_id,
            userId,
            note: row.note,
            createdAt: row.created_at,
          };
          const update: Prisma.OpportunityActivityUncheckedUpdateInput = {
            userId,
            note: row.note,
            createdAt: row.created_at,
          };
          return prisma.opportunityActivity.upsert({ where: { id: row.id }, create, update });
        }),
      );
      for (const row of eligible) {
        if (existingIds.has(row.id)) report.activities.updated += 1;
        else report.activities.created += 1;
      }
    } catch (err) {
      report.hasHardFailure = true;
      console.error(`  ! activity batch of ${eligible.length} failed: ${errorMessage(err)}`);
      report.activities.failed += eligible.length;
    }
  }
}

// --- opportunity_links --------------------------------------------------------------

const LINK_BATCH_SIZE = 200;

async function fetchSourceLinks(velora: PrismaClient): Promise<SourceLinkRow[]> {
  return velora.$queryRawUnsafe<SourceLinkRow[]>(`
    SELECT id::text AS id, opportunity_id::text AS opportunity_id, label, url, created_at
    FROM opportunity_links
    ORDER BY created_at
  `);
}

async function existingLinkIds(prisma: PrismaClient, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await prisma.opportunityLink.findMany({ where: { id: { in: ids } }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

async function importLinks(
  prisma: PrismaClient,
  velora: PrismaClient,
  importedOpportunityIds: Set<string>,
  report: ImportReport,
): Promise<void> {
  const hasTable = await sourceHasTable(velora, "opportunity_links");
  if (!hasTable) {
    console.log('  note: source has no "opportunity_links" table yet — 0 read, 0 imported.');
    return;
  }

  const rows = await fetchSourceLinks(velora);
  report.links.read = rows.length;

  for (const batch of chunk(rows, LINK_BATCH_SIZE)) {
    const eligible = batch.filter((row) => {
      const ok = importedOpportunityIds.has(row.opportunity_id);
      if (!ok) report.links.skipped += 1;
      return ok;
    });
    if (eligible.length === 0) continue;

    const existingIds = await existingLinkIds(prisma, eligible.map((r) => r.id));

    try {
      await prisma.$transaction(
        eligible.map((row) =>
          prisma.opportunityLink.upsert({
            where: { id: row.id },
            create: {
              id: row.id,
              label: row.label,
              url: row.url,
              createdAt: row.created_at,
              opportunity: { connect: { id: row.opportunity_id } },
            },
            update: {
              label: row.label,
              url: row.url,
              createdAt: row.created_at,
            },
          }),
        ),
      );
      for (const row of eligible) {
        if (existingIds.has(row.id)) report.links.updated += 1;
        else report.links.created += 1;
      }
    } catch (err) {
      report.hasHardFailure = true;
      console.error(`  ! link batch of ${eligible.length} failed: ${errorMessage(err)}`);
      report.links.failed += eligible.length;
    }
  }
}

// --- report printing ----------------------------------------------------------------

function printReport(report: ImportReport): void {
  console.log("\n===== Velora import summary =====\n");

  console.log(
    `profiles:      read ${report.profiles.read}, matched ${report.profiles.matched}, unmatched ${report.profiles.unmatched}`,
  );
  if (report.unmatchedProfiles.length > 0) {
    console.log("  unmatched profiles (no Solvro user with a matching email — imported as PIC-less/author-less):");
    for (const p of report.unmatchedProfiles) {
      console.log(`    - ${p.fullName} <${p.email}> (role: ${p.role}, velora profile id: ${p.id})`);
    }
  }

  console.log(
    `\nopportunities: read ${report.opportunities.read}, created ${report.opportunities.created}, ` +
      `updated ${report.opportunities.updated}, failed ${report.opportunities.failed}`,
  );
  if (report.failedOpportunities.length > 0) {
    console.log("  failed rows:");
    for (const f of report.failedOpportunities) {
      console.log(`    - ${f.title} (${f.id}): ${f.reason}`);
    }
  }
  if (report.nonDenseStageOrders.length > 0) {
    console.log("  non-dense stage_order within a stage (NOT resequenced — reported only):");
    for (const p of report.nonDenseStageOrders) {
      console.log(`    - stage "${p.stage}": orders [${p.orders.join(", ")}]`);
    }
  }
  if (report.holdWarnings.length > 0) {
    console.log("  HOLD / pre_hold_stage warnings:");
    for (const w of report.holdWarnings) {
      console.log(`    - ${w.title} (${w.id}): ${w.issue}`);
    }
  }
  if (report.lengthWarnings.length > 0) {
    console.log("  over-length fields (imported verbatim — shorten post-cutover or edits will 400):");
    for (const w of report.lengthWarnings) {
      console.log(`    - ${w.title} (${w.id}): ${w.issue}`);
    }
  }

  console.log(
    `\nactivities:    read ${report.activities.read}, created ${report.activities.created}, ` +
      `updated ${report.activities.updated}, skipped ${report.activities.skipped}, failed ${report.activities.failed}`,
  );
  console.log(
    `links:         read ${report.links.read}, created ${report.links.created}, ` +
      `updated ${report.links.updated}, skipped ${report.links.skipped}, failed ${report.links.failed}`,
  );

  const skippedEntries = Object.entries(report.skippedTables);
  console.log("\nskipped tables (decision — not imported):");
  if (skippedEntries.length === 0) {
    console.log("  (none found beyond the imported set)");
  } else {
    for (const [table, count] of skippedEntries) {
      console.log(`    - ${table}: ${count} row(s)`);
    }
  }

  console.log(`\n${report.hasHardFailure ? "COMPLETED WITH FAILURES — see above" : "OK"}\n`);
}

// --- entrypoint ----------------------------------------------------------------------

async function main(): Promise<void> {
  const confirmed = process.argv.includes("--yes") || process.env.CONFIRM === "1";
  const safety = checkTargetSafety(process.env.DATABASE_URL, confirmed);
  if (!safety.ok) {
    console.error(safety.reason);
    process.exit(1);
  }

  const veloraUrl = process.env.VELORA_DATABASE_URL ?? DEFAULT_VELORA_DATABASE_URL;

  // Constructed here, not at module scope — importing this module (e.g. the
  // pure helpers above, from test/importVelora.test.ts) must never open a
  // DB connection. Same discipline scripts/normalize-day-dates.ts follows.
  const prisma = new PrismaClient();
  const velora = new PrismaClient({ datasources: { db: { url: veloraUrl } } });

  const report = emptyReport();

  try {
    console.log(`Source (Velora): ${redactUrl(veloraUrl)}`);
    console.log(`Target (Solvro): ${redactUrl(process.env.DATABASE_URL as string)}\n`);

    console.log("Matching profiles -> Solvro users by email...");
    const profileMap = await buildProfileMap(prisma, velora, report);

    console.log("Importing opportunities...");
    const importedOpportunityIds = await importOpportunities(prisma, velora, profileMap, report);

    console.log("Importing activity logs...");
    await importActivities(prisma, velora, profileMap, importedOpportunityIds, report);

    console.log("Importing opportunity links...");
    await importLinks(prisma, velora, importedOpportunityIds, report);

    console.log("Counting skipped tables...");
    report.skippedTables = await collectSkippedTableCounts(velora);

    printReport(report);
  } finally {
    await prisma.$disconnect();
    await velora.$disconnect();
  }

  if (report.hasHardFailure) {
    process.exit(1);
  }
}

// Only run when invoked directly (`npx tsx scripts/import-velora.ts`), never
// as a side effect of importing a pure helper for tests.
const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
