import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

// Runs once before the whole test run (vitest `globalSetup`). Applies every
// migration (including 20260707013113_add_task_position) to the disposable
// Postgres container so the schema matches prisma/schema.prisma exactly —
// same as a fresh deploy would. Then truncates every table so each `npm
// test` invocation starts from a clean, empty `solvro_test` database
// instead of accumulating rows across runs (the root cause of the
// `taskOrdering.test.ts` take-200 accumulation flake — see
// backend/CLAUDE.md and docs/ISSUES.md).
export default async function setup() {
  const databaseUrl =
    process.env.DATABASE_URL ?? "postgresql://solvro:test@localhost:5433/solvro?schema=public";
  // Guard BEFORE anything touches the database — `prisma migrate deploy` is
  // itself a write path, so a misconfigured DATABASE_URL must fail here,
  // before migrating (let alone truncating) whatever database it points at.
  assertIsolatedTestDatabase(databaseUrl);
  execSync("npx prisma migrate deploy", {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  await truncateAllTables(databaseUrl);
}

// Hard safety guard: this function is destructive (TRUNCATE ... CASCADE on
// every table), so it must be structurally incapable of running against the
// dev database even if DATABASE_URL is misconfigured — e.g. a plain
// `docker compose exec backend npm test` that inherits the container's dev
// DATABASE_URL (see backend/CLAUDE.md's trap note). Only a database whose
// name is exactly `solvro_test` or otherwise ends in `_test` qualifies.
function assertIsolatedTestDatabase(databaseUrl: string): string {
  const dbName = new URL(databaseUrl).pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test")) {
    throw new Error(
      `Refusing to truncate: DATABASE_URL points at database "${dbName}", which does not ` +
        'end in "_test". Table truncation only ever runs against an isolated *_test ' +
        "database (e.g. solvro_test) — see backend/CLAUDE.md's isolated-DB invocation.",
    );
  }
  return dbName;
}

async function truncateAllTables(databaseUrl: string): Promise<void> {
  assertIsolatedTestDatabase(databaseUrl);
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const tables = await prisma.$queryRaw<
      { tablename: string }[]
    >`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '_prisma_migrations'`;
    if (tables.length === 0) return;
    const tableList = tables.map((t) => `"${t.tablename}"`).join(", ");
    // Single statement so table order doesn't matter — CASCADE covers any
    // FK reference among the listed tables regardless of declaration order.
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE;`);
  } finally {
    await prisma.$disconnect();
  }
}
