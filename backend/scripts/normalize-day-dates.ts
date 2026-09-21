import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

/**
 * One-off repair for rows written by the pre-fix date-picker path
 * (`frontend/src/lib/dateField.ts`'s `isoFromDay`, before the
 * date-contract-utc-midnight phase), which serialized a picked calendar day
 * from LOCAL midnight instead of UTC midnight. East of UTC (e.g. UTC+7),
 * that shows up as the *previous* UTC day at a late time-of-day
 * (`17:00:00.000Z` for UTC+7). Post-fix, the canonical rule is: a
 * day-semantic value is always exactly `T00:00:00.000Z`.
 *
 * Day-semantic columns are exactly `Task.startDate`, `Task.dueDate`,
 * `Task.baselineStartDate`, `Task.baselineDueDate` (schema.prisma). Every
 * other DateTime column (`createdAt`, `updatedAt`, `baselineLockedAt`,
 * `receivedAt`, …) is a true instant and must never be touched here.
 *
 * Rounding rule:
 * - UTC time-of-day exactly `00:00:00.000` -> already canonical, untouched.
 * - `>= 12:00:00.000` -> round UP to the next UTC midnight (repairs
 *   east-of-UTC writes: the stored instant is the previous day at a late
 *   hour, and the intended picked day is the next UTC midnight).
 * - `< 12:00:00.000` -> round DOWN to the same UTC day's midnight (repairs
 *   a hypothetical west-of-UTC write).
 */
export function roundToUtcMidnight(d: Date): Date {
  const midnight = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const msIntoDay = d.getTime() - midnight.getTime();
  if (msIntoDay === 0) return d;

  const HALF_DAY_MS = 12 * 60 * 60 * 1000;
  if (msIntoDay >= HALF_DAY_MS) {
    return new Date(midnight.getTime() + 24 * 60 * 60 * 1000);
  }
  return midnight;
}

const DAY_COLUMNS = [
  "startDate",
  "dueDate",
  "baselineStartDate",
  "baselineDueDate",
] as const;
type DayColumn = (typeof DAY_COLUMNS)[number];

interface TaskDayRow {
  id: number;
  projectId: number;
  startDate: Date | null;
  dueDate: Date | null;
  baselineStartDate: Date | null;
  baselineDueDate: Date | null;
}

interface Flagged {
  taskId: number;
  projectId: number;
  column: DayColumn;
  oldValue: Date;
  newValue: Date;
}

function isNonMidnightUtc(d: Date): boolean {
  return (
    d.getUTCHours() !== 0 ||
    d.getUTCMinutes() !== 0 ||
    d.getUTCSeconds() !== 0 ||
    d.getUTCMilliseconds() !== 0
  );
}

function findFlagged(tasks: TaskDayRow[]): Flagged[] {
  const flagged: Flagged[] = [];
  for (const task of tasks) {
    for (const column of DAY_COLUMNS) {
      const value = task[column];
      if (value && isNonMidnightUtc(value)) {
        flagged.push({
          taskId: task.id,
          projectId: task.projectId,
          column,
          oldValue: value,
          newValue: roundToUtcMidnight(value),
        });
      }
    }
  }
  return flagged;
}

function printReport(flagged: Flagged[]): void {
  if (flagged.length === 0) {
    console.log(
      "No non-midnight day-semantic values found — nothing to normalize.",
    );
    return;
  }

  const distinctTasks = new Set(flagged.map((f) => f.taskId)).size;
  console.log(
    `Found ${flagged.length} non-midnight day-semantic value(s) across ${distinctTasks} task(s).\n`,
  );

  const byProject = new Map<number, number>();
  for (const f of flagged) {
    byProject.set(f.projectId, (byProject.get(f.projectId) ?? 0) + 1);
  }
  console.log("Per-project counts:");
  for (const [projectId, count] of [...byProject.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    console.log(`  project ${projectId}: ${count}`);
  }

  console.log("\nBefore -> after:");
  for (const f of flagged) {
    console.log(
      `  task ${f.taskId} ${f.column}: ${f.oldValue.toISOString()} -> ${f.newValue.toISOString()}`,
    );
  }

  const timeParts = new Map<string, number>();
  for (const f of flagged) {
    const timePart = f.oldValue.toISOString().slice(11); // "HH:mm:ss.sssZ"
    timeParts.set(timePart, (timeParts.get(timePart) ?? 0) + 1);
  }
  console.log("\nDistinct UTC time-parts among flagged rows:");
  for (const [timePart, count] of [...timeParts.entries()].sort()) {
    console.log(`  ${timePart}: ${count}`);
  }
}

// Prod safety valve: a full-table repair could in principle touch far more
// rows than dev's handful, so updates are chunked into transactions of this
// size rather than one unbounded $transaction covering every flagged row.
const APPLY_BATCH_SIZE = 500;

async function scan(prisma: PrismaClient): Promise<Flagged[]> {
  const tasks = await prisma.task.findMany({
    select: {
      id: true,
      projectId: true,
      startDate: true,
      dueDate: true,
      baselineStartDate: true,
      baselineDueDate: true,
    },
  });
  return findFlagged(tasks);
}

async function apply(prisma: PrismaClient, flagged: Flagged[]): Promise<void> {
  const totalBatches = Math.ceil(flagged.length / APPLY_BATCH_SIZE);
  for (let i = 0; i < flagged.length; i += APPLY_BATCH_SIZE) {
    const batch = flagged.slice(i, i + APPLY_BATCH_SIZE);
    await prisma.$transaction(
      batch.map((f) =>
        prisma.task.update({
          where: { id: f.taskId },
          data: { [f.column]: f.newValue },
        }),
      ),
    );
    const batchNumber = Math.floor(i / APPLY_BATCH_SIZE) + 1;
    const done = Math.min(i + APPLY_BATCH_SIZE, flagged.length);
    console.log(
      `  batch ${batchNumber}/${totalBatches}: applied (${done}/${flagged.length} total)`,
    );
  }
}

async function verify(prisma: PrismaClient): Promise<void> {
  const remaining = await scan(prisma);
  console.log(
    `\nVerification: ${remaining.length} remaining non-midnight day-semantic value(s) (expected 0).`,
  );
  if (remaining.length > 0) {
    for (const f of remaining) {
      console.log(
        `  STILL FLAGGED: task ${f.taskId} ${f.column}: ${f.oldValue.toISOString()}`,
      );
    }
  }
}

async function main(): Promise<void> {
  // Constructed here, not at module scope, so importing this module (e.g.
  // the pure `roundToUtcMidnight` helper test) can never open a DB
  // connection — only running the script directly does.
  const prisma = new PrismaClient();
  try {
    const shouldApply = process.argv.includes("--apply");

    const flagged = await scan(prisma);
    printReport(flagged);

    if (!shouldApply) {
      console.log(
        "\nDry run only — no changes made. Re-run with --apply to perform the update.",
      );
      return;
    }

    if (flagged.length === 0) {
      console.log("\nNothing to apply.");
      return;
    }

    const totalBatches = Math.ceil(flagged.length / APPLY_BATCH_SIZE);
    console.log(
      `\nApplying ${flagged.length} update(s) in ${totalBatches} batch(es) of up to ${APPLY_BATCH_SIZE}...`,
    );
    await apply(prisma, flagged);
    console.log("Apply complete.");
    await verify(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

// Only run when invoked directly (`npx tsx scripts/normalize-day-dates.ts`),
// never as a side effect of importing `roundToUtcMidnight` for the pure
// helper test — importing this module must never open a DB connection.
const isMainModule =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
