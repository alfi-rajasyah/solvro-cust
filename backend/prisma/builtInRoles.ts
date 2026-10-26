import type { PrismaClient } from "@prisma/client";

// The four built-in roles. Admins can create additional custom roles at
// runtime via POST /admin/roles; PENDING is protected from rename and delete
// because backend code references it by name (routes/admin.ts).
//
// PENDING is the auto-provisioning role for first-time Google sign-ins
// (empty permissions — every screen renders a permission-denied empty
// state until the admin promotes the user from Admin > Users).
//
// Lives beside seed.ts (not in src/) because the runtime image ships
// prisma/ but not src/, and the seed runs there on every container start.
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  ADMIN: ["*"],
  TAM: ["project:read", "project:write", "task:read", "task:write", "task:comment"],
  // STAKEHOLDER reads only the projects it is attached to (TAM, member or
  // customer owner). The read-everything grant (`project:view-all`) was
  // removed in the 2026-10 security hardening (docs/archive/plans/internal-sync.md);
  // an admin can grant it in Admin > Roles.
  STAKEHOLDER: ["project:read", "task:comment"],
  PENDING: [],
};

/**
 * Creates any built-in role that is missing, with its default permissions.
 * An existing role is left exactly as it is: ADMIN, TAM and STAKEHOLDER are
 * admin-managed (Admin > Roles), and the seed runs on every container start,
 * so writing the defaults here would undo an admin's edit at each restart.
 * (Databases upgraded from a version whose seed did overwrite were reset to
 * these defaults one last time by the 20261025090000_builtin_roles_last_reset
 * migration.)
 */
export async function ensureBuiltInRoles(db: Pick<PrismaClient, "role">): Promise<void> {
  for (const [roleName, permissions] of Object.entries(ROLE_PERMISSIONS)) {
    await db.role.upsert({
      where: { roleName },
      update: {},
      create: { roleName, permissions },
    });
  }
}
