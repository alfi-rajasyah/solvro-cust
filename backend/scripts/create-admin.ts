import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "ADMIN_EMAIL and ADMIN_PASSWORD must be set in the environment",
    );
  }
  if (!email.includes("@")) {
    throw new Error("ADMIN_EMAIL must be a valid email address");
  }
  if (password.length < 8) {
    throw new Error("ADMIN_PASSWORD must be at least 8 characters");
  }

  const adminRole = await prisma.role.findUnique({
    where: { roleName: "ADMIN" },
  });
  if (!adminRole) {
    throw new Error(
      "ADMIN role missing — `prisma db seed` must run before this script",
    );
  }
  // Admin > Roles can change the ADMIN role, and the seed no longer resets it,
  // so it may not grant admin access any more. Moving a user onto it then
  // would quietly take their admin access away.
  const permissions = Array.isArray(adminRole.permissions) ? adminRole.permissions : [];
  if (!permissions.includes("*")) {
    throw new Error(
      'The ADMIN role no longer grants "*" (admin access), so this script would not create an admin. ' +
        'Restore "*" on ADMIN in Admin > Roles, or give the user a role that has it.',
    );
  }

  const username = email.split("@")[0];
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      username,
      passwordHash,
      roleId: adminRole.id,
      active: true,
      // A reset through this script ends the account's existing sessions,
      // like an admin reset in the app (docs/archive/plans/internal-sync.md).
      tokenVersion: { increment: 1 },
    },
    create: {
      username,
      email,
      passwordHash,
      roleId: adminRole.id,
    },
  });

  console.log(`Admin user ready: ${user.email} (id=${user.id})`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
