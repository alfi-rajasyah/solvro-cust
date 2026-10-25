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

    const sql = readFileSync(MIGRATION, "utf8")
      .split("\n")
      .filter((line) => !line.startsWith("--"))
      .join("\n")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const statement of sql) await prisma.$executeRawUnsafe(statement);

    for (const [roleName, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      expect(await permissionsOf(roleName)).toEqual(permissions);
    }
    // Custom roles are not touched.
    expect(await permissionsOf(custom.roleName)).toEqual(["project:view-all"]);
    await prisma.role.delete({ where: { id: custom.id } });
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
