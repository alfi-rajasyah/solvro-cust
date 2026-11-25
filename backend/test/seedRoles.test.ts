// The seed runs on every container start (setup.sh). It must create a missing
// built-in role but never overwrite an existing one, or an admin's edit in
// Admin > Roles is lost at the next restart (prisma/builtInRoles.ts). The
// 20261025090000_builtin_roles_last_reset migration resets the roles once for
// databases upgraded from a version whose seed did overwrite.
import "./env.js";
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { ensureBuiltInRoles, ROLE_PERMISSIONS } from "../prisma/builtInRoles.js";
import { createAdminAndToken, seedRoles } from "./testAuth.js";

const MIGRATION = new URL(
  "../prisma/migrations/20261025090000_builtin_roles_last_reset/migration.sql",
  import.meta.url,
);

const CUSTOMER_MIGRATION = new URL(
  "../prisma/migrations/20261103090000_customer_permissions/migration.sql",
  import.meta.url,
);

const WEBHOOKS_MIGRATION = new URL(
  "../prisma/migrations/20261125120000_webhooks/migration.sql",
  import.meta.url,
);

const WEBHOOKS_ROLE_MARKER = "-- Built-in TAM and STAKEHOLDER roles gain";

async function runMigration(url: URL, fromMarker?: string): Promise<void> {
  let sql = readFileSync(url, "utf8");
  // The webhooks migration also creates tables, so a test replays only its
  // role backfill, which starts at the marker comment.
  if (fromMarker) sql = sql.slice(sql.indexOf(fromMarker));
  const statements = sql
    .split("\n")
    .filter((line) => !line.startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) await prisma.$executeRawUnsafe(statement);
}

async function permissionsOf(roleName: string): Promise<unknown> {
  return (await prisma.role.findUniqueOrThrow({ where: { roleName } })).permissions;
}

beforeEach(async () => {
  await seedRoles();
});

afterAll(async () => {
  // Leave the canonical permissions for the files that run after this one.
  await seedRoles();
});

describe("ensureBuiltInRoles", () => {
  it("keeps an admin's edit to a built-in role", async () => {
    const edited = ["project:read", "task:read"];
    await prisma.role.update({ where: { roleName: "TAM" }, data: { permissions: edited } });
    await prisma.role.update({
      where: { roleName: "STAKEHOLDER" },
      data: { permissions: ["project:read", "task:comment", "project:view-all"] },
    });

    await ensureBuiltInRoles(prisma);

    expect(await permissionsOf("TAM")).toEqual(edited);
    expect(await permissionsOf("STAKEHOLDER")).toEqual(["project:read", "task:comment", "project:view-all"]);
  });

  it("creates a missing built-in role with its default permissions", async () => {
    const upserts: unknown[] = [];
    const db = {
      role: {
        upsert: async (args: unknown) => {
          upserts.push(args);
          return {} as never;
        },
      },
    } as unknown as Parameters<typeof ensureBuiltInRoles>[0];

    await ensureBuiltInRoles(db);

    expect(upserts).toEqual(
      Object.entries(ROLE_PERMISSIONS).map(([roleName, permissions]) => ({
        where: { roleName },
        update: {},
        create: { roleName, permissions },
      })),
    );
  });
});

describe("builtin_roles_last_reset migration", () => {
  it("resets edited built-in roles to the defaults and drops view-all from STAKEHOLDER", async () => {
    await prisma.role.update({ where: { roleName: "TAM" }, data: { permissions: ["project:read"] } });
    await prisma.role.update({
      where: { roleName: "STAKEHOLDER" },
      data: { permissions: ["project:read", "task:comment", "project:view-all"] },
    });
    const custom = await prisma.role.create({
      data: { roleName: `Custom ${Date.now()}`, permissions: ["project:view-all"] },
    });

    // Migrations run in order: the reset, the customer-permissions backfill,
    // then the webhook permission backfill.
    await runMigration(MIGRATION);
    await runMigration(CUSTOMER_MIGRATION);
    await runMigration(WEBHOOKS_MIGRATION, WEBHOOKS_ROLE_MARKER);

    // Same set of permissions; the backfill appends, so order may differ.
    for (const [roleName, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      expect([...((await permissionsOf(roleName)) as string[])].sort()).toEqual([...permissions].sort());
    }
    // Custom roles are not touched.
    expect(await permissionsOf(custom.roleName)).toEqual(["project:view-all"]);
    await prisma.role.delete({ where: { id: custom.id } });
  });
});

describe("customer_permissions migration", () => {
  it("adds customer:read/write beside project:read/write, idempotently, leaving * and others alone", async () => {
    const stamp = Date.now();
    const make = (suffix: string, permissions: string[]) =>
      prisma.role.create({ data: { roleName: `Mig ${suffix} ${stamp}`, permissions } });
    const rw = await make("rw", ["project:read", "project:write", "task:read"]);
    const ro = await make("ro", ["project:read"]);
    const star = await make("star", ["*"]);
    const none = await make("none", ["task:read"]);
    const done = await make("done", ["project:read", "customer:read"]);

    await runMigration(CUSTOMER_MIGRATION);
    await runMigration(CUSTOMER_MIGRATION);

    expect(await permissionsOf(rw.roleName)).toEqual(["project:read", "project:write", "task:read", "customer:read", "customer:write"]);
    expect(await permissionsOf(ro.roleName)).toEqual(["project:read", "customer:read"]);
    expect(await permissionsOf(star.roleName)).toEqual(["*"]);
    expect(await permissionsOf(none.roleName)).toEqual(["task:read"]);
    expect(await permissionsOf(done.roleName)).toEqual(["project:read", "customer:read"]);
    await prisma.role.deleteMany({ where: { id: { in: [rw.id, ro.id, star.id, none.id, done.id] } } });
  });
});

describe("webhooks migration", () => {
  it("gives the built-in TAM and STAKEHOLDER roles webhook:manage, idempotently, leaving ADMIN and custom roles alone", async () => {
    await prisma.role.update({ where: { roleName: "TAM" }, data: { permissions: ["project:read"] } });
    await prisma.role.update({ where: { roleName: "STAKEHOLDER" }, data: { permissions: ["project:read", "webhook:manage"] } });
    const custom = await prisma.role.create({
      data: { roleName: `Custom wh ${Date.now()}`, permissions: ["project:read"] },
    });

    await runMigration(WEBHOOKS_MIGRATION, WEBHOOKS_ROLE_MARKER);
    await runMigration(WEBHOOKS_MIGRATION, WEBHOOKS_ROLE_MARKER);

    expect(await permissionsOf("TAM")).toEqual(["project:read", "webhook:manage"]);
    expect(await permissionsOf("STAKEHOLDER")).toEqual(["project:read", "webhook:manage"]);
    expect(await permissionsOf("ADMIN")).toEqual(["*"]);
    expect(await permissionsOf(custom.roleName)).toEqual(["project:read"]);
    await prisma.role.delete({ where: { id: custom.id } });
  });

  it("ships webhook:manage in the built-in TAM and STAKEHOLDER defaults but not ADMIN or PENDING", () => {
    expect(ROLE_PERMISSIONS.TAM).toContain("webhook:manage");
    expect(ROLE_PERMISSIONS.STAKEHOLDER).toContain("webhook:manage");
    expect(ROLE_PERMISSIONS.ADMIN).toEqual(["*"]);
    expect(ROLE_PERMISSIONS.PENDING).toEqual([]);
  });

  it("stamps rows that existed before the column as dispatched, leaves no default, and keeps the partial queue index", async () => {
    // Replays the migration's own ALTER TABLE statements for activity_events on a
    // scratch table that already holds rows.
    const sql = readFileSync(WEBHOOKS_MIGRATION, "utf8");
    const alters = sql.split(";").map((statement) =>
      statement
        .split("\n")
        .filter((line) => !line.startsWith("--"))
        .join("\n")
        .trim(),
    ).filter((statement) => statement.startsWith('ALTER TABLE "activity_events"') && statement.includes("webhook_dispatched_at"));
    expect(alters).toHaveLength(2);

    await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "wh_probe"');
    await prisma.$executeRawUnsafe('CREATE TABLE "wh_probe" ("id" SERIAL PRIMARY KEY)');
    await prisma.$executeRawUnsafe('INSERT INTO "wh_probe" DEFAULT VALUES');
    try {
      for (const alter of alters) await prisma.$executeRawUnsafe(alter.replace('"activity_events"', '"wh_probe"'));
      await prisma.$executeRawUnsafe('INSERT INTO "wh_probe" DEFAULT VALUES');
      const rows = await prisma.$queryRawUnsafe<{ id: number; webhook_dispatched_at: Date | null }[]>(
        'SELECT "id", "webhook_dispatched_at" FROM "wh_probe" ORDER BY "id"',
      );
      expect(rows[0].webhook_dispatched_at).not.toBeNull(); // existed before the column
      expect(rows[1].webhook_dispatched_at).toBeNull(); // new rows start undispatched: no default left
    } finally {
      await prisma.$executeRawUnsafe('DROP TABLE "wh_probe"');
    }

    const idx = await prisma.$queryRawUnsafe<{ indexdef: string }[]>(
      "SELECT indexdef FROM pg_indexes WHERE indexname = 'activity_events_webhook_pending_idx'",
    );
    expect(idx).toHaveLength(1);
    expect(idx[0].indexdef).toMatch(/WHERE \(?"?webhook_dispatched_at"? IS NULL\)?/);
  });
});

// With the seed no longer resetting roles, the API keeps PENDING (what every
// first-time Google sign-in gets) without permissions.
describe("PATCH /admin/roles/:id on PENDING", () => {
  it("refuses any permission and accepts an empty list", async () => {
    const app = createApp();
    const { token } = await createAdminAndToken();
    const pending = await prisma.role.findUniqueOrThrow({ where: { roleName: "PENDING" } });

    const changed = await request(app)
      .patch(`/admin/roles/${pending.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ permissions: ["project:read"] });
    expect(changed.status).toBe(400);
    expect(changed.body.code).toBe("role_protected");
    expect(await permissionsOf("PENDING")).toEqual([]);

    // A PENDING that somehow holds permissions (a manual database edit) can
    // still be emptied.
    await prisma.role.update({ where: { id: pending.id }, data: { permissions: ["task:read"] } });
    const emptied = await request(app)
      .patch(`/admin/roles/${pending.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ permissions: [] });
    expect(emptied.status).toBe(200);
    expect(await permissionsOf("PENDING")).toEqual([]);
  });
});
