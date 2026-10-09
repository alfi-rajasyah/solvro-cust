import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// The four built-in roles. These are seeded on every container start
// (idempotent upsert). Admins can create additional custom roles at
// runtime via POST /admin/roles, but these are protected from deletion
// because backend code references them by name.
//
// PENDING is the auto-provisioning role for first-time Google sign-ins
// (empty permissions — every screen renders a permission-denied empty
// state until the admin promotes the user from Admin > Users).
const ROLE_PERMISSIONS: Record<string, string[]> = {
  ADMIN: ["*"],
  TAM: ["project:read", "project:write", "task:read", "task:write"],
  // STAKEHOLDER reads only the projects it is attached to (TAM, member or
  // customer owner). The read-everything grant (`project:view-all`) was
  // removed in the 2026-10 security hardening (docs/archive/plans/internal-sync.md);
  // an admin can grant it through a custom role in Admin > Roles (built-in
  // roles are re-seeded on every start).
  STAKEHOLDER: ["project:read"],
  PENDING: [],
};

async function main() {
  for (const roleName of Object.keys(ROLE_PERMISSIONS)) {
    await prisma.role.upsert({
      where: { roleName },
      update: { permissions: ROLE_PERMISSIONS[roleName] },
      create: { roleName, permissions: ROLE_PERMISSIONS[roleName] },
    });
  }

  // AuthConfig singleton — OAuth policy that the in-app admin owns.
  // Bootstrap with an empty allowed-domains list so a fresh deploy forces
  // an explicit policy decision before Google sign-in becomes usable.
  await prisma.authConfig.upsert({
    where: { id: "default" },
    update: {}, // never overwrite admin-edited values on re-seed
    create: { id: "default", googleAllowedDomains: [] },
  });

  const roleCount = await prisma.role.count();
  console.log(`Seed complete: ${roleCount} roles upserted, auth_config singleton ensured.`);
  console.log(
    `(No users seeded. Run scripts/create-admin.ts with ADMIN_EMAIL and ADMIN_PASSWORD env vars to create the first admin.)`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
