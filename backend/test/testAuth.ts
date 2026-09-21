import "./env.js";
import { prisma } from "../src/prisma.js";
import { signToken } from "../src/http/auth.js";

// Mirrors prisma/seed.ts's ROLE_PERMISSIONS so tests exercise the same
// permission set the app ships with, without importing the seed script
// itself (which calls process.exit on completion).
const ROLE_PERMISSIONS: Record<string, string[]> = {
  ADMIN: ["*"],
  SA: [
    "project:read",
    "pipeline:view",
    "pipeline:create",
    "pipeline:edit_own",
    "pipeline:delete_own",
  ],
  TAM: ["project:read", "project:write", "task:read", "task:write"],
  STAKEHOLDER: ["project:read", "project:view-all"],
  PENDING: [],
};

export async function seedRoles(): Promise<void> {
  for (const roleName of Object.keys(ROLE_PERMISSIONS)) {
    await prisma.role.upsert({
      where: { roleName },
      update: { permissions: ROLE_PERMISSIONS[roleName] },
      create: { roleName, permissions: ROLE_PERMISSIONS[roleName] },
    });
  }
}

let userCounter = 0;

/**
 * Creates a fresh user for any seeded role and returns a bearer token for
 * it, issued the same way src/routes/auth.ts does on login (see
 * src/http/auth.ts#signToken). Username/email are unique per call.
 */
export async function createUserWithRole(
  roleName: string,
): Promise<{ userId: number; token: string }> {
  const role = await prisma.role.findUniqueOrThrow({ where: { roleName } });
  userCounter += 1;
  const user = await prisma.user.create({
    data: {
      username: `test-${roleName.toLowerCase()}-${userCounter}-${Date.now()}`,
      email: `test-${roleName.toLowerCase()}-${userCounter}-${Date.now()}@example.com`,
      passwordHash: null,
      roleId: role.id,
      active: true,
    },
  });
  const token = signToken({ sub: user.id, role: role.roleName, permissions: role.permissions as string[] });
  return { userId: user.id, token };
}

/**
 * Creates a fresh admin user (mirrors scripts/create-admin.ts) and returns a
 * bearer token for it.
 */
export async function createAdminAndToken(): Promise<{ userId: number; token: string }> {
  return createUserWithRole("ADMIN");
}
