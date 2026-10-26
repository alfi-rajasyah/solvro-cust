import { PrismaClient } from "@prisma/client";
import { ensureBuiltInRoles } from "./builtInRoles";

const prisma = new PrismaClient();

async function main() {
  // Creates missing built-in roles only; admin edits to existing ones stay.
  await ensureBuiltInRoles(prisma);

  // AuthConfig singleton — OAuth policy that the in-app admin owns.
  // Bootstrap with an empty allowed-domains list so a fresh deploy forces
  // an explicit policy decision before Google sign-in becomes usable.
  await prisma.authConfig.upsert({
    where: { id: "default" },
    update: {}, // never overwrite admin-edited values on re-seed
    create: { id: "default", googleAllowedDomains: [] },
  });

  const roleCount = await prisma.role.count();
  console.log(`Seed complete: ${roleCount} roles present, auth_config singleton ensured.`);
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
